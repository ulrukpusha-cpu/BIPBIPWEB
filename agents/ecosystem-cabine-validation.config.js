/**
 * PM2 — Agent Validation Cabine (réseau Kbine physique)
 * Fichier SÉPARÉ de ecosystem.config.js pour ne pas toucher aux agents existants.
 *
 *   pm2 start ecosystem-cabine-validation.config.js
 *   pm2 logs bipbip-cabine-validation
 *   pm2 restart bipbip-cabine-validation   (après une modif du .env)
 *
 * La config vient du .env du serveur (../.env) : CABINE_ADMIN_KEY,
 * TELEGRAM_BOT_TOKEN_CABINE, ADMIN_CHAT_IDS, CABINE_AGENT_* — voir
 * README-AGENT-VALIDATION-CABINE.md.
 */
module.exports = {
  apps: [
    {
      name: 'bipbip-cabine-validation',
      script: './agent-validation-cabine.js',
      cwd: '/root/var/www/BIPBIPWEB/agents',
      instances: 1,
      exec_mode: 'fork',   // comme les autres agents (pas de port à partager)
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
      log_file: '/var/log/pm2/bipbip-cabine-validation.log',
      out_file: '/var/log/pm2/bipbip-cabine-validation-out.log',
      error_file: '/var/log/pm2/bipbip-cabine-validation-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000,
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
