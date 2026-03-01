-- =============================================================================
-- BIPBIP - TOUS LES SCHÉMAS SUPABASE (à copier dans l'Éditeur SQL)
-- Tu peux exécuter tout le fichier ou copier section par section.
-- Après Run, clique sur "Save" pour enregistrer dans PRIVATE.
-- =============================================================================

-- ##############################################################################
-- PARTIE 1 : BIPBIP RECHARGE CI - Schéma Supabase (PostgreSQL) - Table orders
-- Nom à utiliser dans PRIVATE : "Orders table for recharge transactions"
-- ##############################################################################

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(20) PRIMARY KEY,
    user_id VARCHAR(50) NULL,
    username VARCHAR(100) NULL,
    operator VARCHAR(20) NOT NULL,
    amount INT NOT NULL,
    amount_total INT NOT NULL,
    phone VARCHAR(20) NOT NULL,
    proof VARCHAR(500) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validated_at TIMESTAMPTZ NULL,
    rejected_at TIMESTAMPTZ NULL,
    reject_reason TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;


-- ##############################################################################
-- PARTIE 2 : MTN MoMo - Table momo_transactions
-- Nom à utiliser dans PRIVATE : "MTN MoMo - momo_transactions"
-- ##############################################################################

CREATE TABLE IF NOT EXISTS momo_transactions (
    reference_id UUID PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'XOF',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    order_id VARCHAR(64) NULL,
    telegram_chat_id VARCHAR(50) NULL,
    annonce_id UUID NULL,
    failure_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_status CHECK (status IN ('PENDING', 'SUCCESSFUL', 'FAILED'))
);

ALTER TABLE momo_transactions ADD COLUMN IF NOT EXISTS annonce_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_momo_status ON momo_transactions(status);
CREATE INDEX IF NOT EXISTS idx_momo_created_at ON momo_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_momo_order_id ON momo_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_momo_telegram_chat_id ON momo_transactions(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_momo_annonce_id ON momo_transactions(annonce_id);

CREATE OR REPLACE FUNCTION public.update_momo_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_momo_updated_at ON momo_transactions;
CREATE TRIGGER trigger_momo_updated_at
    BEFORE UPDATE ON momo_transactions
    FOR EACH ROW EXECUTE PROCEDURE update_momo_updated_at();

ALTER TABLE momo_transactions ENABLE ROW LEVEL SECURITY;


-- ##############################################################################
-- PARTIE 3 : Actualités, Annonces, LED, Quêtes + première actualité + seed quêtes
-- Nom à utiliser dans PRIVATE : "Schéma Actualités, Annonces & Quêtes (avec données)"
-- ##############################################################################

CREATE TABLE IF NOT EXISTS actualites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    content TEXT NOT NULL,
    summary_short VARCHAR(500) NULL,
    sources TEXT NULL,
    ai_score DECIMAL(5,2) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('draft','pending','approved','rejected')),
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_actualites_status ON actualites(status);
CREATE INDEX IF NOT EXISTS idx_actualites_published ON actualites(published_at);

CREATE TABLE IF NOT EXISTS annonces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(50) NOT NULL,
    contenu VARCHAR(255) NOT NULL,
    prix INT NOT NULL CHECK (prix IN (50, 100, 150, 300, 500)),
    nombre_diffusion INT NOT NULL DEFAULT 5,
    diffusions_restantes INT NOT NULL DEFAULT 5,
    statut VARCHAR(20) NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','valide','refuse')),
    ai_moderation_result VARCHAR(50) NULL,
    position_actualite VARCHAR(20) NULL DEFAULT 'normal',
    date_creation TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date_validation TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_annonces_user ON annonces(user_id);
CREATE INDEX IF NOT EXISTS idx_annonces_statut ON annonces(statut);

CREATE TABLE IF NOT EXISTS led_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    annonce_id UUID NULL REFERENCES annonces(id) ON DELETE SET NULL,
    content VARCHAR(500) NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_led_active ON led_messages(is_active);

CREATE TABLE IF NOT EXISTS quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    titre VARCHAR(255) NOT NULL,
    description TEXT NULL,
    type VARCHAR(50) NULL,
    points_reward INT NOT NULL DEFAULT 0,
    target_value INT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(50) NOT NULL,
    quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    progress INT NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ NULL,
    UNIQUE(user_id, quest_id)
);
CREATE INDEX IF NOT EXISTS idx_user_quests_user ON user_quests(user_id);

ALTER TABLE actualites ENABLE ROW LEVEL SECURITY;
ALTER TABLE annonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE led_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quests ENABLE ROW LEVEL SECURITY;

INSERT INTO actualites (title, slug, content, summary_short, status, published_at)
VALUES (
  'Bienvenue sur Bipbip Recharge',
  'bienvenue-bipbip',
  'Bipbip Recharge vous permet de recharger votre crédit mobile rapidement. MTN, Orange, Moov en Côte d''Ivoire. Rechargez en un clic, 24h/24.',
  'Rechargez en un clic.',
  'approved',
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO quests (code, titre, description, type, points_reward, target_value, is_active) VALUES
('recharges_semaine', '3 recharges cette semaine', 'Effectuez 3 recharges dans la semaine pour gagner des points.', 'recharge', 50, 3, true),
('annonce_publiee', '1 annonce publiée', 'Publiez une annonce validée dans le bandeau LED.', 'annonce', 20, 1, true),
('inviter_ami', 'Inviter 1 ami', 'Invitez un ami à rejoindre Bipbip Recharge.', 'referral', 100, 1, true),
('lire_5_articles', 'Lire 5 articles', 'Lisez 5 articles de la section Actualités.', 'reading', 10, 5, true)
ON CONFLICT (code) DO NOTHING;
