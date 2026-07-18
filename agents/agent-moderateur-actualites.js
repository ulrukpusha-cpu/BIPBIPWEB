/**
 * Agent Modérateur Actualités (Pack Essential #2)
 * Auto-approving des actualités RSS avec filtrage IA
 * Boss: démarrage commande pm2 start
 */

const dotenv = require('dotenv');
dotenv.config({ path: '../.env' });

const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Mots-clés à rejeter automatiquement (spam/scam/fake news)
const BLACKLISTED_KEYWORDS = [
  'arnaque', 'escroquerie', 'arnaqueur', 'scam', 'arnaque',
  'prince nigérian', 'héritage', 'gagné sans participer', 'loto',
  'argent facile', '100% vrai', 'incroyable mais vrai',
  'politique sans fond', 'fakenews', 'fake news'
];

// Mots-clés doublons (déjà vus dans les titres récents = risque doublon)
const SIMILARITY_THRESHOLD = 0.75;

class AgentModerateurActualites {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    this.isRunning = false;
    this.stats = { checked: 0, approved: 0, rejected: 0 };
    console.log('[Agent #2] Modérateur Actualités initialisé');
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[Agent #2] Démarrage...');
    
    // Vérification initiale
    await this.checkPendingActualites();
    
    // Planification : toutes les 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      console.log('[Agent #2] Cycle de vérification:', new Date().toISOString());
      await this.checkPendingActualites();
    });
    
    // Fetch RSS automatique toutes les 2h 
    cron.schedule('0 */2 * * *', async () => {
      console.log('[Agent #2] Fetch RSS automatique...');
      const { spawn } = require('child_process');
      const child = spawn('node', ['cron/fetchNewsRss.js'], { 
        cwd: '/root/var/www/BIPBIPWEB',
        stdio: 'inherit'
      });
      child.on('close', (code) => {
        console.log(`[Agent #2] Fetch RSS terminé (code ${code})`);
      });
    });

    console.log('[Agent #2] Modérateur Actualités actif - Vérification toutes les 5 minutes');
    console.log('[Agent #2] Fetch RSS auto toutes les 2h');
    
    // Rapport quotidien à 21h
    cron.schedule('0 21 * * *', () => this.sendDailyReport());
  }

  async checkPendingActualites() {
    try {
      // Récupérer actualités en pending
      const { data: actualites, error } = await this.supabase
        .from('actualites')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        console.error('[Agent #2] Erreur Supabase:', error);
        return;
      }

      if (!actualites || actualites.length === 0) return;

      console.log(`[Agent #2] ${actualites.length} actualité(s) à modérer`);

      for (const actu of actualites) {
        await this.moderateActualite(actu);
      }

    } catch (err) {
      console.error('[Agent #2] Erreur checkPendingActualites:', err.message);
    }
  }

  async moderateActualite(actu) {
    const title = (actu.title || '').toLowerCase();
    const content = (actu.content || '').toLowerCase();
    this.stats.checked++;

    // 1. Vérifier blacklist
    for (const word of BLACKLISTED_KEYWORDS) {
      if (title.includes(word) || content.includes(word)) {
        await this.rejectActualite(actu, `Mot blacklisté: ${word}`);
        return;
      }
    }

    // 2. Vérifier titre trop court/vague
    if (title.length < 20) {
      await this.rejectActualite(actu, 'Titre trop court (< 20 caractères)');
      return;
    }

    // 3. Vérifier doublon avec actualités récentes (7 derniers j)
    const { data: recent } = await this.supabase
      .from('actualites')
      .select('title')
      .eq('status', 'approved')
      .gte('published_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (recent) {
      const similar = recent.find(a => this.similarity(a.title.toLowerCase(), title) > SIMILARITY_THRESHOLD);
      if (similar) {
        await this.rejectActualite(actu, 'Doublon avec actualité récente');
        return;
      }
    }

    // 4. Tout est OK → APPROUVER
    await this.approveActualite(actu);
  }

  similarity(s1, s2) {
    const set1 = new Set(s1.split(' '));
    const set2 = new Set(s2.split(' '));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    return intersection.size / Math.max(set1.size, set2.size);
  }

  async approveActualite(actu) {
    try {
      const { error } = await this.supabase
        .from('actualites')
        .update({ 
          status: 'approved',
          published_at: new Date().toISOString(),
          moderated_by: 'agent-ia-002'
        })
        .eq('id', actu.id);

      if (error) throw error;

      this.stats.approved++;
      console.log(`[Agent #2] ✅ Actualité validée: ${actu.title?.slice(0, 50)}...`);

    } catch (err) {
      console.error('[Agent #2] Erreur approveActualite:', err);
    }
  }

  async rejectActualite(actu, motif) {
    try {
      const { error } = await this.supabase
        .from('actualites')
        .update({ 
          status: 'rejected',
          moderated_by: 'agent-ia-002',
          moderation_notes: motif
        })
        .eq('id', actu.id);

      if (error) throw error;

      this.stats.rejected++;
      console.log(`[Agent #2] ❌ Actualité rejetée (${motif}): ${actu.title?.slice(0, 40)}...`);

    } catch (err) {
      console.error('[Agent #2] Erreur rejectActualite:', err);
    }
  }

  sendDailyReport() {
    const report = `📊 Rapport Agent #2 (${new Date().toLocaleDateString()})\n\n` +
      `• Actualités vérifiées: ${this.stats.checked}\n` +
      `• Approuvées: ${this.stats.approved} ✅\n` +
      `• Rejetées: ${this.stats.rejected} ❌\n\n` +
      `[Agent #2] Modérateur Actualités - Opérationnel`;
    
    console.log('[Agent #2] Rapport:', report);
    this.stats = { checked: 0, approved: 0, rejected: 0 };
  }
}

// Démarrage auto
const agent = new AgentModerateurActualites();
agent.start().catch(err => {
  console.error('[Agent #2] Erreur fatale:', err);
  process.exit(1);
});

module.exports = { AgentModerateurActualites };
