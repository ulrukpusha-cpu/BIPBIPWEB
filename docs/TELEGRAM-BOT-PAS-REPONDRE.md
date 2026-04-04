# Le bot Telegram ne répond pas aux commandes

## 1. Réenregistrer le webhook (obligatoire)

Le serveur doit **répondre 200 OK** tout de suite ; les commandes sont traitées après.  
Si le bot ne répond toujours pas, il faut que Telegram envoie bien les **messages** à ton serveur.

Sur le **VPS** (dans le dossier du projet) :

```bash
cd /root/var/www/BIPBIPWEB
```

Dans le fichier **.env**, vérifie ou ajoute :

- `TELEGRAM_BOT_TOKEN` = le token du bot qui doit répondre (celui de @BotFather)
- `WEBHOOK_BASE_URL` = l’URL publique du site (ex. `https://bipbiprecharge.ci`), **sans** slash final

Puis exécute :

```bash
node scripts/set-telegram-webhook.js
```

Tu dois voir : `OK — Webhook enregistré.`  
Cela enregistre l’URL du webhook **et** `allowed_updates: ['message', 'edited_message', 'callback_query']`, pour que Telegram envoie les commandes (/start, /aide, etc.) à ton serveur.

## 2. Vérifier que c’est le bon bot

Tu as peut-être **plusieurs bots** (ex. BIPBIPWEB et bipbip-bot).  
Le webhook ci-dessus est enregistré pour le bot dont le token est dans **TELEGRAM_BOT_TOKEN** du projet BIPBIPWEB.

Envoie tes commandes au **même** bot (celui dont le token est dans .env de BIPBIPWEB).  
Si tu parles à un autre bot, il ne passera pas par ce webhook.

## 3. Vérifier les logs

Quand tu envoies une commande au bot, sur le VPS :

```bash
pm2 logs BIPBIPWEB --lines 30
```

Tu devrais voir une ligne du type :  
`[Webhook] message chat_id= ... text= /start`

- Si tu ne vois **aucune** ligne en envoyant /start : Telegram n’envoie pas les mises à jour à ce serveur (mauvaise URL webhook ou mauvais bot).
- Si tu vois la ligne mais pas de réponse : regarde s’il y a une erreur juste après dans les logs.

## 4. Redémarrer l’app après modif

Après toute modification du code ou du .env :

```bash
pm2 restart BIPBIPWEB
```

Puis retester une commande (ex. /start).
