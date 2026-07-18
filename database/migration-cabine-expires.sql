-- Bipbip Cabine — ajoute l'expiration des codes (générateur 1 mois)
-- À exécuter une fois dans le SQL Editor Supabase.
ALTER TABLE cabines ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_cabines_expires ON cabines(expires_at);
