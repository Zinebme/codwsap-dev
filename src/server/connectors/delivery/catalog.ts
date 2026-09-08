/**
 * Catalogue des transporteurs algériens.
 *
 * PRINCIPE D'ARCHITECTURE
 * -----------------------
 * On ne construit PAS une intégration par société. La majorité des
 * transporteurs algériens s'appuient sur un petit nombre de « moteurs » d'API
 * partagés : une société revend ou héberge la même plateforme sous sa marque.
 * On implémente donc quatre moteurs réutilisables :
 *
 *   yalidine  — plateforme Yalidine et ses marques dérivées
 *   procolis  — plateforme Procolis (API « Colis » historique)
 *   ecotrack  — instances EcoTrack, une par société (URL propre au marchand)
 *   custom    — connecteur générique paramétrable pour tout le reste
 *
 * Chaque entrée ci-dessous décrit UNE société commerciale et indique le moteur
 * qui la dessert. Ajouter un transporteur revient à ajouter une ligne, pas une
 * intégration.
 *
 * HONNÊTETÉ TECHNIQUE
 * -------------------
 * `docStatus` déclare ce qui est réellement vérifiable :
 *
 *   public      documentation publique disponible, requêtes conformes à celle-ci
 *   engine      dessert un moteur connu, mais non vérifié pour CETTE société
 *   unverified  moteur probable, endpoints NON confirmés publiquement
 *
 * Aucun endpoint privé n'est inventé. Tant qu'une société n'est pas confirmée,
 * l'interface affiche « Identifiants/documentation requis » et la connexion
 * doit être testée avant d'être marquée comme active.
 */

export type DeliveryEngine = "yalidine" | "procolis" | "ecotrack" | "custom" | "sandbox";

/** Fiabilité de l'intégration pour une société donnée. */
export type DocStatus = "public" | "engine" | "unverified";

export type CarrierCapabilityKey =
  | "createShipment"
  | "tracking"
  | "cancelShipment"
  | "webhook"
  | "polling"
  | "labelPrinting";

export type Carrier = {
  /** Identifiant stable stocké en base (`delivery_connections.provider`). */
  id: string;
  name: string;
  /** Moteur d'API qui dessert cette société. */
  engine: DeliveryEngine;
  /** Famille affichée dans l'interface pour regrouper les cartes. */
  family: "yalidine" | "procolis" | "ecotrack" | "independent" | "generic";
  docStatus: DocStatus;
  /** Teinte du logo de repli (initiales) quand aucun visuel n'est fourni. */
  tone: "blue" | "emerald" | "amber" | "violet" | "teal" | "red" | "slate";
  /** Site officiel, affiché en aide à la configuration. */
  website?: string;
  /** Note affichée sur la carte (ex. instance EcoTrack propre au marchand). */
  note?: string;
};

/**
 * Capacités par MOTEUR. Une société hérite des capacités de son moteur : c'est
 * exactement pourquoi on mutualise.
 *
 * `labelPrinting` reste false partout tant qu'aucune génération d'étiquette
 * n'est implémentée — on ne coche pas une case non tenue.
 */
export const ENGINE_CAPABILITIES: Record<DeliveryEngine, Record<CarrierCapabilityKey, boolean>> = {
  yalidine: {
    createShipment: true,
    tracking: true,
    cancelShipment: true,
    webhook: false,
    polling: true,
    labelPrinting: false,
  },
  procolis: {
    createShipment: true,
    tracking: true,
    cancelShipment: false,
    webhook: false,
    polling: true,
    labelPrinting: false,
  },
  ecotrack: {
    createShipment: true,
    tracking: true,
    cancelShipment: false,
    webhook: true,
    polling: true,
    labelPrinting: false,
  },
  custom: {
    createShipment: true,
    tracking: true,
    cancelShipment: false,
    webhook: true,
    polling: true,
    labelPrinting: false,
  },
  sandbox: {
    createShipment: true,
    tracking: true,
    cancelShipment: true,
    webhook: true,
    polling: true,
    labelPrinting: false,
  },
};

export const ENGINE_LABELS: Record<DeliveryEngine, string> = {
  yalidine: "Moteur Yalidine",
  procolis: "Moteur Procolis",
  ecotrack: "Moteur EcoTrack",
  custom: "Connecteur personnalisé",
  sandbox: "Bac à sable",
};

/**
 * Catalogue. `docStatus: "public"` est réservé aux plateformes dont l'API est
 * documentée publiquement (Yalidine, Procolis, EcoTrack). Les marques qui
 * revendent ces plateformes sont marquées `engine` : le moteur est connu, mais
 * l'accès n'a pas été vérifié pour cette société précise.
 */
export const CARRIERS: readonly Carrier[] = [
  /* ----------------------------- Famille Yalidine ---------------------------- */
  { id: "yalidine", name: "Yalidine", engine: "yalidine", family: "yalidine", docStatus: "public", tone: "blue", website: "https://yalidine.com" },
  { id: "yalitec", name: "Yalitec", engine: "yalidine", family: "yalidine", docStatus: "engine", tone: "blue" },
  { id: "guepex", name: "Guepex", engine: "yalidine", family: "yalidine", docStatus: "engine", tone: "amber" },
  { id: "easy_speed", name: "Easy & Speed", engine: "yalidine", family: "yalidine", docStatus: "engine", tone: "teal" },
  { id: "economiqua", name: "Economiqua", engine: "yalidine", family: "yalidine", docStatus: "engine", tone: "emerald" },
  { id: "we_can_services", name: "We Can Services", engine: "yalidine", family: "yalidine", docStatus: "engine", tone: "violet" },

  /* ----------------------------- Famille Procolis ---------------------------- */
  { id: "procolis", name: "Procolis", engine: "procolis", family: "procolis", docStatus: "public", tone: "slate", website: "https://procolis.com" },
  { id: "zrexpress", name: "ZR Express", engine: "procolis", family: "procolis", docStatus: "public", tone: "amber", note: "API Procolis (historique ZR Express)." },
  { id: "abex", name: "ABEX Express", engine: "procolis", family: "procolis", docStatus: "engine", tone: "blue" },
  { id: "leopard_express", name: "Leopard Express", engine: "procolis", family: "procolis", docStatus: "engine", tone: "amber" },
  { id: "colilog_express", name: "Colilog Express", engine: "procolis", family: "procolis", docStatus: "engine", tone: "teal" },
  { id: "flash_delivery", name: "Flash Delivery", engine: "procolis", family: "procolis", docStatus: "engine", tone: "violet" },

  /* ----------------------------- Famille EcoTrack ---------------------------- */
  // Chaque société EcoTrack expose SA propre instance : le marchand saisit
  // l'URL de sa plateforme et son jeton. Le moteur est identique.
  { id: "ecotrack", name: "EcoTrack (générique)", engine: "ecotrack", family: "ecotrack", docStatus: "public", tone: "emerald", note: "Pour toute société propulsée par EcoTrack. Saisissez l'URL de votre plateforme." },
  { id: "dhd", name: "DHD", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "blue" },
  { id: "conexlog", name: "Conexlog", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "teal" },
  { id: "msm_go", name: "MSM Go", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "violet" },
  { id: "rex_livraison", name: "Rex Livraison", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "red" },
  { id: "worldexpress", name: "WorldExpress", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "blue" },
  { id: "med_express", name: "Med Express", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "emerald" },
  { id: "colireli", name: "Colireli", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "amber" },
  { id: "pdex", name: "PDEX", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "slate" },
  { id: "anderson_delivery", name: "Anderson Delivery", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "violet" },
  { id: "om_express", name: "OM Express", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "teal" },
  { id: "packers", name: "Packers", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "amber" },
  { id: "swift_express", name: "Swift Express", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "blue" },
  { id: "imir_logistics", name: "IMIR Logistics", engine: "ecotrack", family: "ecotrack", docStatus: "engine", tone: "emerald" },

  /* --------------------------- Indépendants / autres -------------------------- */
  // Plateformes propres : moteur non confirmé publiquement. Le connecteur
  // personnalisé permet de les brancher dès que le marchand a sa documentation.
  { id: "noest", name: "Noest", engine: "custom", family: "independent", docStatus: "unverified", tone: "slate" },
  { id: "maystro", name: "Maystro Delivery", engine: "custom", family: "independent", docStatus: "unverified", tone: "violet" },
  { id: "zimou_express", name: "Zimou Express", engine: "custom", family: "independent", docStatus: "unverified", tone: "amber" },
  { id: "colivraison", name: "Colivraison", engine: "custom", family: "independent", docStatus: "unverified", tone: "teal" },
  { id: "ecom_delivery", name: "E-COM Delivery", engine: "custom", family: "independent", docStatus: "unverified", tone: "blue" },
  { id: "elogistia", name: "Elogistia", engine: "custom", family: "independent", docStatus: "unverified", tone: "emerald" },
  { id: "near_delivery", name: "Near Delivery", engine: "custom", family: "independent", docStatus: "unverified", tone: "red" },
  { id: "mdm_express", name: "MDM Express", engine: "custom", family: "independent", docStatus: "unverified", tone: "slate" },
  { id: "navex", name: "Navex", engine: "custom", family: "independent", docStatus: "unverified", tone: "violet" },

  /* --------------------------------- Génériques ------------------------------- */
  { id: "custom", name: "Transporteur personnalisé", engine: "custom", family: "generic", docStatus: "public", tone: "slate", note: "Pour toute société non listée : saisissez vos propres URL et jeton." },
  { id: "sandbox", name: "Transporteur de test", engine: "sandbox", family: "generic", docStatus: "public", tone: "slate", note: "Simulateur local : aucun appel réseau, utile pour les démonstrations." },
] as const;

const BY_ID = new Map(CARRIERS.map((c) => [c.id, c]));

export function carrierById(id: string): Carrier | undefined {
  return BY_ID.get(id);
}

export function engineOf(providerId: string): DeliveryEngine {
  return BY_ID.get(providerId)?.engine ?? "custom";
}

export function capabilitiesForCarrier(providerId: string): Record<CarrierCapabilityKey, boolean> {
  return ENGINE_CAPABILITIES[engineOf(providerId)];
}

/**
 * Une société est « prête à l'emploi » quand son moteur est documenté
 * publiquement. Sinon l'interface demande explicitement les identifiants et la
 * documentation, plutôt que de laisser croire que l'intégration fonctionne.
 */
export function requiresDocumentation(providerId: string): boolean {
  return BY_ID.get(providerId)?.docStatus === "unverified";
}
