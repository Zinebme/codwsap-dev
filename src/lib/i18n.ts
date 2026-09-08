export const LOCALES = ["fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";
/** English is prepared: add "en" to LOCALES and an `en` block in each dictionary entry. */

export function isRtl(locale: Locale) {
  return locale === "ar";
}

export function dir(locale: Locale) {
  return isRtl(locale) ? "rtl" : "ltr";
}

type Dict = Record<string, { fr: string; ar: string }>;

export const T: Dict = {
  // ---- global / nav
  "nav.features": { fr: "Fonctionnalités", ar: "الميزات" },
  "nav.how": { fr: "Comment ça marche", ar: "كيف يعمل" },
  "nav.integrations": { fr: "Intégrations", ar: "التكاملات" },
  "nav.pricing": { fr: "Tarifs", ar: "الأسعار" },
  "nav.faq": { fr: "FAQ", ar: "الأسئلة" },
  "nav.contact": { fr: "Contact", ar: "اتصل بنا" },
  "nav.login": { fr: "Connexion", ar: "تسجيل الدخول" },
  "nav.signup": { fr: "Créer un compte", ar: "إنشاء حساب" },
  "nav.dashboard": { fr: "Tableau de bord", ar: "لوحة التحكم" },

  // ---- hero
  "hero.badge": { fr: "Plateforme algérienne pour le COD", ar: "منصة جزائرية للدفع عند الاستلام" },
  "hero.title": { fr: "Automatisez vos commandes COD sur WhatsApp.", ar: "أتمتة طلبات الدفع عند الاستلام عبر واتساب." },
  "hero.subtitle": {
    fr: "Confirmez vos commandes, notifiez vos clients, suivez vos colis, réduisez les livraisons manquées et pilotez tout depuis un seul tableau de bord.",
    ar: "أكّد طلباتك، أشعر زبائنك، تتبّع طرودك، قلّل التسليمات الفاشلة وأدر كل شيء من لوحة واحدة.",
  },
  "hero.cta": { fr: "Démarrer gratuitement", ar: "ابدأ مجانا" },
  "hero.cta2": { fr: "Voir les fonctionnalités", ar: "اكتشف الميزات" },
  "hero.note": { fr: "Essai gratuit • Sans carte bancaire • Interface en français et en arabe", ar: "تجربة مجانية • بدون بطاقة بنكية • واجهة بالفرنسية والعربية" },

  // ---- features
  "features.title": { fr: "Tout ce qu'il faut pour gérer le COD sérieusement", ar: "كل ما تحتاجه لإدارة الدفع عند الاستلام باحترافية" },
  "features.subtitle": { fr: "Un produit focalisé : commandes, WhatsApp, livraison, automatisation.", ar: "منتج مركّز: الطلبات، واتساب، التوصيل، الأتمتة." },
  "f.wa.title": { fr: "Automatisation WhatsApp", ar: "أتمتة واتساب" },
  "f.wa.desc": { fr: "Templates approuvés, confirmations, notifications de suivi via l'API officielle WhatsApp Business.", ar: "قوالب معتمدة، تأكيدات وإشعارات عبر واجهة واتساب للأعمال الرسمية." },
  "f.cod.title": { fr: "Gestion des commandes COD", ar: "إدارة طلبات الدفع عند الاستلام" },
  "f.cod.desc": { fr: "Statuts clairs, filtres rapides, actions en masse, notes internes et agents assignés.", ar: "حالات واضحة، فلاتر سريعة، إجراءات جماعية، ملاحظات داخلية وتعيين الوكلاء." },
  "f.track.title": { fr: "Suivi des colis", ar: "تتبع الطرود" },
  "f.track.desc": { fr: "Statuts normalisés de plusieurs transporteurs, webhooks et synchronisation automatique.", ar: "حالات موحدة من عدة شركات توصيل مع مزامنة تلقائية." },
  "f.follow.title": { fr: "Relance client", ar: "متابعة الزبون" },
  "f.follow.desc": { fr: "Un rappel unique et pertinent quand le client ne répond pas — jamais de spam.", ar: "تذكير واحد مناسب عند عدم رد الزبون — بدون إزعاج." },
  "f.notif.title": { fr: "Notifications intelligentes", ar: "إشعارات ذكية" },
  "f.notif.desc": { fr: "Alertes dashboard et Telegram uniquement sur les évènements qui comptent.", ar: "تنبيهات في اللوحة وتيليغرام للأحداث المهمة فقط." },
  "f.multi.title": { fr: "Plusieurs transporteurs", ar: "عدة شركات توصيل" },
  "f.multi.desc": { fr: "Architecture de connecteurs : EcoTrack, Yalidine, ZR Express, Navex et d'autres.", ar: "بنية موصلات: إيكوتراك، ياليدين، ZR إكسبرس، نافكس وغيرها." },
  "f.quality.title": { fr: "Protection de la qualité WhatsApp", ar: "حماية جودة واتساب" },
  "f.quality.desc": { fr: "Moteur de règles, anti-doublon, cooldown et opt-out pour protéger votre numéro.", ar: "محرك قواعد ومنع التكرار وفترة تهدئة وإلغاء الاشتراك لحماية رقمك." },
  "f.simple.title": { fr: "Pensé pour les marchands algériens", ar: "مصمم للتجار الجزائريين" },
  "f.simple.desc": { fr: "Wilayas, communes, stop desk, DZD, français et arabe, excellent sur mobile.", ar: "الولايات والبلديات ومكتب الاستلام والدينار والفرنسية والعربية وتجربة ممتازة على الهاتف." },

  // ---- how it works
  "how.title": { fr: "Comment ça marche", ar: "كيف يعمل" },
  "how.subtitle": { fr: "Opérationnel en moins de 30 minutes.", ar: "جاهز للعمل في أقل من 30 دقيقة." },
  "how.s1.t": { fr: "Connectez vos commandes", ar: "اربط طلباتك" },
  "how.s1.d": { fr: "Google Sheets, webhook, API, import CSV ou saisie manuelle.", ar: "جوجل شيت، ويب هوك، API، استيراد CSV أو إدخال يدوي." },
  "how.s2.t": { fr: "Connectez WhatsApp", ar: "اربط واتساب" },
  "how.s2.d": { fr: "Votre propre compte WhatsApp Business Cloud API.", ar: "حسابك الخاص في واتساب بيزنس كلاود API." },
  "how.s3.t": { fr: "Connectez la livraison", ar: "اربط شركة التوصيل" },
  "how.s3.d": { fr: "Ajoutez vos identifiants transporteur et testez la connexion.", ar: "أضف بيانات شركة التوصيل واختبر الاتصال." },
  "how.s4.t": { fr: "Activez vos automatisations", ar: "فعّل الأتمتة" },
  "how.s4.d": { fr: "Choisissez les évènements réellement utiles à vos clients.", ar: "اختر الأحداث المفيدة فعلا لزبائنك." },

  // ---- integrations
  "int.title": { fr: "Intégrations supportées", ar: "التكاملات المدعومة" },
  "int.subtitle": { fr: "Architecture de connecteurs ouverte, sans dépendance à un seul fournisseur.", ar: "بنية موصلات مفتوحة دون الارتباط بمزود واحد." },
  "int.available": { fr: "Disponible", ar: "متاح" },
  "int.soon": { fr: "Bientôt", ar: "قريبا" },
  "int.request": { fr: "Mon transporteur n'est pas listé", ar: "شركة التوصيل الخاصة بي غير مدرجة" },

  // ---- pricing
  "pricing.title": { fr: "Tarifs simples", ar: "أسعار بسيطة" },
  "pricing.subtitle": { fr: "Commencez en essai, changez de plan quand vous voulez.", ar: "ابدأ بتجربة وغيّر الخطة متى شئت." },
  "pricing.month": { fr: "/ mois", ar: "/ شهريا" },
  "pricing.cta": { fr: "Choisir ce plan", ar: "اختر هذه الخطة" },
  "pricing.popular": { fr: "Le plus choisi", ar: "الأكثر اختيارا" },

  // ---- faq / contact
  "faq.title": { fr: "Questions fréquentes", ar: "أسئلة متكررة" },
  "contact.title": { fr: "Contactez-nous", ar: "اتصل بنا" },
  "contact.subtitle": { fr: "Une question sur les intégrations ou votre configuration ? Écrivez-nous.", ar: "سؤال حول التكاملات أو الإعداد؟ راسلنا." },
  "contact.name": { fr: "Nom complet", ar: "الاسم الكامل" },
  "contact.email": { fr: "Email", ar: "البريد الإلكتروني" },
  "contact.phone": { fr: "Téléphone", ar: "الهاتف" },
  "contact.message": { fr: "Message", ar: "الرسالة" },
  "contact.send": { fr: "Envoyer", ar: "إرسال" },
  "contact.sent": { fr: "Message envoyé. Nous vous répondons rapidement.", ar: "تم الإرسال. سنرد عليك قريبا." },

  // ---- auth
  "auth.login.title": { fr: "Connexion à votre espace", ar: "الدخول إلى مساحتك" },
  "auth.signup.title": { fr: "Créer votre compte marchand", ar: "أنشئ حساب التاجر" },
  "auth.email": { fr: "Email professionnel", ar: "البريد المهني" },
  "auth.password": { fr: "Mot de passe", ar: "كلمة المرور" },
  "auth.fullname": { fr: "Votre nom", ar: "اسمك" },
  "auth.business": { fr: "Nom de la boutique", ar: "اسم المتجر" },
  "auth.phone": { fr: "Téléphone", ar: "الهاتف" },
  "auth.submit.login": { fr: "Se connecter", ar: "تسجيل الدخول" },
  "auth.submit.signup": { fr: "Créer mon compte", ar: "إنشاء الحساب" },
  "auth.nomember": { fr: "Pas encore de compte ?", ar: "ليس لديك حساب؟" },
  "auth.member": { fr: "Déjà un compte ?", ar: "لديك حساب؟" },

  // ---- auth: social, mots de passe, erreurs (FR + AR)
  "auth.or": { fr: "ou", ar: "أو" },
  "auth.google": { fr: "Continuer avec Google", ar: "المتابعة مع Google" },
  "auth.apple": { fr: "Continuer avec Apple", ar: "المتابعة مع Apple" },
  "auth.apple.soon": { fr: "Bientôt disponible", ar: "قريبا" },
  "auth.forgot": { fr: "Mot de passe oublié ?", ar: "نسيت كلمة المرور؟" },
  "auth.forgot.title": { fr: "Réinitialiser votre mot de passe", ar: "إعادة تعيين كلمة المرور" },
  "auth.forgot.desc": {
    fr: "Indiquez votre email : nous vous enverrons un lien de réinitialisation.",
    ar: "أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين.",
  },
  "auth.forgot.submit": { fr: "Envoyer le lien", ar: "إرسال الرابط" },
  "auth.forgot.sent": {
    fr: "Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.",
    ar: "إذا كان هناك حساب بهذا البريد، فقد أُرسل رابط إعادة التعيين.",
  },
  "auth.reset.title": { fr: "Choisir un nouveau mot de passe", ar: "اختر كلمة مرور جديدة" },
  "auth.reset.submit": { fr: "Enregistrer le mot de passe", ar: "حفظ كلمة المرور" },
  "auth.reset.done": { fr: "Mot de passe mis à jour.", ar: "تم تحديث كلمة المرور." },
  "invite.title": { fr: "Rejoindre une équipe CODWSAP", ar: "الانضمام إلى فريق CODWSAP" },
  "invite.accept": { fr: "Rejoindre l'équipe", ar: "الانضمام إلى الفريق" },
  "invite.confirm.identity": { fr: "Confirmer et rejoindre", ar: "تأكيد والانضمام" },
  "invite.done": { fr: "Bienvenue dans l'équipe !", ar: "مرحبا بك في الفريق!" },
  "invite.role.agent": { fr: "Agent", ar: "وكيل" },
  "invite.role.admin": { fr: "Administrateur", ar: "مسؤول" },
  "invite.err.expired": { fr: "Cette invitation a expiré. Demandez un nouveau lien.", ar: "انتهت صلاحية هذه الدعوة. اطلب رابطا جديدا." },
  "invite.err.revoked": { fr: "Cette invitation a été annulée.", ar: "تم إلغاء هذه الدعوة." },
  "invite.err.used": { fr: "Cette invitation a déjà été utilisée.", ar: "تم استخدام هذه الدعوة بالفعل." },
  "invite.err.invalid": { fr: "Invitation introuvable. Vérifiez le lien reçu.", ar: "لم يتم العثور على الدعوة. تحقق من الرابط." },
  "auth.password.confirm": { fr: "Confirmer le mot de passe", ar: "تأكيد كلمة المرور" },
  "auth.password.mismatch": { fr: "Les mots de passe ne correspondent pas.", ar: "كلمتا المرور غير متطابقتين." },
  "auth.pw.weak": { fr: "Faible", ar: "ضعيفة" },
  "auth.pw.medium": { fr: "Moyen", ar: "متوسطة" },
  "auth.pw.strong": { fr: "Fort", ar: "قوية" },
  "auth.pw.hint": {
    fr: "8 caractères minimum, avec des lettres et des chiffres.",
    ar: "8 أحرف على الأقل، مع حروف وأرقام.",
  },
  "auth.verify.title": { fr: "Vérifiez votre email", ar: "تحقق من بريدك الإلكتروني" },
  "auth.verify.desc": {
    fr: "Nous avons envoyé un lien de confirmation à votre adresse. Ouvrez-le pour activer votre compte.",
    ar: "أرسلنا رابط تأكيد إلى عنوانك. افتحه لتفعيل حسابك.",
  },
  "auth.verify.resend": { fr: "Renvoyer l'email de confirmation", ar: "إعادة إرسال رسالة التأكيد" },
  "auth.verify.resent": { fr: "Email renvoyé. Pensez à vérifier vos spams.", ar: "أُعيد إرسال الرسالة. تحقق من البريد غير المرغوب." },
  "auth.onboarding.title": { fr: "Finalisez votre espace", ar: "أكمل إعداد مساحتك" },
  "auth.onboarding.desc": {
    fr: "Encore quelques informations et votre boutique est prête.",
    ar: "بعض المعلومات فقط ومتجرك جاهز.",
  },
  "auth.onboarding.submit": { fr: "Créer mon espace", ar: "إنشاء مساحتي" },

  // Messages d'erreur : jamais d'erreur technique brute côté utilisateur.
  "auth.err.config": { fr: "Authentification indisponible pour le moment.", ar: "المصادقة غير متاحة حاليا." },
  "auth.err.oauth": { fr: "La connexion avec ce fournisseur a échoué. Réessayez.", ar: "فشل تسجيل الدخول عبر هذا المزود. حاول مجددا." },
  "auth.err.expired": { fr: "Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.", ar: "انتهت صلاحية هذا الرابط أو تم استخدامه. اطلب رابطا جديدا." },
  "auth.err.unverified": {
    fr: "Votre adresse email n'est pas encore vérifiée. Confirmez-la avant de continuer.",
    ar: "لم يتم التحقق من بريدك الإلكتروني بعد. أكّده قبل المتابعة.",
  },
  "auth.err.inactive": { fr: "Ce compte est désactivé. Contactez votre administrateur.", ar: "هذا الحساب معطّل. اتصل بالمسؤول." },
  "auth.err.no_email": { fr: "Aucune adresse email n'a été fournie par ce fournisseur.", ar: "لم يوفر هذا المزود أي بريد إلكتروني." },
  "auth.err.unknown": { fr: "Une erreur est survenue. Réessayez dans un instant.", ar: "حدث خطأ. أعد المحاولة بعد قليل." },

  // ---- dashboard nav
  "d.home": { fr: "Accueil", ar: "الرئيسية" },
  "d.orders": { fr: "Commandes", ar: "الطلبات" },
  "d.customers": { fr: "Clients", ar: "الزبائن" },
  "d.whatsapp": { fr: "WhatsApp", ar: "واتساب" },
  "d.automations": { fr: "Automatisations", ar: "الأتمتة" },
  "d.delivery": { fr: "Livraison", ar: "التوصيل" },
  "d.integrations": { fr: "Intégrations", ar: "التكاملات" },
  "d.analytics": { fr: "Statistiques", ar: "الإحصائيات" },
  "d.notifications": { fr: "Notifications", ar: "الإشعارات" },
  "d.settings": { fr: "Paramètres", ar: "الإعدادات" },
  "d.search": { fr: "Rechercher commande, client, téléphone, suivi…", ar: "ابحث عن طلب، زبون، هاتف، رقم تتبع…" },
  "d.logout": { fr: "Se déconnecter", ar: "تسجيل الخروج" },
  "d.markallread": { fr: "Tout marquer comme lu", ar: "تعليم الكل كمقروء" },
  "d.nonotif": { fr: "Aucune notification", ar: "لا توجد إشعارات" },
  "d.health": { fr: "Santé des intégrations", ar: "حالة التكاملات" },
  "d.profile": { fr: "Profil", ar: "الملف" },
  "d.loading": { fr: "Chargement…", ar: "جار التحميل…" },
  "d.empty": { fr: "Aucun résultat", ar: "لا توجد نتائج" },
  "d.save": { fr: "Enregistrer", ar: "حفظ" },
  "d.cancel": { fr: "Annuler", ar: "إلغاء" },
  "d.close": { fr: "Fermer", ar: "إغلاق" },
  "d.test": { fr: "Tester", ar: "اختبار" },
  "d.configure": { fr: "Configurer", ar: "إعداد" },
  "d.connected": { fr: "Connecté", ar: "متصل" },
  "d.disconnected": { fr: "Déconnecté", ar: "غير متصل" },
};

export function t(key: string, locale: Locale): string {
  const entry = T[key];
  if (!entry) return key;
  return entry[locale] ?? entry.fr;
}

export function makeT(locale: Locale) {
  return (key: string) => t(key, locale);
}
