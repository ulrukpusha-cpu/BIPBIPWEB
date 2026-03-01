-- Lier les paiements MoMo aux annonces (pour annonces payantes).
-- Exécuter dans Supabase après schema-momo-supabase.sql

ALTER TABLE momo_transactions
ADD COLUMN IF NOT EXISTS annonce_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_momo_annonce_id ON momo_transactions(annonce_id);
