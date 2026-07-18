-- ==================== BIPBIP CABINE (Commercial / Kbine) — Schéma Supabase ====================
-- À exécuter dans l'éditeur SQL du dashboard Supabase (SQL Editor).
-- N'altère AUCUNE table existante : ajoute uniquement cabines / cabine_orders / cabine_deposits.

-- ---- Commerciaux (1 code = 1 cabine) -------------------------------------
CREATE TABLE IF NOT EXISTS cabines (
    id               BIGSERIAL PRIMARY KEY,
    code             VARCHAR(40) NOT NULL UNIQUE,        -- code d'accès saisi par le commercial
    nom_cabine       VARCHAR(120) NOT NULL,
    actif            BOOLEAN NOT NULL DEFAULT TRUE,
    commission_hebdo INT NOT NULL DEFAULT 10000,         -- FCFA versés en fin de semaine si objectif atteint
    bonus_taux       NUMERIC NOT NULL DEFAULT 0,         -- FCFA par commande de surplus (bonus mensuel)
    tx_since_deposit INT NOT NULL DEFAULT 0,             -- nb de ventes depuis le dernier dépôt Wave (0..5)
    locked           BOOLEAN NOT NULL DEFAULT FALSE,     -- opérateurs bloqués (plafond atteint)
    commandes_semaine INT NOT NULL DEFAULT 0,            -- commandes de la semaine courante (objectif /30)
    surplus_mensuel  INT NOT NULL DEFAULT 0,             -- cumul des commandes > 30 du mois
    montant_du       INT NOT NULL DEFAULT 0,             -- total net des ventes depuis le dernier dépôt
    semaine_courante VARCHAR(8) NULL,                    -- "ISO année-semaine" ex: 2026-W23
    mois_courant     VARCHAR(7) NULL,                    -- "YYYY-MM" ex: 2026-06
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cabines_code ON cabines(code);

-- ---- Commandes passées par les commerciaux -------------------------------
CREATE TABLE IF NOT EXISTS cabine_orders (
    id           BIGSERIAL PRIMARY KEY,
    cabine_code  VARCHAR(40) NOT NULL,
    operator     VARCHAR(20) NOT NULL,                  -- orange | mtn | moov
    type         VARCHAR(10) NOT NULL DEFAULT 'credit', -- credit | bundle
    recipient    VARCHAR(20) NOT NULL,                  -- numéro du client
    amount       INT NOT NULL DEFAULT 0,                -- montant net (crédit) ou prix du forfait
    bundle_id    VARCHAR(60) NULL,
    bundle_type  VARCHAR(10) NULL,                      -- data | mix
    gateway_ref  VARCHAR(80) NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',-- pending | ok | failed
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cabine_orders_code ON cabine_orders(cabine_code);
CREATE INDEX IF NOT EXISTS idx_cabine_orders_created ON cabine_orders(created_at);

-- ---- Versements Wave (déblocage du plafond) ------------------------------
CREATE TABLE IF NOT EXISTS cabine_deposits (
    id           BIGSERIAL PRIMARY KEY,
    cabine_code  VARCHAR(40) NOT NULL,
    montant      INT NOT NULL,                          -- montant déclaré (= total net des ventes)
    preuve_url   VARCHAR(500) NULL,                     -- capture envoyée par le commercial
    status       VARCHAR(20) NOT NULL DEFAULT 'en_attente', -- en_attente | confirme | rejete
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_cabine_deposits_code ON cabine_deposits(cabine_code);
CREATE INDEX IF NOT EXISTS idx_cabine_deposits_status ON cabine_deposits(status);

-- RLS : le backend (service_role) contourne le RLS. On l'active sans policy publique.
ALTER TABLE cabines ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabine_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabine_deposits ENABLE ROW LEVEL SECURITY;

-- ---- Seed : un code de démo (à supprimer/éditer en prod) -----------------
INSERT INTO cabines (code, nom_cabine, commission_hebdo)
VALUES ('KBINE01', 'KBINE Démo', 10000)
ON CONFLICT (code) DO NOTHING;
