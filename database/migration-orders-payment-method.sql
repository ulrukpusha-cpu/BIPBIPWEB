-- Supabase / PostgreSQL : mode de paiement à l’envoi de preuve (USDT, USDC, TON, Djamo, MoMo)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
