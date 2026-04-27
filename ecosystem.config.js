module.exports = {
  apps: [{
    name: 'BIPBIPWEB',
    script: 'server.js',
    cwd: '/root/var/www/BIPBIPWEB',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '400M',
    restart_delay: 3000,
    max_restarts: 10,
    min_uptime: '10s',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/root/.pm2/logs/BIPBIPWEB-error.log',
    out_file: '/root/.pm2/logs/BIPBIPWEB-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
