-- ==================== BIPBIP - Transactions MTN MoMo (Supabase) ====================
-- À exécuter dans le SQL Editor du dashboard Supabase (après schema-supabase.sql).

CREATE TABLE IF NOT EXISTS momo_transactions (
    reference_id UUID PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'XOF',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    order_id VARCHAR(20) NULL,
    telegram_chat_id VARCHAR(50) NULL,
    failure_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_status CHECK (status IN ('PENDING', 'SUCCESSFUL', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_momo_status ON momo_transactions(status);
CREATE INDEX IF NOT EXISTS idx_momo_created_at ON momo_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_momo_order_id ON momo_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_momo_telegram_chat_id ON momo_transactions(telegram_chat_id);

-- Mise à jour automatique de updated_at
CREATE OR REPLACE FUNCTION update_momo_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_momo_updated_at ON momo_transactions;
CREATE TRIGGER trigger_momo_updated_at
    BEFORE UPDATE ON momo_transactions
    FOR EACH ROW EXECUTE PROCEDURE update_momo_updated_at();

-- RLS : sécurise l’accès (le backend avec service_role contourne le RLS)
ALTER TABLE momo_transactions ENABLE ROW LEVEL SECURITY;
