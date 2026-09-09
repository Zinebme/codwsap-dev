-- CODWSAP — grouped WhatsApp templates, automations and satisfaction evidence.
--
-- This migration is additive. It keeps the existing event/template contract
-- intact while giving the dashboard a stable business grouping and a durable
-- place for the 1–5 scores collected after delivery.

ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS template_group text DEFAULT 'confirmation';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS group_key text DEFAULT 'confirmation';

UPDATE whatsapp_templates
SET template_group = CASE
  WHEN event_key IN ('shipped_notice', 'at_office_notice', 'out_for_delivery_notice', 'no_response_reminder') THEN 'tracking'
  WHEN event_key IN ('delivered_thanks', 'satisfaction_request') OR name LIKE '%satisfaction%' THEN 'satisfaction'
  WHEN name IN ('delivery_failed', 'return_requested', 'order_returned', 'parcel_returned') THEN 'return'
  ELSE 'confirmation'
END
WHERE template_group IS NULL OR template_group = '';
UPDATE whatsapp_templates SET group_key = template_group WHERE group_key IS NULL OR group_key = '';
ALTER TABLE whatsapp_templates ALTER COLUMN template_group SET DEFAULT 'confirmation';
ALTER TABLE whatsapp_templates ALTER COLUMN group_key SET DEFAULT 'confirmation';
ALTER TABLE whatsapp_templates ALTER COLUMN template_group SET NOT NULL;
ALTER TABLE whatsapp_templates ALTER COLUMN group_key SET NOT NULL;

ALTER TABLE automations ADD COLUMN IF NOT EXISTS automation_group text DEFAULT 'tracking';
ALTER TABLE automations ADD COLUMN IF NOT EXISTS group_key text DEFAULT 'tracking';

UPDATE automations
SET automation_group = CASE
  WHEN type IN ('new_order_confirmation', 'reply_yes_confirm', 'reply_no_cancel') THEN 'confirmation'
  WHEN type IN ('delivered_thanks') THEN 'satisfaction'
  ELSE 'tracking'
END
WHERE automation_group IS NULL OR automation_group = '';
UPDATE automations SET group_key = automation_group WHERE group_key IS NULL OR group_key = '';
ALTER TABLE automations ALTER COLUMN automation_group SET DEFAULT 'tracking';
ALTER TABLE automations ALTER COLUMN group_key SET DEFAULT 'tracking';
ALTER TABLE automations ALTER COLUMN automation_group SET NOT NULL;
ALTER TABLE automations ALTER COLUMN group_key SET NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS satisfaction_score integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS satisfaction_comment text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS satisfaction_at timestamptz;

CREATE TABLE IF NOT EXISTS satisfaction_scores (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  order_id text REFERENCES orders(id) ON DELETE SET NULL,
  conversation_id text REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  message_id text REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  rating integer,
  comment text,
  source text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_satisfaction_scores_merchant ON satisfaction_scores(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_satisfaction_scores_customer ON satisfaction_scores(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_satisfaction_scores_order ON satisfaction_scores(order_id);

-- Keep the denormalised order columns useful for filters and exports.
UPDATE orders o
SET satisfaction_score = s.score,
    satisfaction_comment = s.comment,
    satisfaction_at = s.created_at
FROM satisfaction_scores s
WHERE s.order_id = o.id AND s.merchant_id = o.merchant_id;

ALTER TABLE satisfaction_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON satisfaction_scores;
CREATE POLICY tenant_isolation ON satisfaction_scores
  USING (app_is_member(merchant_id)) WITH CHECK (app_is_member(merchant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON satisfaction_scores TO codwsap_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codwsap_tenant;
