-- Seed des quêtes (exemples) - exécuter après schema-actualites-annonces-quests.sql
INSERT INTO quests (code, titre, description, type, points_reward, target_value, is_active) VALUES
('recharges_semaine', '3 recharges cette semaine', 'Effectuez 3 recharges dans la semaine pour gagner des points.', 'recharge', 50, 3, true),
('annonce_publiee', '1 annonce publiée', 'Publiez une annonce validée dans le bandeau LED.', 'annonce', 20, 1, true),
('inviter_ami', 'Inviter 1 ami', 'Invitez un ami à rejoindre Bipbip Recharge.', 'referral', 100, 1, true),
('lire_5_articles', 'Lire 5 articles', 'Lisez 5 articles de la section Actualités.', 'reading', 10, 5, true)
ON CONFLICT (code) DO NOTHING;
