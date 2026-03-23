-- Ajout colonne category sur actualites pour filtrage par rubrique
-- Valeurs : region, finance, tech, mode (ou NULL = non catégorisé)
-- À exécuter dans Supabase → SQL Editor

ALTER TABLE actualites ADD COLUMN IF NOT EXISTS category VARCHAR(20) NULL;
CREATE INDEX IF NOT EXISTS idx_actualites_category ON actualites(category);
COMMENT ON COLUMN actualites.category IS 'Rubrique : region, finance, tech, mode';

-- Catégoriser les articles existants via mots-clés dans le titre
UPDATE actualites SET category = 'region' WHERE category IS NULL AND (
    lower(title) SIMILAR TO '%(côte d''ivoire|ivoire|abidjan|cameroun|sénégal|afrique|uemoa|cedeao|gouvernement|président|politique|élection|sénat|ministre|mali|burkina|guinée|togo|bénin|niger|congo|gabon|maroc|algérie|tunisie|kenya|nigeria|soudan|rdc|tchad)%'
    OR lower(summary_short) SIMILAR TO '%(côte d''ivoire|ivoire|abidjan|cameroun|sénégal|afrique|uemoa|cedeao|gouvernement|président|politique|sénat|ministre)%'
);

UPDATE actualites SET category = 'finance' WHERE category IS NULL AND (
    lower(title) SIMILAR TO '%(crypto|bitcoin|ethereum|blockchain|bourse|trading|finance|banque|monnaie|fcfa|dollar|inflation|fmi|dette|fintech|minage|airdrop|staking|investiss)%'
    OR lower(summary_short) SIMILAR TO '%(crypto|bitcoin|blockchain|bourse|trading|finance|banque|monnaie|inflation|fmi|dette)%'
);

UPDATE actualites SET category = 'tech' WHERE category IS NULL AND (
    lower(title) SIMILAR TO '%(technologie|innovation|intelligence artificielle|startup|smartphone|application|logiciel|robot|spacex|tesla|apple|google|microsoft|openai|chatgpt|satellite|5g|cybersécurité|cloud|nvidia|samsung)%'
    OR lower(summary_short) SIMILAR TO '%(technologie|innovation|intelligence artificielle|startup|smartphone|robot|satellite|cybersécurité)%'
);

UPDATE actualites SET category = 'mode' WHERE category IS NULL AND (
    lower(title) SIMILAR TO '%(artiste|musique|concert|festival|célébrité|fashion|film|cinéma|série|album|rap|afrobeat|coupé-décalé|grammy|football|champion|ballon d''or|ligue|coupe|can 20|acteur|actrice|chanteur)%'
    OR lower(summary_short) SIMILAR TO '%(artiste|musique|concert|festival|film|cinéma|football|champion|can 20)%'
);

-- Les articles restants (NULL) = region par défaut (sources actuelles sont africaines)
UPDATE actualites SET category = 'region' WHERE category IS NULL;
