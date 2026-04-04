-- MySQL : exécuter une seule fois sur bipbip_recharge
ALTER TABLE orders ADD COLUMN payment_method VARCHAR(32) NULL;
