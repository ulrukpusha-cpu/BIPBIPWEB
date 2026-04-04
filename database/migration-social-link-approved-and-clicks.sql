-- Liens YouTube/X approuvés → affichés dans l'espace Quêtes ; clic = points (1 clic par user/lien)
-- À exécuter dans Supabase → Éditeur SQL

ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS social_link_approved BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN telegram_users.social_link_approved IS 'Lien social approuvé par admin → visible dans Quêtes, clic = points';

-- Enregistrement des clics pour ne créditer qu''une fois par utilisateur par lien
CREATE TABLE IF NOT EXISTS user_link_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    link_owner_telegram_id BIGINT NOT NULL,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, link_owner_telegram_id)
);
CREATE INDEX IF NOT EXISTS idx_user_link_clicks_user ON user_link_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_link_clicks_owner ON user_link_clicks(link_owner_telegram_id);
COMMENT ON TABLE user_link_clicks IS 'Un clic par (user_id, link_owner) pour attribution des points';
