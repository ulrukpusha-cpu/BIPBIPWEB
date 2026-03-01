# Réenregistrer les scripts dans l’Éditeur SQL Supabase (PRIVATE)

Les 2 requêtes vides dans PRIVATE peuvent être remplacées par les vrais scripts. Voici comment les réajouter.

---

## Option A : Un seul fichier (tout en un)

1. Ouvre **`database/SUPABASE-TOUS-LES-SCHEMAS.sql`** dans ton projet.
2. Copie **tout** le contenu (Ctrl+A, Ctrl+C).
3. Dans Supabase → **Éditeur SQL**, clique sur **+** (nouvelle requête).
4. Colle le SQL (Ctrl+V).
5. Clique sur **Run** pour exécuter.
6. Clique sur **Save** (Enregistrer) et donne un nom, ex. **« BIPBIP - Tous les schémas »**.
7. La requête apparaît dans **PRIVATE** avec le bon contenu.

---

## Option B : 3 requêtes séparées (comme avant)

Tu peux recréer 3 requêtes PRIVATE en copiant **une partie** du fichier à chaque fois.

### 1. Orders (commandes recharge)

- Ouvre **`database/schema-supabase.sql`**.
- Copie tout → Nouvelle requête dans Supabase → Colle → **Run** → **Save** : nomme **« Orders table for recharge transactions »**.

### 2. MTN MoMo

- Ouvre **`database/schema-momo-complet.sql`**.
- Copie tout → Nouvelle requête → Colle → **Run** → **Save** : nomme **« MTN MoMo - momo_transactions »**.

### 3. Actualités + Annonces + Quêtes

- Ouvre **`database/actualites-setup-complet.sql`**.
- Copie tout → Nouvelle requête → Colle → **Run** → **Save** : nomme **« Schéma Actualités, Annonces & Quêtes (avec données) »**.

---

## Nettoyer les anciennes requêtes vides

Dans Supabase, dans **PRIVATE** :

- Ouvre les 2 requêtes vides.
- Supprime-les (icône poubelle ou menu de la requête) si l’interface le permet.

Comme ça tu gardes seulement les requêtes avec du vrai SQL (soit 1 fichier « Tous les schémas », soit 3 requêtes séparées).
