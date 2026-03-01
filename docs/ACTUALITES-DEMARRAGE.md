# Démarrer les actualités

## 1. Créer les tables dans Supabase

Dans **Supabase** → **Éditeur SQL**, exécute le contenu du fichier :

**`database/schema-actualites-annonces-quests.sql`**

Cela crée les tables : `actualites`, `annonces`, `led_messages`, `quests`, `user_quests`.

---

## 2. Ajouter une première actualité (test)

### Option A : Via l’Éditeur SQL Supabase

Colle et exécute :

```sql
INSERT INTO actualites (title, slug, content, summary_short, status, published_at)
VALUES (
  'Bienvenue sur Bipbip Recharge',
  'bienvenue-bipbip',
  'Bipbip Recharge vous permet de recharger votre crédit mobile rapidement. MTN, Orange, Moov en Côte d''Ivoire.',
  'Rechargez en un clic.',
  'approved',
  NOW()
);
```

### Option B : Via le cron (article en attente, puis validation admin)

En ligne de commande :

```bash
node cron/generateNews.js
```

Puis valider l’actualité via l’API admin (avec ta clé) :

```http
POST http://localhost:3000/api/actualites/admin/:id/approve
Header: X-Admin-Key: BipbipWeb_Admin_Secret_2025
```

(Remplace `:id` par l’id de l’actualité créée, visible dans la table `actualites`.)

---

## 3. Vérifier sur l’app

1. Démarre le serveur : `node server.js`
2. Ouvre http://localhost:3000
3. Va dans **Actualités** (barre du bas)
4. Tu dois voir la section **Actualités IA** avec l’article.

---

## 4. (Optionnel) Quêtes

Pour afficher les quêtes, exécute aussi :

**`database/seed-quests.sql`**

dans l’Éditeur SQL Supabase.
