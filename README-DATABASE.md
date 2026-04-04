# Base de données – Bipbip Recharge CI

Le projet peut stocker les commandes dans un **fichier JSON** (par défaut), **Supabase** (PostgreSQL hébergé) ou **MySQL**.

## Par défaut : fichier JSON

Sans configuration de base, les commandes sont enregistrées dans `data/orders.json`. Aucune installation supplémentaire n’est nécessaire.

## Utiliser Supabase (recommandé)

Supabase fournit une base PostgreSQL hébergée (gratuit en petit volume), un tableau de bord et des sauvegardes.

### 1. Créer un projet Supabase

- Va sur [supabase.com](https://supabase.com), crée un compte et un nouveau projet.
- Dans **Project Settings → API** : note l’**URL** du projet et la clé **service_role** (secrète, pour le serveur uniquement).

### 2. Créer la table `orders`

Dans le dashboard Supabase, ouvre **SQL Editor** et exécute le contenu du fichier `database/schema-supabase.sql`.

### 3. Configurer le projet

Dans ton `.env` (copie depuis `.env.example` si besoin) :

```env
USE_SUPABASE=true
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 4. Installer et lancer

```bash
npm install
npm start
```

Au démarrage tu dois voir : `[Storage] Supabase activé`.

## Utiliser MySQL

### 1. Créer la base et les tables

Sur votre serveur MySQL (local ou distant), exécutez le script :

```bash
mysql -u root -p < database/schema.sql
```

Ou ouvrez `database/schema.sql` et exécutez son contenu dans MySQL (phpMyAdmin, DBeaver, etc.). Le script crée la base `bipbip_recharge` et la table `orders`.

### 2. Configurer les variables d’environnement

Dans votre fichier `.env` (copiez depuis `.env.example` si besoin), ajoutez ou décommentez :

```env
USE_MYSQL=true
DB_HOST=localhost
DB_PORT=3306
DB_USER=votre_utilisateur
DB_PASSWORD=votre_mot_de_passe
DB_NAME=bipbip_recharge
```

- **DB_HOST** : `localhost` en local, ou l’adresse de votre serveur MySQL (ex. IP du VPS).
- **DB_USER** / **DB_PASSWORD** : identifiants MySQL.
- **DB_NAME** : nom de la base (par défaut `bipbip_recharge`).

### 3. Installer la dépendance MySQL

```bash
npm install
```

Le projet utilise déjà `mysql2` dans `package.json`.

### 4. Démarrer le serveur

```bash
npm start
```

Au démarrage, vous devriez voir soit :

- `[Storage] MySQL activé (bipbip_recharge)` → les commandes sont stockées en MySQL.
- `[Storage] Fichier JSON (data/orders.json)` → pas de MySQL ou config manquante, utilisation du fichier.

## Résumé

| Priorité | Condition | Stockage utilisé |
|----------|-----------|-------------------|
| 1 | `USE_SUPABASE=true` **et** `SUPABASE_URL` + clé renseignés | Supabase (PostgreSQL) |
| 2 | `USE_MYSQL=true` **et** `DB_USER` + `DB_PASSWORD` renseignés | MySQL |
| 3 | Sinon | Fichier `data/orders.json` |

Les preuves de paiement (images) restent toujours dans le dossier `uploads/`, quel que soit le stockage des commandes.
