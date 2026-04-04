-- Migration : points + lien YouTube/X pour telegram_users
-- À exécuter dans Supabase → Éditeur SQL

ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 0;
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS social_link TEXT;

COMMENT ON COLUMN telegram_users.points IS 'Points du client (quêtes, recharges, etc.)';
COMMENT ON COLUMN telegram_users.social_link IS 'Lien chaîne YouTube ou compte X pour la promo likes/vues';
