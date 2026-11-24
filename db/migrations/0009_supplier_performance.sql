-- When the supplier first responded to a purchase order (acknowledgement or direct dispatch),
-- used for the advisory supplier performance score.
alter table supplier_purchase_orders add column acknowledged_at timestamptz;
