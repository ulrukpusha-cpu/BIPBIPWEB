-- Bipbip Cabine — candidatures KYC des commerciaux (bouton "Postuler" de l'APK)
-- À exécuter une fois dans le SQL Editor Supabase.
CREATE TABLE IF NOT EXISTS cabine_candidatures (
    id            BIGSERIAL PRIMARY KEY,
    nom           VARCHAR(120) NOT NULL,          -- nom complet
    telephone     VARCHAR(20) NOT NULL,
    date_naissance VARCHAR(20) NULL,
    commune       VARCHAR(120) NULL,              -- commune / quartier de la cabine
    piece_type    VARCHAR(30) NULL,               -- CNI | passeport | attestation
    piece_numero  VARCHAR(60) NULL,
    piece_url     VARCHAR(500) NULL,              -- photo de la pièce
    selfie_url    VARCHAR(500) NULL,              -- photo du commercial
    status        VARCHAR(20) NOT NULL DEFAULT 'en_attente', -- en_attente | approuve | rejete
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cabine_cand_status ON cabine_candidatures(status);
ALTER TABLE cabine_candidatures ENABLE ROW LEVEL SECURITY;
