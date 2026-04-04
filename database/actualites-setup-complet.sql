-- ==================== BIPBIP - Actualités : schéma + première actualité ====================
-- À exécuter en une fois dans Supabase > Éditeur SQL

-- 1. Tables (si pas déjà fait)
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

-- 2. Actualités (exemples type vraies infos – à remplacer par l’IA ou tes sources)
INSERT INTO actualites (title, slug, content, summary_short, sources, status, published_at) VALUES
(
  'Croissance économique ivoirienne : le FMI revoit ses prévisions à la hausse',
  'croissance-economique-ici-2025',
  'Le Fonds monétaire international a révisé ses prévisions de croissance pour la Côte d''Ivoire. Le pays reste l''un des moteurs de la zone UEMOA grâce à ses investissements dans les infrastructures et le secteur agricole.',
  'Le FMI table sur une croissance soutenue pour 2025.',
  '[{"name":"FMI","url":"https://www.imf.org"}]',
  'approved',
  NOW()
),
(
  'Mobile Money : hausse des transactions en Afrique de l''Ouest',
  'mobile-money-afrique-ouest',
  'Les transactions Mobile Money (MTN, Orange, Moov) continuent de progresser en Afrique de l''Ouest. Les transferts et paiements digitaux devraient encore augmenter cette année.',
  'Les paiements mobiles progressent dans la région.',
  '[{"name":"BCEAO","url":"https://www.bceao.int"}]',
  'approved',
  NOW()
),
(
  'Tech : Abidjan renforce son hub numérique',
  'tech-abidjan-hub-numerique',
  'Abidjan confirme sa place de hub tech en Afrique de l''Ouest. Plusieurs startups et acteurs du numérique annoncent des implantations ou partenariats dans la capitale ivoirienne.',
  'Le secteur tech ivoirien attire de nouveaux acteurs.',
  NULL,
  'approved',
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- 3. Quêtes (exemples)
INSERT INTO quests (code, titre, description, type, points_reward, target_value, is_active) VALUES
('recharges_semaine', '3 recharges cette semaine', 'Effectuez 3 recharges dans la semaine pour gagner des points.', 'recharge', 50, 3, true),
('annonce_publiee', '1 annonce publiée', 'Publiez une annonce validée dans le bandeau LED.', 'annonce', 20, 1, true),
('inviter_ami', 'Inviter 1 ami', 'Invitez un ami à rejoindre Bipbip Recharge.', 'referral', 100, 1, true),
('lire_5_articles', 'Lire 5 articles', 'Lisez 5 articles de la section Actualités.', 'reading', 10, 5, true)
ON CONFLICT (code) DO NOTHING;
