-- ==================== BIPBIP RECHARGE CI - Schéma Supabase (PostgreSQL) ====================
-- À exécuter dans l'éditeur SQL du dashboard Supabase (SQL Editor).

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

-- RLS : sécurise l’accès (le backend avec service_role contourne le RLS)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
