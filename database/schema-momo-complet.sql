-- ==================== BIPBIP - Table MTN MoMo (Supabase) ====================
-- À exécuter dans le SQL Editor Supabase. Crée la table si elle n'existe pas
-- et ajoute la colonne annonce_id (pour paiement des annonces LED).

-- 1. Créer la table si elle n'existe pas (avec annonce_id)
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

-- 2. Si la table existait déjà (sans annonce_id), ajouter la colonne
ALTER TABLE momo_transactions
ADD COLUMN IF NOT EXISTS annonce_id UUID NULL;

-- 3. Index
CREATE INDEX IF NOT EXISTS idx_momo_status ON momo_transactions(status);
CREATE INDEX IF NOT EXISTS idx_momo_created_at ON momo_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_momo_order_id ON momo_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_momo_telegram_chat_id ON momo_transactions(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_momo_annonce_id ON momo_transactions(annonce_id);

-- 4. Mise à jour automatique de updated_at (search_path fixé pour Security Advisor)
CREATE OR REPLACE FUNCTION public.update_momo_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_momo_updated_at ON momo_transactions;
CREATE TRIGGER trigger_momo_updated_at
    BEFORE UPDATE ON momo_transactions
    FOR EACH ROW EXECUTE PROCEDURE update_momo_updated_at();

-- 5. RLS (le backend avec service_role contourne le RLS)
ALTER TABLE momo_transactions ENABLE ROW LEVEL SECURITY;
