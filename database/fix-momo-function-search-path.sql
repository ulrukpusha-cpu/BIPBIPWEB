-- Corrige l'avertissement Security Advisor : "Function Search Path Mutable"
-- Exécuter dans l'Éditeur SQL Supabase

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
