# VPS + Supabase – À ne pas oublier

## Contexte

- **Première version du projet** : tourne sur un **VPS** et est **déjà connectée à Supabase**.
- **Ce dépôt (BIPBIPWEB)** : version locale / en cours de dev, connectée au **même** projet Supabase (BIPBIPWEB, ref `ubbgtnbmhdgcrikuhadz`).

## Conséquences

1. **Même base Supabase** : les données (commandes, `orders`, `momo_transactions`, `actualites`, `annonces`, etc.) sont **partagées** entre le VPS et l’environnement local / nouvelle version.
2. **Schémas SQL** : toute migration ou script exécuté (Éditeur SQL ou `run-momo-schema.js`) s’applique à la **même** base que celle utilisée par le VPS. Faire attention aux `DROP`, `ALTER` ou changements de structure.
3. **Variables d’environnement** :
   - **VPS** : son `.env` doit garder les bonnes valeurs (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, etc.) pour ce projet Supabase.
   - **Local** : le `.env` de ce repo pointe aussi vers ce projet ; les tests locaux modifient les **vraies** données tant qu’on n’a pas de projet Supabase dédié au dev.
4. **SUPABASE_DB_URL** : utilisée uniquement pour les scripts locaux (ex. `run-momo-schema.js`). Le VPS n’a pas besoin de cette variable pour faire tourner l’app (il utilise l’API Supabase avec URL + clés).

## Recommandations

- Avant un **changement de schéma** (nouvelles tables, colonnes, index), vérifier l’impact sur l’app qui tourne sur le VPS.
- Pour éviter de mélanger dev et prod : envisager un **deuxième projet Supabase** (ex. BIPBIPWEB-dev) pour le développement, et garder le projet actuel pour le VPS / prod.
- Lors des mises à jour du code sur le VPS : déployer en cohérence avec l’état des tables Supabase (migrations déjà exécutées ou à prévoir sur le VPS).

---
*Dernière mise à jour : rappel que la v1 tourne sur VPS et utilise Supabase.*
