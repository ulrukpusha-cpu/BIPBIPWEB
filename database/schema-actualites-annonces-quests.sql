-- ==================== BIPBIP - Actualités, Annonces, LED, Quêtes (Supabase) ====================
-- Exécuter dans le SQL Editor Supabase après schema-supabase.sql

-- Actualités (générées IA ou manuelles, validation admin)
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

-- Annonces payantes (200 car max, modération IA, grille 50-500F)
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

-- Messages bandeau LED (injection depuis annonces validées)
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

-- Quêtes (gamification)
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
