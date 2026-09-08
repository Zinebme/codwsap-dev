import "server-only";
/**
 * Liaison entre une identité Supabase Auth et un compte CODWSAP.
 *
 * RÈGLE CENTRALE
 * --------------
 * Un marchand qui s'est inscrit par email/mot de passe puis se connecte plus
 * tard via Google ou Apple avec le MÊME email vérifié doit retrouver son
 * compte : ni utilisateur en double, ni marchand en double.
 *
 * La fusion n'est autorisée QUE si le fournisseur atteste que l'email est
 * vérifié. Sinon, n'importe qui pourrait créer un compte social portant
 * l'email d'un tiers et récupérer son espace marchand : c'est une prise de
 * contrôle de compte. Dans ce cas, on refuse explicitement.
 */
import { get, run, uid, nowIso, tx } from "@/server/db";

export type LinkOutcome =
  | { status: "linked"; userId: string; hasMerchant: boolean }
  | { status: "created"; userId: string; hasMerchant: false }
  | { status: "email_unverified" }
  | { status: "inactive" };

type SupabaseIdentity = {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string | null;
  provider: string;
};

async function userHasMerchant(userId: string): Promise<boolean> {
  const row = await get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM merchant_users WHERE user_id = ? AND status = 'active'",
    [userId],
  );
  return Number(row?.c ?? 0) > 0;
}

/**
 * Résout (et crée si nécessaire) le compte CODWSAP correspondant à une
 * identité Supabase.
 *
 * Ne crée JAMAIS de marchand : la création du marchand est atomique et se fait
 * dans l'onboarding (voir `completeSocialOnboarding`). On évite ainsi tout
 * marchand partiel si l'utilisateur abandonne en cours de route.
 */
export async function linkSupabaseIdentity(identity: SupabaseIdentity): Promise<LinkOutcome> {
  const email = identity.email.toLowerCase().trim();
  const provider = identity.provider === "email" ? "email" : identity.provider;

  // 1) Identité déjà liée : chemin nominal des connexions suivantes.
  const existingLink = await get<{ user_id: string }>(
    "SELECT user_id FROM auth_identities WHERE supabase_user_id = ? AND provider = ?",
    [identity.id, provider],
  );
  if (existingLink) {
    const user = await get<{ id: string; is_active: number }>("SELECT id, is_active FROM users WHERE id = ?", [
      existingLink.user_id,
    ]);
    if (!user) return { status: "email_unverified" };
    if (!user.is_active) return { status: "inactive" };
    await run("UPDATE auth_identities SET last_login_at = ? WHERE supabase_user_id = ? AND provider = ?", [
      nowIso(),
      identity.id,
      provider,
    ]);
    await run("UPDATE users SET last_login_at = ? WHERE id = ?", [nowIso(), user.id]);
    return { status: "linked", userId: user.id, hasMerchant: await userHasMerchant(user.id) };
  }

  // 2) Un compte CODWSAP existe déjà avec cet email : on RATTACHE la nouvelle
  //    identité au lieu d'ouvrir un second compte.
  const existingUser = await get<{ id: string; is_active: number }>(
    "SELECT id, is_active FROM users WHERE email = ?",
    [email],
  );

  if (existingUser) {
    // Garde-fou anti-usurpation : pas de fusion sur un email non vérifié.
    if (!identity.emailVerified) return { status: "email_unverified" };
    if (!existingUser.is_active) return { status: "inactive" };

    await run(
      "INSERT INTO auth_identities (id, user_id, supabase_user_id, provider, email, last_login_at) VALUES (?,?,?,?,?,?)",
      [uid("aid"), existingUser.id, identity.id, provider, email, nowIso()],
    );
    await run("UPDATE users SET last_login_at = ? WHERE id = ?", [nowIso(), existingUser.id]);
    return { status: "linked", userId: existingUser.id, hasMerchant: await userHasMerchant(existingUser.id) };
  }

  // 3) Nouvel utilisateur. Toujours sans marchand : l'onboarding s'en charge.
  if (!identity.emailVerified) return { status: "email_unverified" };

  const userId = uid("usr");
  await tx(async () => {
    await run(
      // password_hash NULL : compte social, l'authentification reste chez Supabase.
      "INSERT INTO users (id, email, password_hash, full_name, onboarding_pending) VALUES (?,?,?,?,1)",
      [userId, email, null, identity.fullName || email.split("@")[0]],
    );
    await run(
      "INSERT INTO auth_identities (id, user_id, supabase_user_id, provider, email, last_login_at) VALUES (?,?,?,?,?,?)",
      [uid("aid"), userId, identity.id, provider, email, nowIso()],
    );
  });

  return { status: "created", userId, hasMerchant: false };
}

/**
 * Crée le marchand d'un utilisateur social, de façon ATOMIQUE.
 *
 * Tout est créé dans une seule transaction — utilisateur complété, marchand,
 * appartenance OWNER, abonnement d'essai, automatisations et modèles par
 * défaut. Si une étape échoue, la transaction est annulée : aucun marchand
 * partiel ne peut subsister.
 */
export async function completeSocialOnboarding(params: {
  userId: string;
  fullName: string;
  business: string;
  phoneNormalized: string;
}): Promise<{ ok: true; merchantId: string } | { ok: false; error: string }> {
  const { userId, fullName, business, phoneNormalized } = params;

  // Validation défensive : ce service ne doit jamais dépendre du seul
  // contrôle effectué par la route HTTP. Un appel interne mal formé ne doit
  // pas pouvoir créer un marchand sans nom.
  if (fullName.trim().length < 2) return { ok: false, error: "Nom complet invalide." };
  if (business.trim().length < 2) return { ok: false, error: "Nom de boutique invalide." };
  if (!phoneNormalized.trim()) return { ok: false, error: "Numéro de téléphone invalide." };

  const user = await get<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = ?", [userId]);
  if (!user) return { ok: false, error: "Compte introuvable." };

  // Idempotence : un double envoi du formulaire ne doit pas créer deux marchands.
  if (await userHasMerchant(userId)) {
    const existing = await get<{ merchant_id: string }>(
      "SELECT merchant_id FROM merchant_users WHERE user_id = ? AND status = 'active' LIMIT 1",
      [userId],
    );
    return { ok: true, merchantId: existing!.merchant_id };
  }

  const merchantId = uid("mrc");
  const slug = `${business.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "boutique"}-${merchantId.slice(-5)}`;
  const trialEnd = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

  try {
    // Les imports sont différés : ces modules touchent la base et ne doivent
    // être chargés que dans le contexte transactionnel.
    const { seedAutomations } = await import("@/server/services/automations");
    const { seedTemplates } = await import("@/server/services/seedTemplates");

    await tx(async () => {
      await run("UPDATE users SET full_name = ?, phone = ?, onboarding_pending = 0 WHERE id = ?", [
        fullName,
        phoneNormalized,
        userId,
      ]);
      await run(
        `INSERT INTO merchants (id, name, slug, status, plan_code, phone, email, trial_ends_at)
         VALUES (?,?,?, 'trial', 'trial', ?,?,?)`,
        [merchantId, business, slug, phoneNormalized, user.email, trialEnd],
      );
      await run("INSERT INTO merchant_users (id, merchant_id, user_id, role, status) VALUES (?,?,?, 'owner', 'active')", [
        uid("mus"),
        merchantId,
        userId,
      ]);
      await run(
        "INSERT INTO subscriptions (id, merchant_id, plan_code, status, period_end) VALUES (?,?, 'trial', 'trialing', ?)",
        [uid("sub"), merchantId, trialEnd],
      );
      await seedAutomations(merchantId);
      await seedTemplates(merchantId);
    });
    return { ok: true, merchantId };
  } catch {
    // La transaction a été annulée : rien n'a été créé.
    return { ok: false, error: "La création de votre espace a échoué. Veuillez réessayer." };
  }
}
