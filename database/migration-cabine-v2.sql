-- Bipbip Cabine v2 — validation admin, photo commercial, message LED, horodatage historique
-- À exécuter une fois dans le SQL Editor Supabase.

-- Photo du commercial (affichée dans le profil de l'app)
ALTER TABLE cabines ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500) NULL;

-- Horodatage de validation des commandes (pour l'historique : jour/date/heure)
ALTER TABLE cabine_orders ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ NULL;

-- Messages "LED" diffusés à toutes les cabines depuis l'espace admin
CREATE TABLE IF NOT EXISTS cabine_messages (
    id         BIGSERIAL PRIMARY KEY,
    message    TEXT NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cabine_messages_active ON cabine_messages(active, created_at);
ALTER TABLE cabine_messages ENABLE ROW LEVEL SECURITY;
