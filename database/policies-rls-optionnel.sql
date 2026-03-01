-- ==================== POLICIES RLS (optionnel) ====================
-- À exécuter dans l'Éditeur SQL Supabase si tu veux réduire les "Info" du Security Advisor.
-- Ton backend utilise service_role donc il contourne le RLS ; ces policies servent si un jour
-- tu utilises la clé anon (ex. lecture depuis le navigateur) ou pour documenter les accès.

-- Lecture publique des actualités approuvées uniquement
CREATE POLICY "actualites_approved_read" ON public.actualites
  FOR SELECT USING (status = 'approved');

-- Lecture publique des annonces validées
CREATE POLICY "annonces_valides_read" ON public.annonces
  FOR SELECT USING (statut = 'valide');

-- Lecture publique des messages LED actifs
CREATE POLICY "led_messages_active_read" ON public.led_messages
  FOR SELECT USING (is_active = true);

-- Lecture publique des quêtes actives
CREATE POLICY "quests_active_read" ON public.quests
  FOR SELECT USING (is_active = true);

-- orders, momo_transactions, user_quests : pas de policy = accès uniquement via service_role (backend).
-- C'est voulu : les commandes et paiements ne doivent pas être lisibles par le public.
