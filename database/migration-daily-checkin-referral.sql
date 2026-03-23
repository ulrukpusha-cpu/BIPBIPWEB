-- Daily check-in (streak 7 jours) + parrainage
-- À exécuter dans Supabase → Éditeur SQL

ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS last_checkin_at DATE;
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS checkin_streak INT NOT NULL DEFAULT 0;
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS referred_by BIGINT REFERENCES telegram_users(telegram_id);

COMMENT ON COLUMN telegram_users.last_checkin_at IS 'Dernière date de check-in (daily reward)';
COMMENT ON COLUMN telegram_users.checkin_streak IS 'Série de jours consécutifs (0-7, réinitialisée après 7 ou si jour manqué)';
COMMENT ON COLUMN telegram_users.referral_code IS 'Code parrain unique (pour lien d''invitation)';
COMMENT ON COLUMN telegram_users.referred_by IS 'telegram_id du parrain (si inscrit via lien)';

CREATE INDEX IF NOT EXISTS idx_telegram_users_referral_code ON telegram_users(referral_code);
CREATE INDEX IF NOT EXISTS idx_telegram_users_referred_by ON telegram_users(referred_by);
