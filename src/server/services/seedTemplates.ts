import "server-only";
import { all, uid, tx } from "@/server/db";
import type { AutomationType, TemplateGroup } from "@/lib/domain";

export type Seed = {
  name: string;
  event: AutomationType | null;
  category: "utility" | "marketing";
  group: TemplateGroup;
  language: "fr" | "ar" | "en";
  body: string;
  variables: string[];
};

type SeedDefinition = Omit<Seed, "language" | "body"> & {
  bodies: Record<Seed["language"], string>;
};

/**
 * Fifteen business templates in three languages.  They deliberately start as
 * `draft`: the platform records Meta's approval, it never invents it.  Keeping
 * the same name across languages makes the group visible to merchants while
 * the database's (merchant, name, language) key keeps each variant distinct.
 */
const DEFINITIONS: SeedDefinition[] = [
  {
    name: "order_confirmation_request",
    event: "new_order_confirmation",
    category: "utility",
    group: "confirmation",
    variables: ["customer_name", "order_ref", "total"],
    bodies: {
      fr: "Bonjour {{1}}, nous avons bien reçu votre commande {{2}} d'un montant de {{3}}. Répondez OUI pour confirmer ou NON pour annuler.",
      ar: "مرحباً {{1}}، لقد استلمنا طلبك {{2}} بمبلغ {{3}}. أجب بنعم للتأكيد أو بلا للإلغاء.",
      en: "Hello {{1}}, we received your order {{2}} for {{3}}. Reply YES to confirm or NO to cancel.",
    },
  },
  {
    name: "order_confirmed",
    event: null,
    category: "utility",
    group: "confirmation",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Merci {{1}} ! Votre commande {{2}} est confirmée. Nous préparons votre colis.",
      ar: "شكراً {{1}}! تم تأكيد طلبك {{2}}. سنقوم بتحضير طردك.",
      en: "Thank you {{1}}! Your order {{2}} is confirmed. We are preparing your parcel.",
    },
  },
  {
    name: "order_cancelled",
    event: null,
    category: "utility",
    group: "confirmation",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, votre commande {{2}} a bien été annulée. À bientôt.",
      ar: "مرحباً {{1}}، تم إلغاء طلبك {{2}}. إلى اللقاء.",
      en: "Hello {{1}}, your order {{2}} was cancelled successfully. See you soon.",
    },
  },
  {
    name: "order_postponed",
    event: null,
    category: "utility",
    group: "confirmation",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, nous avons reporté votre commande {{2}} comme demandé. Nous restons disponibles.",
      ar: "مرحباً {{1}}، تم تأجيل طلبك {{2}} كما طلبت. نحن في خدمتك.",
      en: "Hello {{1}}, we postponed your order {{2}} as requested. We remain available.",
    },
  },
  {
    name: "order_preparing",
    event: null,
    category: "utility",
    group: "tracking",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, votre commande {{2}} est en cours de préparation.",
      ar: "مرحباً {{1}}، طلبك {{2}} قيد التحضير.",
      en: "Hello {{1}}, your order {{2}} is being prepared.",
    },
  },
  {
    name: "order_shipped",
    event: "shipped_notice",
    category: "utility",
    group: "tracking",
    variables: ["customer_name", "order_ref", "tracking"],
    bodies: {
      fr: "Bonjour {{1}}, votre colis {{2}} a été expédié. Numéro de suivi : {{3}}.",
      ar: "مرحباً {{1}}، تم شحن طردك {{2}}. رقم التتبع: {{3}}.",
      en: "Hello {{1}}, your parcel {{2}} has shipped. Tracking number: {{3}}.",
    },
  },
  {
    name: "parcel_at_office",
    event: "at_office_notice",
    category: "utility",
    group: "tracking",
    variables: ["customer_name", "order_ref", "wilaya"],
    bodies: {
      fr: "Bonjour {{1}}, votre colis {{2}} est disponible au bureau de livraison de {{3}}. Merci de le retirer rapidement.",
      ar: "مرحباً {{1}}، طردك {{2}} متوفر في مكتب التوصيل في {{3}}. يرجى استلامه قريباً.",
      en: "Hello {{1}}, your parcel {{2}} is available at the delivery office in {{3}}. Please collect it soon.",
    },
  },
  {
    name: "out_for_delivery",
    event: "out_for_delivery_notice",
    category: "utility",
    group: "tracking",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, votre colis {{2}} est en cours de livraison aujourd'hui. Merci de rester joignable.",
      ar: "مرحباً {{1}}، طردك {{2}} في طريقه إليك اليوم. يرجى البقاء متاحاً.",
      en: "Hello {{1}}, your parcel {{2}} is out for delivery today. Please stay reachable.",
    },
  },
  {
    name: "delivery_reminder",
    event: "no_response_reminder",
    category: "utility",
    group: "tracking",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, nous n'avons pas encore reçu votre confirmation pour la commande {{2}}. Répondez OUI pour confirmer.",
      ar: "مرحباً {{1}}، لم نتلق تأكيدك للطلب {{2}} بعد. أجب بنعم للتأكيد.",
      en: "Hello {{1}}, we have not received your confirmation for order {{2}}. Reply YES to confirm.",
    },
  },
  {
    name: "delivery_failed",
    event: null,
    category: "utility",
    group: "return",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, la livraison de votre colis {{2}} n'a pas pu aboutir. Souhaitez-vous une nouvelle tentative ?",
      ar: "مرحباً {{1}}، تعذر توصيل طردك {{2}}. هل ترغب في محاولة جديدة؟",
      en: "Hello {{1}}, delivery of your parcel {{2}} was unsuccessful. Would you like another attempt?",
    },
  },
  {
    name: "return_requested",
    event: null,
    category: "utility",
    group: "return",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, votre demande de retour pour la commande {{2}} a bien été enregistrée.",
      ar: "مرحباً {{1}}، تم تسجيل طلب إرجاع الطلب {{2}}.",
      en: "Hello {{1}}, your return request for order {{2}} has been recorded.",
    },
  },
  {
    name: "order_returned",
    event: null,
    category: "utility",
    group: "return",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, le colis de la commande {{2}} nous a été retourné. Contactez-nous pour la suite.",
      ar: "مرحباً {{1}}، تمت إعادة طرد الطلب {{2}} إلينا. تواصل معنا للخطوة التالية.",
      en: "Hello {{1}}, the parcel for order {{2}} was returned to us. Contact us for the next step.",
    },
  },
  {
    name: "order_delivered",
    event: "delivered_thanks",
    category: "utility",
    group: "satisfaction",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Merci {{1}} ! Votre commande {{2}} a bien été livrée. Évaluez votre expérience de 1 à 5.",
      ar: "شكراً {{1}}! تم تسليم طلبك {{2}} بنجاح. قيّم تجربتك من 1 إلى 5.",
      en: "Thank you {{1}}! Your order {{2}} was delivered. Rate your experience from 1 to 5.",
    },
  },
  {
    name: "satisfaction_request",
    event: null,
    category: "marketing",
    group: "satisfaction",
    variables: ["customer_name", "order_ref"],
    bodies: {
      fr: "Bonjour {{1}}, êtes-vous satisfait de votre commande {{2}} ? Répondez par une note de 1 à 5. STOP pour vous désabonner.",
      ar: "مرحباً {{1}}، هل أنت راض عن طلبك {{2}}؟ أجب بتقييم من 1 إلى 5. أرسل توقف لإلغاء الاشتراك.",
      en: "Hello {{1}}, are you satisfied with order {{2}}? Reply with a score from 1 to 5. Reply STOP to opt out.",
    },
  },
  {
    name: "satisfaction_thanks",
    event: null,
    category: "utility",
    group: "satisfaction",
    variables: ["customer_name"],
    bodies: {
      fr: "Merci {{1}} pour votre avis. Il nous aide à améliorer chaque livraison.",
      ar: "شكراً {{1}} على رأيك. يساعدنا ذلك على تحسين كل عملية توصيل.",
      en: "Thank you {{1}} for your feedback. It helps us improve every delivery.",
    },
  },
];

export const TEMPLATE_SEEDS: Seed[] = DEFINITIONS.flatMap((definition) =>
  (["fr", "ar", "en"] as const).map((language) => ({
    name: definition.name,
    event: definition.event,
    category: definition.category,
    group: definition.group,
    language,
    body: definition.bodies[language],
    variables: definition.variables,
  })),
);

export async function seedTemplates(merchantId: string) {
  return tx(async () => {
    const counts = { created: 0, existed: 0, languages: { fr: 0, ar: 0, en: 0 } };
    for (const template of TEMPLATE_SEEDS) {
      const inserted = await all(
        `INSERT INTO whatsapp_templates
          (id, merchant_id, name, category, language, status, body, variables, event_key, template_group, group_key)
         VALUES (?,?,?,?,?, 'draft', ?, ?, ?, ?, ?)
         ON CONFLICT (merchant_id, name, language) DO NOTHING RETURNING id`,
        [
          uid("tpl"),
          merchantId,
          template.name,
          template.category,
          template.language,
          template.body,
          JSON.stringify(template.variables),
          template.event,
          template.group,
          template.group,
        ],
      );
      if (inserted.length) {
        counts.created++;
        counts.languages[template.language]++;
      } else counts.existed++;
    }
    return counts;
  });
}
