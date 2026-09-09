-- Repair the defaults applied by 0006. Known names take precedence over events.
-- Unknown custom templates retain merchant grouping. Only group columns change.
WITH classified AS (
  SELECT id, CASE
    WHEN name IN ('order_confirmation_request', 'order_confirmed', 'order_cancelled', 'order_postponed', 'confirmation_reminder') THEN 'confirmation'
    WHEN name IN ('order_preparing', 'order_shipped', 'order_in_transit', 'parcel_at_office', 'out_for_delivery', 'delivery_reminder') THEN 'tracking'
    WHEN name IN ('delivery_failed', 'return_requested', 'order_returned', 'returned_to_sender', 'return_followup', 'parcel_returned') THEN 'return'
    WHEN name IN ('order_delivered', 'delivered_thank_you', 'satisfaction_request', 'satisfaction_followup', 'satisfaction_thanks') THEN 'satisfaction'
    WHEN event_key IN ('new_order_confirmation', 'reply_yes_confirm', 'reply_no_cancel') THEN 'confirmation'
    WHEN event_key IN ('shipped_notice', 'at_office_notice', 'out_for_delivery_notice', 'no_response_reminder') THEN 'tracking'
    WHEN event_key IN ('delivered_thanks', 'satisfaction_request') THEN 'satisfaction'
    ELSE NULL
  END AS correct_group
  FROM whatsapp_templates
)
UPDATE whatsapp_templates AS t
SET template_group = c.correct_group, group_key = c.correct_group
FROM classified AS c
WHERE t.id = c.id AND c.correct_group IS NOT NULL
  AND (t.template_group IS DISTINCT FROM c.correct_group
    OR t.group_key IS DISTINCT FROM c.correct_group);
