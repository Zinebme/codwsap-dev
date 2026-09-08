-- CODWSAP — complétion WhatsApp Cloud API.
--
-- 1) Les messages sortants basés sur un template portent désormais les VALEURS
--    ordonnées de ses variables (JSON). L'API Cloud Meta exige des paramètres
--    positionnels dans le composant « body » : sans eux, un modèle à variables
--    est rejeté ou envoyé incomplet. Jusqu'ici les paramètres étaient envoyés
--    vides et seul le corps rendu localement était fiable.
--
-- Migration additive : aucune migration déjà appliquée n'est modifiée.

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS template_variables text;
