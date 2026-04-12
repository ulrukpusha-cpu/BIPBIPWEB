-- Table des utilisateurs Telegram (inscription automatique à l'ouverture de la Mini App)
-- À exécuter dans Supabase : Éditeur SQL → Nouvelle requête → Coller → Run

CREATE TABLE IF NOT EXISTS telegram_users (
    telegram_id BIGINT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT,
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Colonne Google Sign-In (utilisateurs navigateur connectés via Google)
-- ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS google_id TEXT;
-- CREATE INDEX IF NOT EXISTS idx_telegram_users_google_id ON telegram_users(google_id);

-- Index pour recherche par username (optionnel)
CREATE INDEX IF NOT EXISTS idx_telegram_users_username ON telegram_users(username);

-- RLS : seul le backend (service_role) doit accéder à cette table.
-- Aucune politique pour anon = pas d'accès depuis le client. Le backend utilise service_role (bypasse RLS).
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE telegram_users IS 'Utilisateurs enregistrés à l''ouverture de la Mini App Telegram (ID + photo de profil).';
