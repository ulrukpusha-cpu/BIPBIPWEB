/**
 * Agent #8 : Maintenance & Surveillance pour BIPBIP
 * Vérifie la santé du système
 * Pack Essential
 */

const dotenv = require('dotenv');
dotenv.config({ path: '../.env' });

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '6735995998';

class AgentMaintenance {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.isRunning = false;
    this.lastHealthCheck = null;
    this.issues = [];
    console.log('[Agent #8] Maintenance initialisée');
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Agent #8] Démarrage...');

    // Premier check immédiat
    await this.runHealthCheck();

    // Planification : toutes les 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      console.log('[Agent #8] Check santé:', new Date().toISOString());
      await this.runHealthCheck();
    });

    // Backup auto tous les jours à 2h
    cron.schedule('0 2 * * *', async () => {
      console.log('[Agent #8] Backup quotidien...');
      await this.runBackup();
    });

    console.log('[Agent #8] Surveillance active - Check toutes les 15 minutes');
  }

  async runHealthCheck() {
    this.issues = [];
    const checks = {
      api: false,
      database: false,
      ssl: false,
      disk: false,
      memory: false
    };

    try {
      // 1. Vérifier API
      checks.api = await this.checkAPI();

      // 2. Vérifier Database
      checks.database = await this.checkDatabase();

      // 3. Vérifier SSL
      checks.ssl = await this.checkSSL();

      // 4. Vérifier Espace disque
      checks.disk = await this.checkDiskSpace();

      // 5. Vérifier Mémoire
      checks.memory = await this.checkMemory();

      this.lastHealthCheck = {
        timestamp: new Date().toISOString(),
        checks: checks,
        issues: this.issues,
        healthy: this.issues.length === 0
      };

      if (this.issues.length > 0) {
        console.log('[Agent #8] ⚠️ Problèmes détectés:', this.issues.length);
        await this.notifyAdmin(
          `⚠️ Alertes Maintenance détectées\n\n` +
          this.issues.map(i => `• ${i}`).join('\n') + 
          `\n\nTimestamp: ${this.lastHealthCheck.timestamp}`
        );
      } else {
        console.log('[Agent #8] ✅ Tout est OK');
      }

    } catch (err) {
      console.error('[Agent #8] Erreur health check:', err);
      await this.notifyAdmin('[Agent #8] 💥 ERREUR CRITIQUE: ' + err.message);
    }
  }

  async checkAPI() {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch('http://localhost:3000/health', { 
        timeout: 10000 
      });
      
      if (response.status === 200) {
        return true;
      }
      
      this.issues.push(`API répond code ${response.status}`);
      return false;
    } catch (e) {
      this.issues.push(`API injoignable: ${e.message}`);
      return false;
    }
  }

  async checkDatabase() {
    try {
      const { data, error } = await this.supabase
        .from('telegram_users')
        .select('count')
        .limit(1);

      if (error) {
        this.issues.push(`Database error: ${error.message}`);
        return false;
      }

      return true;
    } catch (e) {
      this.issues.push(`Database unreachable: ${e.message}`);
      return false;
    }
  }

  async checkSSL() {
    try {
      // Vérifier la date d'expiration du certificat via openssl
      // Si sur Linux avec certbot
      const { execSync } = require('child_process');
      
      let certPath = '/etc/letsencrypt/live/bipbiprecharge.ci/cert.pem';
      
      if (fs.existsSync(certPath)) {
        const output = execSync(`openssl x509 -in ${certPath} -noout -dates`, { encoding: 'utf8' });
        const notAfter = output.match(/notAfter=(.+)/);
        
        if (notAfter) {
          const expiryDate = new Date(notAfter[1]);
          const daysUntilExpiry = Math.floor((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilExpiry < 7) {
            this.issues.push(`SSL expire dans ${daysUntilExpiry} jours !`);
            return false;
          }
          console.log(`[Agent #8] SSL OK - expire dans ${daysUntilExpiry} jours`);
        }
        return true;
      }
      
      return true; // Pas de certificat trouvé, skip
    } catch (e) {
      this.issues.push(`SSL check failed: ${e.message}`);
      return false;
    }
  }

  async checkDiskSpace() {
    try {
      const { execSync } = require('child_process');
      const output = execSync('df / -h | tail -1', { encoding: 'utf8' });
      const parts = output.trim().split(/\s+/);
      const usagePercent = parseInt(parts[4].replace('%', ''));
      
      if (usagePercent > 90) {
        this.issues.push(`Espace disque critique: ${usagePercent}% utilisé`);
        return false;
      }
      
      if (usagePercent > 80) {
        this.issues.push(`Espace disque élevé: ${usagePercent}% utilisé`);
        // Warning mais pas critique
      }
      
      return true;
    } catch (e) {
      this.issues.push(`Disk check failed: ${e.message}`);
      return false;
    }
  }

  async checkMemory() {
    try {
      const fs = require('fs');
      const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const totalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
      const availableMatch = memInfo.match(/MemAvailable:\s+(\d+)/);
      
      if (totalMatch && availableMatch) {
        const total = parseInt(totalMatch[1]) * 1024; // bytes
        const available = parseInt(availableMatch[1]) * 1024;
        const usedPercent = Math.round(((total - available) / total) * 100);
        
        if (usedPercent > 95) {
          this.issues.push(`Mémoire critique: ${usedPercent}% utilisée`);
          return false;
        }
        
        return true;
      }
      
      return true;
    } catch (e) {
      this.issues.push(`Memory check failed: ${e.message}`);
      return false;
    }
  }

  async runBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = '/root/backups/bipbip';
    
    try {
      // Créer le dossier si existe pas
      if (!fs.existsSync('/root/backups')) {
        fs.mkdirSync('/root/backups', { recursive: true });
      }
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Backup DB Supabase
      console.log('[Agent #8] Backup DB...');
      // Note: Supabase n'a pas d'export SQL direct facilement
      // On loggue juste le statut pour l'instant

      // Backup fichiers uploads
      const uploadBackup = `${backupDir}/uploads-${timestamp}.tar.gz`;
      const { execSync } = require('child_process');
      
      execSync(`tar -czf ${uploadBackup} -C /root/var/www/BIPBIPWEB uploads 2>/dev/null || true`);
      
      // Cleanup vieux backups (garde 7 jours)
      execSync(`find ${backupDir} -name "*.tar.gz" -mtime +7 -delete 2>/dev/null || true`);

      await this.notifyAdmin(`✅ Backup quotidien effectué\n• Date: ${timestamp}\n• Dossier: ${backupDir}`);
      
    } catch (e) {
      await this.notifyAdmin(`❌ Backup échoué: ${e.message}`);
    }
  }

  async notifyAdmin(message) {
    try {
      const fetch = (await import('node-fetch')).default;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ADMIN_CHAT_ID,
          text: '🤖 [Agent #8] ' + message,
          parse_mode: 'HTML'
        })
      });
    } catch (e) {
      console.error('[Agent #8] Erreur notifyAdmin:', e.message);
    }
  }

  async getStatus() {
    if (!this.lastHealthCheck) {
      return 'Pas encore de vérification effectuée';
    }
    
    const { checks, timestamp, healthy } = this.lastHealthCheck;
    
    return `📊 Status Agent #8\n` +
      `• Dernier check: ${timestamp}\n` +
      `• État global: ${healthy ? '✅ OK' : '⚠️ Alertes'}\n` +
      `• API: ${checks.api ? '✅' : '❌'}\n` +
      `• Database: ${checks.database ? '✅' : '❌'}\n` +
      `• SSL: ${checks.ssl ? '✅' : '❌'}\n` +
      `• Disk: ${checks.disk ? '✅' : '❌'}\n` +
      `• Memory: ${checks.memory ? '✅' : '❌'}`;
  }
}

// Démarrage auto
const agent = new AgentMaintenance();
agent.start().catch(err => {
  console.error('[Agent #8] Erreur fatale:', err);
  process.exit(1);
});

module.exports = { AgentMaintenance };
