/**
 * Agent #1 : Modérateur IA Pro pour BIPBIP
 * Vérifie automatiquement les annonces LED
 * Pack Essential
 */

const dotenv = require('dotenv');
dotenv.config({ path: '../.env' });

const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '6735995998';

// Mots-clés interdits / suspects
const BLACKLISTED_WORDS = [
  'arnaque', 'arnaqueur', 'escro', 'faux', 'porn', 'sex', 'xxx',
  'drogue', 'cocaïne', 'weed', 'chicha', 'alcool', 'whatsapp gold',
  'carte bancaire gratuite', 'carte bleue offerte', '100% gratuit',
  'gagner argent facile', 'devenir riche', 'prêt sans garantie',
  'hacking', 'pirater', 'voler', 'injection', 'virus'
];

// Regex patterns suspects
const SUSPICIOUS_PATTERNS = [
  /\b\d{16}\b/, // Numéro carte bancaire
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Emails
  /https?:\/\/bit\.ly\/\S+/, // Liens raccourcis
  /whatsapp\.com\/chat\/[A-Za-z0-9]+/, // Groupes WhatsApp suspects
];

class AgentModerateurIA {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.isRunning = false;
    this.stats = { checked: 0, approved: 0, rejected: 0 };
    console.log('[Agent #1] Modérateur IA initialisé');
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[Agent #1] Démarrage...');
    
    // Vérification initiale
    await this.checkPendingAnnonces();
    
    // Planification : toutes les 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      console.log('[Agent #1] Cycle de vérification:', new Date().toISOString());
      await this.checkPendingAnnonces();
    });

    // Rapport quotidien à 20h
    cron.schedule('0 20 * * *', () => {
      this.sendDailyReport();
    });

    console.log('[Agent #1] Modérateur IA actif - Vérification toutes les 5 minutes');
  }

  async checkPendingAnnonces() {
    try {
      const { data: annonces, error } = await this.supabase
        .from('annonces')
        .select('*')
        .eq('statut', 'en_attente')
        .order('created_at', { ascending: true })
        .limit(10); // Traiter par lots de 10

      if (error) {
        console.error('[Agent #1] Erreur Supabase:', error);
        return;
      }

      if (!annonces || annonces.length === 0) return;

      console.log(`[Agent #1] ${annonces.length} annonce(s) à modérer`);

      for (const annonce of annonces) {
        await this.moderateAnnonce(annonce);
      }

    } catch (err) {
      console.error('[Agent #1] Erreur checkPendingAnnonces:', err.message);
      await this.notifyAdmin('⚠️ Erreur Agent #1: ' + err.message);
    }
  }

  async moderateAnnonce(annonce) {
    const contenu = annonce.contenu.toLowerCase();
    this.stats.checked++;

    // Analyse de score de risque
    let riskScore = 0;
    const issues = [];

    // 1. Vérifier mots interdits
    for (const word of BLACKLISTED_WORDS) {
      if (contenu.includes(word.toLowerCase())) {
        riskScore += 20;
        issues.push(`Mot interdit: "${word}"`);
        break;
      }
    }

    // 2. Vérifier patterns suspects
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(annonce.contenu)) {
        riskScore += 15;
        issues.push(`Pattern suspect détecté`);
        break;
      }
    }

    // 3. Longueur suspecte (trop court ou trop long = spam potentiel)
    if (annonce.contenu.length < 10) {
      riskScore += 10;
      issues.push('Message trop court');
    }
    if (annonce.contenu.length > 200) {
      riskScore += 5;
      issues.push('Message trop long');
    }

    // 4. Caractères répétés (spam style)
    const repeatedChars = /(.)(?=\1{4,})/g;
    if (repeatedChars.test(annonce.contenu)) {
      riskScore += 10;
      issues.push('Caractères répétés (spam)');
    }

    // Décision
    if (riskScore >= 25) {
      // REFUSER
      await this.rejectAnnonce(annonce, issues, riskScore);
    } else if (riskScore >= 10) {
      // CAS LIMITE - Notifier admin pour validation manuelle
      await this.flagForReview(annonce, issues, riskScore);
    } else {
      // VALIDER
      await this.approveAnnonce(annonce);
    }
  }

  async approveAnnonce(annonce) {
    try {
      const { error } = await this.supabase
        .from('annonces')
        .update({ 
          statut: 'valide',
          moderated_by: 'agent-ia-001',
          moderated_at: new Date().toISOString()
        })
        .eq('id', annonce.id);

      if (error) throw error;

      this.stats.approved++;
      console.log(`[Agent #1] ✅ Annonce #${annonce.id} validée`);

      // Notifier user
      if (annonce.telegram_chat_id) {
        await this.notifyUser(
          annonce.telegram_chat_id,
          `✅ Votre annonce a été approuvée !\n\n"${annonce.contenu.slice(0, 50)}..."\n\nElle sera diffusée sur le LED screen prochainement.`
        );
      }

    } catch (err) {
      console.error('[Agent #1] Erreur approveAnnonce:', err);
    }
  }

  async rejectAnnonce(annonce, issues, score) {
    try {
      const motif = issues.join('; ');
      
      const { error } = await this.supabase
        .from('annonces')
        .update({ 
          statut: 'refuse',
          moderated_by: 'agent-ia-001',
          moderated_at: new Date().toISOString(),
          moderation_notes: motif
        })
        .eq('id', annonce.id);

      if (error) throw error;

      this.stats.rejected++;
      console.log(`[Agent #1] ❌ Annonce #${annonce.id} refusée (${score} pts risque)`);

      // Notifier user
      if (annonce.telegram_chat_id) {
        await this.notifyUser(
          annonce.telegram_chat_id,
          `❌ Annonce refusée\n\n"${annonce.contenu.slice(0, 50)}..."\n\nMotif: ${motif}\n\nScore de risque: ${score}/100\n\nModifiez votre message et renvoyez.`
        );
      }

    } catch (err) {
      console.error('[Agent #1] Erreur rejectAnnonce:', err);
    }
  }

  async flagForReview(annonce, issues, score) {
    console.log(`[Agent #1] ⚠️ Annonce #${annonce.id} en attente de validation admin (${score} pts risque)`);
    
    // Notifier admin pour validation manuelle
    await this.notifyAdmin(
      `⚠️ Annonce à vérifier manuellement\n\n` +
      `• Contenu: "${annonce.contenu.slice(0, 100)}..."\n` +
      `• Risk Score: ${score}/100\n` +
      `• Issues: ${issues.join(', ')}\n` +
      `• Auteur: ${annonce.user_id || 'unknown'}\n\n` +
      `Rappel: /approuver_${annonce.id} ou /refuser_${annonce.id}`
    );
  }

  async notifyUser(chatId, message) {
    try {
      const fetch = (await import('node-fetch')).default;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });
    } catch (e) {
      console.error('[Agent #1] Erreur notifyUser:', e.message);
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
          text: '🤖 [Agent #1] ' + message,
          parse_mode: 'HTML'
        })
      });
    } catch (e) {
      console.error('[Agent #1] Erreur notifyAdmin:', e.message);
    }
  }

  sendDailyReport() {
    const report = `📊 Rapport Agent #1 (${new Date().toLocaleDateString()})\n\n` +
      `• Annonces vérifiées: ${this.stats.checked}\n` +
      `• Approuvées: ${this.stats.approved} ✅\n` +
      `• Refusées: ${this.stats.rejected} ❌\n` +
      `• En attente: ${this.stats.checked - this.stats.approved - this.stats.rejected}\n\n` +
      `Prochain Pack Pro = 4 agents supplémentaires (+#2 Rotator, #3 Validateur, #4 Détecteur Fraude)`;
    
    this.notifyAdmin(report);
    
    // Reset stats
    this.stats = { checked: 0, approved: 0, rejected: 0 };
  }
}

// Démarrage auto
const agent = new AgentModerateurIA();
agent.start().catch(err => {
  console.error('[Agent #1] Erreur fatale:', err);
  process.exit(1);
});

module.exports = { AgentModerateurIA };
