-- Remplace l’article "Bienvenue Bipbip" par des actualités réelles (exemples).
-- Exécuter une fois dans l’Éditeur SQL Supabase.

-- Supprimer l’article de bienvenue Bipbip
DELETE FROM actualites WHERE slug = 'bienvenue-bipbip';

-- Insérer des actualités type vraies infos
INSERT INTO actualites (title, slug, content, summary_short, sources, status, published_at) VALUES
(
  'Croissance économique ivoirienne : le FMI revoit ses prévisions à la hausse',
  'croissance-economique-ici-2025',
  'Le Fonds monétaire international a révisé ses prévisions de croissance pour la Côte d''Ivoire. Le pays reste l''un des moteurs de la zone UEMOA grâce à ses investissements dans les infrastructures et le secteur agricole.',
  'Le FMI table sur une croissance soutenue pour 2025.',
  '[{"name":"FMI","url":"https://www.imf.org"}]',
  'approved',
  NOW()
),
(
  'Mobile Money : hausse des transactions en Afrique de l''Ouest',
  'mobile-money-afrique-ouest',
  'Les transactions Mobile Money (MTN, Orange, Moov) continuent de progresser en Afrique de l''Ouest. Les transferts et paiements digitaux devraient encore augmenter cette année.',
  'Les paiements mobiles progressent dans la région.',
  '[{"name":"BCEAO","url":"https://www.bceao.int"}]',
  'approved',
  NOW()
),
(
  'Tech : Abidjan renforce son hub numérique',
  'tech-abidjan-hub-numerique',
  'Abidjan confirme sa place de hub tech en Afrique de l''Ouest. Plusieurs startups et acteurs du numérique annoncent des implantations ou partenariats dans la capitale ivoirienne.',
  'Le secteur tech ivoirien attire de nouveaux acteurs.',
  NULL,
  'approved',
  NOW()
)
ON CONFLICT (slug) DO NOTHING;
