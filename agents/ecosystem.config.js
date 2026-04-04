/**
 * PM2 Ecosystem pour les Agents BIPBIP
 * Pack Essential: Agents #1 et #8
 */

module.exports = {
  apps: [
    {
      name: 'bipbip-agent-moderateur',
      script: './agent-moderateur-ia.js',
      cwd: '/root/var/www/BIPBIPWEB/agents',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID
      },
      log_file: '/var/log/pm2/bipbip-agent-moderateur.log',
      out_file: '/var/log/pm2/bipbip-agent-moderateur-out.log',
      error_file: '/var/log/pm2/bipbip-agent-moderateur-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000,
      kill_timeout: 5000,
      listen_timeout: 10000
    },
    {
      name: 'bipbip-agent-maintenance',
      script: './agent-maintenance.js',
      cwd: '/root/var/www/BIPBIPWEB/agents',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID
      },
      log_file: '/var/log/pm2/bipbip-agent-maintenance.log',
      out_file: '/var/log/pm2/bipbip-agent-maintenance-out.log',
      error_file: '/var/log/pm2/bipbip-agent-maintenance-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000,
      kill_timeout: 5000,
      listen_timeout: 10000
    }
  ]
};
