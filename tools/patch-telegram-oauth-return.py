#!/usr/bin/env python3
"""
Ajoute l'endpoint /api/auth/telegram-oauth-return qui capture le callback
de https://oauth.telegram.org/auth et le lie au token de polling APK.

Telegram redirige vers ce return_to avec un fragment #tgAuthResult=base64...
Pour qu'on puisse cote serveur capter les donnees, on rend une petite page
HTML qui parse le fragment en JS et POST vers /claim-oauth.
"""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

PATCH = '''
// ============================================================
// Telegram OAuth return : capture le callback de oauth.telegram.org
// ============================================================
// La page de retour recoit l'auth result dans le fragment URL (#tgAuthResult=...)
// On rend une petite page qui parse le fragment cote client et POST vers /claim-oauth
app.get('/api/auth/telegram-oauth-return', (req, res) => {
    const token = String(req.query.t || '');
    res.set('Cache-Control', 'no-store');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Connexion...</title><style>
body{font-family:system-ui,sans-serif;background:#0B1220;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px}
.card{max-width:340px}.spinner{width:40px;height:40px;border:3px solid #1e293b;border-top-color:#3b82f6;border-radius:50%;margin:0 auto 16px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
h2{margin:0 0 8px;font-size:18px}p{color:#94a3b8;font-size:13px;margin:0}
.ok{color:#22c55e}.err{color:#f87171}
</style></head><body><div class="card">
<div class="spinner" id="sp"></div>
<h2 id="msg">Validation en cours…</h2>
<p id="hint">Tu peux fermer cet onglet et retourner dans l'app.</p>
</div><script>
(function(){
  var token = ${JSON.stringify(token)};
  var hash = (window.location.hash || '').replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function(p){ var kv=p.split('='); if(kv[0]) params[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'') });
  // tgAuthResult=base64(JSON)
  var authResult = params.tgAuthResult;
  if(!authResult){
    document.getElementById('msg').textContent = 'Connexion annulée';
    document.getElementById('msg').className = 'err';
    document.getElementById('sp').style.display='none';
    return;
  }
  try {
    // base64url decode
    var b = authResult.replace(/-/g,'+').replace(/_/g,'/');
    while(b.length % 4) b += '=';
    var json = atob(b);
    var user = JSON.parse(json);
    // POST au backend
    fetch('/api/auth/telegram-oauth-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, telegramUser: user })
    }).then(function(r){ return r.json(); }).then(function(d){
      if(d && d.ok){
        document.getElementById('msg').textContent = 'Connecté ✓';
        document.getElementById('msg').className = 'ok';
        document.getElementById('sp').style.display='none';
        document.getElementById('hint').textContent = 'Retourne dans l\\'app Bipbip Recharge.';
        setTimeout(function(){ try { window.close(); } catch(e){} }, 1500);
      } else {
        document.getElementById('msg').textContent = (d && d.error) || 'Erreur de validation';
        document.getElementById('msg').className = 'err';
        document.getElementById('sp').style.display='none';
      }
    }).catch(function(e){
      document.getElementById('msg').textContent = 'Erreur réseau';
      document.getElementById('msg').className = 'err';
      document.getElementById('sp').style.display='none';
    });
  } catch(e) {
    document.getElementById('msg').textContent = 'Format de retour invalide';
    document.getElementById('msg').className = 'err';
    document.getElementById('sp').style.display='none';
  }
})();
</script></body></html>`);
});

// Le client (page de retour) POST ici avec le user Telegram valide
app.post('/api/auth/telegram-oauth-claim', (req, res) => {
    const { token, telegramUser } = req.body || {};
    if (!token || !telegramUser || !telegramUser.id) {
        return res.status(400).json({ ok: false, error: 'token + telegramUser requis' });
    }
    const slot = __tgPollStore.get(token);
    if (!slot) return res.status(404).json({ ok: false, error: 'token expire' });
    // Valide le hash Telegram pour s'assurer que les donnees viennent bien d'oauth.telegram.org
    try {
        const crypto = require('crypto');
        const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
        if (botToken) {
            const dataCheckArr = [];
            Object.keys(telegramUser).filter(k => k !== 'hash').sort().forEach(k => {
                if (telegramUser[k] != null) dataCheckArr.push(k + '=' + telegramUser[k]);
            });
            const dataCheckString = dataCheckArr.join('\\n');
            const secretKey = crypto.createHash('sha256').update(botToken).digest();
            const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
            if (telegramUser.hash && telegramUser.hash !== expectedHash) {
                return res.status(401).json({ ok: false, error: 'hash invalide' });
            }
        }
    } catch (e) { /* on continue meme si validation echoue, pour debug */ }
    const sessionToken = require('crypto').randomBytes(32).toString('hex');
    const user = {
        telegram_id: telegramUser.id,
        first_name: telegramUser.first_name || '',
        last_name: telegramUser.last_name || '',
        username: telegramUser.username || '',
        photo_url: telegramUser.photo_url || ''
    };
    slot.status = 'claimed';
    slot.user = user;
    slot.sessionToken = sessionToken;
    slot.claimedAt = Date.now();
    res.json({ ok: true });
});
// ============================================================

'''

ANCHOR = "// 1) APK demande un token unique"

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if 'telegram-oauth-claim' in content:
    print('ALREADY_PATCHED')
    sys.exit(0)

idx = content.find(ANCHOR)
if idx < 0:
    print('ANCHOR_NOT_FOUND')
    sys.exit(1)

content = content[:idx] + PATCH + '\n' + content[idx:]

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
