# ⚡ Bipbip Recharge CI - Telegram Mini App

Application web de recharge mobile pour la Côte d'Ivoire, conçue comme une Mini App Telegram.

## 🚀 Fonctionnalités

- ✅ Choix d'opérateur (MTN, Orange, Moov)
- ✅ Sélection du montant (500, 1000, 2000, 5000 FCFA)
- ✅ Validation du numéro de téléphone
- ✅ Upload de preuve de paiement (image)
- ✅ Notifications Telegram à l'admin
- ✅ Panel admin pour valider les commandes
- ✅ Historique des commandes
- ✅ Design responsive mobile-first
- ✅ Thème sombre/clair automatique

## 📁 Structure

```
BIPBIPWEB/
├── index.html      # Page principale
├── styles.css      # Styles (thème sombre par défaut)
├── app.js          # Logique frontend
├── server.js       # Backend Express.js
├── package.json    # Dépendances
├── .env.example    # Variables d'environnement
└── README.md       # Documentation
```

## 🛠️ Installation

1. **Cloner ou télécharger le projet**

2. **Installer les dépendances**
```bash
npm install
```

3. **Configurer les variables d'environnement**
```bash
cp .env.example .env
# Éditer .env avec votre token Telegram
```

4. **Lancer le serveur**
```bash
npm start
# ou en mode développement
npm run dev
```

5. **Ouvrir dans le navigateur**
```
http://localhost:3000
```

## 🤖 Configuration Telegram

### Créer le bot
1. Parler à [@BotFather](https://t.me/BotFather)
2. Créer un nouveau bot avec `/newbot`
3. Copier le token dans `.env`

### Configurer la Mini App
1. Dans BotFather, utiliser `/mybots`
2. Sélectionner votre bot
3. Aller dans "Bot Settings" > "Menu Button"
4. Configurer l'URL de votre webapp

### Webhook (optionnel)
Pour recevoir les callbacks et les commandes (ex. /actualites), configure le webhook avec `allowed_updates` :
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://votre-domaine.com/api/telegram/webhook", "allowed_updates": ["message", "edited_message", "callback_query"]}'
```
Voir **docs/TELEGRAM-ACTUALITES.md** pour le dépannage de la commande /actualites.

## 🎨 Personnalisation

### Modifier les tarifs
Dans `app.js`, modifier la constante `CONFIG`:
```javascript
const CONFIG = {
    FRAIS_PERCENT: 5,  // Pourcentage de frais
    AMOUNTS: [500, 1000, 2000, 5000]  // Montants disponibles
};
```

### Modifier les couleurs
Dans `styles.css`, modifier les variables CSS:
```css
:root {
    --accent-primary: #e94560;
    --accent-secondary: #f39c12;
    /* ... */
}
```

## 📱 Accès Admin

Pour accéder au panel admin :
- **Raccourci clavier** : `Ctrl + Shift + A`
- **URL directe** : Ajouter `#admin` à l'URL

## 🔒 Sécurité

Pour la production, assurez-vous de :
1. Utiliser HTTPS
2. Valider les données utilisateur côté serveur
3. Implémenter une authentification pour l'API admin
4. Limiter les requêtes (rate limiting)

## 📄 API Endpoints

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/api/orders` | Créer une commande |
| GET | `/api/orders/:id` | Récupérer une commande |
| POST | `/api/orders/:id/proof` | Upload preuve (multipart) |
| POST | `/api/orders/:id/proof-base64` | Upload preuve (base64) |
| POST | `/api/admin/orders/:id/validate` | Valider une commande |
| POST | `/api/admin/orders/:id/reject` | Rejeter une commande |
| GET | `/api/admin/orders` | Liste des commandes |
| GET | `/api/admin/stats` | Statistiques |

## 🚀 Déploiement

### Vercel / Netlify (Frontend uniquement)
Déployer les fichiers `index.html`, `styles.css`, `app.js`

### Railway / Render / Heroku (Full stack)
1. Push le code sur GitHub
2. Connecter le repo au service
3. Configurer les variables d'environnement
4. Déployer

### VPS (DigitalOcean, OVH, etc.)
```bash
# Avec PM2
npm install -g pm2
pm2 start server.js --name bipbip
pm2 save
```

## 📞 Support

Pour toute question ou problème :
- Email : support_clients@bipbiprecharge.ci
- WhatsApp : +225 07 XX XX XX XX
- Telegram : https://t.me/bipbiprecharge_support

---

Made with ❤️ for Côte d'Ivoire
