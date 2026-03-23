-- Migration : colonne notes sur orders (pour promo likes/vues, lien YouTube/X)
-- À exécuter dans Supabase → Éditeur SQL

ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
COMMENT ON COLUMN orders.notes IS 'Note ou lien (ex: promo likes 250 F - lien chaîne YouTube/X)';
