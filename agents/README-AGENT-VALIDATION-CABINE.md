# 🤖 Agent Validation Cabine — réseau Kbine physique

Pendant « cabine » de `/opt/bipbip-validation-agent` (qui valide, lui, les commandes
de l'app grand public à partir des preuves Wave).

| | |
|---|---|
| Script | `agents/agent-validation-cabine.js` |
| pm2 | `bipbip-cabine-validation` (`ecosystem-cabine-validation.config.js`) |
| Bot d'alerte | **@Kbineadbot** (`TELEGRAM_BOT_TOKEN_CABINE`) |
| API | `/api/cabine/admin/*` en local, header `X-Admin-Key: CABINE_ADMIN_KEY` |
| État | `agents/state-validation-cabine.json` |

## Ce qu'il fait

À chaque cycle (60 s par défaut) :

1. **Commandes** — `GET /admin/orders` (statut `pending`) → décision
   `auto_validate` / `manual_review` / `reject`.
   `auto_validate` ⇒ `POST /admin/orders/:id/validate` = **vraie recharge au gateway USSD**.
2. **Candidatures KYC** — `GET /admin/candidatures` → pré-analyse du dossier
   (champs, âge, doublons, photos, Vision en option) et **recommandation** à l'admin.
   L'agent n'approuve rien tant que `CABINE_AGENT_CAND_AUTO_APPROVE` n'est pas activé.

Toute la logique métier (compteurs, plafond 5 ventes, lock, appel gateway) reste
celle de `services/cabineService.js` : l'agent ne fait qu'appeler l'API admin.

Les alertes utilisent **les mêmes boutons que le bot** (`cab_ord_ok_`, `cab_ord_no_`,
`cab_ord_cancel_`, `cab_cand_ok_`, `cab_cand_no_`) : un clic est traité par le
webhook `/api/telegram/webhook-cabine` existant, rien à ajouter côté bot.

## Règles de validation d'une commande

Rejet automatique (la commande ne peut pas aboutir) :
- numéro qui ne fait pas 10 chiffres, ou préfixe inconnu (ni Orange 07/08/09, ni MTN 05/06, ni Moov 01/02) ;
- opérateur de la commande ≠ opérateur du numéro ;
- numéro sur liste noire (`CABINE_AGENT_BLACKLIST`).

Contrôle humain (notification + boutons ✅/❌) :
- montant hors bornes `CABINE_AGENT_MIN_AMOUNT` … `CABINE_AGENT_MAX_AMOUNT` ;
- forfait/bundle : en contrôle humain par défaut. Avec `CABINE_AGENT_ALLOW_BUNDLES=1`
  il est traité comme un crédit — même plafond `CABINE_AGENT_MAX_AMOUNT` — et reste
  en contrôle humain si son prix n'est pas enregistré (`amount` vide) ;
- cabine inactive, expirée, bloquée (plafond), ou hors liste blanche ;
- budget auto du jour dépassé (global ou par cabine) ;
- doublon : même numéro **et** même montant dans les `CABINE_AGENT_DUP_WINDOW_MIN` minutes ;
- cadence : plus de `CABINE_AGENT_MAX_PER_HOUR` recharges validées dans l'heure pour la cabine ;
- hors heures ouvrées.

Sinon → **validation automatique**, avec compte rendu Telegram (référence gateway,
budget consommé, bouton « Annuler » si le gateway a répondu en timeout).

Une commande laissée en contrôle humain est **relancée** jusqu'à
`CABINE_AGENT_MAX_REMINDERS` fois toutes les `CABINE_AGENT_REMIND_HOURS` heures.
Rapport quotidien à `CABINE_AGENT_REPORT_HOUR` h (UTC = Abidjan).

## Configuration (dans le `.env` du serveur)

| Variable | Défaut | Rôle |
|---|---|---|
| `CABINE_AGENT_DRY_RUN` | **1** | **1 = simulation** : décide et rapporte, n'exécute rien. Mettre `0` pour armer. |
| `CABINE_AGENT_ENABLED` | 1 | coupe l'agent sans le désinstaller |
| `CABINE_AGENT_POLL_SEC` | 60 | période du cycle |
| `CABINE_AGENT_MIN_AGE_SEC` | 60 | âge minimum d'une commande avant décision (laisse la main à l'admin) |
| `CABINE_AGENT_MAX_AMOUNT` | 5000 | plafond d'une recharge auto-validée |
| `CABINE_AGENT_MIN_AMOUNT` | 100 | plancher |
| `CABINE_AGENT_DAILY_CAP` | 50000 | FCFA auto-validés par jour, toutes cabines |
| `CABINE_AGENT_CABINE_DAY_CAP` | 25000 | FCFA auto-validés par jour et par cabine |
| `CABINE_AGENT_MAX_PER_HOUR` | 4 | recharges validées par heure et par cabine |
| `CABINE_AGENT_DUP_WINDOW_MIN` | 15 | fenêtre de détection des doublons |
| `CABINE_AGENT_HOURS` | `06:00-21:00` | heures ouvrées (UTC = Abidjan) |
| `CABINE_AGENT_ALLOW_BUNDLES` | 0 | 1 = valider aussi les forfaits (soumis au même plafond ; prix inconnu = contrôle humain) |
| `CABINE_AGENT_AUTO_REJECT` | 1 | 0 = ne jamais rejeter seul, tout passer à l'admin |
| `CABINE_AGENT_CABINES` | (vide) | liste blanche de codes cabine, ex. `75504560` — vide = toutes |
| `CABINE_AGENT_BLACKLIST` | (vide) | numéros bannis, séparés par des virgules |
| `CABINE_AGENT_CANDIDATURES` | 1 | pré-analyse des candidatures KYC |
| `CABINE_AGENT_CAND_AUTO_APPROVE` | 0 | 1 = approuver seul les dossiers parfaits (génère le code) |
| `CABINE_AGENT_CAND_AUTO_REJECT` | 0 | 1 = rejeter seul les dossiers inexploitables |
| `CABINE_AGENT_CAND_VISION` | 0 | 1 = envoyer pièce d'identité + selfie à Groq Vision (⚠️ données personnelles hors du VPS) |
| `GROQ_VISION_MODEL` | `qwen/qwen3.6-27b` | modèle vision (clé lue dans `/root/.hermes/.env`, comme l'agent grand public) |
| `CABINE_AGENT_AGE_MIN` / `_AGE_MAX` | 18 / 75 | bornes d'âge acceptées |
| `CABINE_AGENT_REMIND_HOURS` | 3 | relance des commandes en attente |
| `CABINE_AGENT_MAX_REMINDERS` | 2 | nombre de relances |
| `CABINE_AGENT_REPORT_HOUR` | 20 | heure du rapport quotidien |
| `CABINE_AGENT_ANNOUNCE` | 1 | message Telegram au démarrage |
| `CABINE_AGENT_SILENT` | 0 | 1 = aucune écriture Telegram (test à blanc) |
| `CABINE_API_BASE` | `http://127.0.0.1:$PORT/api/cabine` | base de l'API |

## Exploitation

```bash
# test à blanc : un cycle, rien d'exécuté, rien envoyé sur Telegram
cd /root/var/www/BIPBIPWEB/agents && node agent-validation-cabine.js --once --dry --silent

# démarrage
pm2 start ecosystem-cabine-validation.config.js && pm2 save

# logs / redémarrage après modif du .env
pm2 logs bipbip-cabine-validation --lines 50
pm2 restart bipbip-cabine-validation
```

Déploiement depuis le poste : `scripts/deploy-agent-validation-cabine.ps1`
(`-Test` pour le cycle à blanc, `-Start` pour lancer pm2).

## Mise en service recommandée

1. Déployer, laisser tourner en **simulation** quelques jours : les messages
   « serait validée automatiquement » disent exactement ce que l'agent aurait fait.
2. Restreindre au départ à une cabine (`CABINE_AGENT_CABINES=75504560`) et à un
   petit plafond (`CABINE_AGENT_MAX_AMOUNT=1000`, `CABINE_AGENT_DAILY_CAP=5000`).
3. Passer `CABINE_AGENT_DRY_RUN=0`, `pm2 restart bipbip-cabine-validation`, puis
   élargir progressivement.
