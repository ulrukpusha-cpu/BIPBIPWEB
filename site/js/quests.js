/* =========================================================
   Bipbip Recharge — Web · Points & Quêtes (Phase 3)
   Ports from app/index.html: daily check-in, server quests
   (/api/quests + /api/quests/user/:id), points history
   (/api/telegram/points-history). Uses window.BB (core.js).
   ========================================================= */
(function () {
  var DAILY_REWARDS = [5, 10, 15, 20, 25, 30, 50];
  var QUESTS_FALLBACK = [
    { title: "Lire 5 articles aujourd'hui", desc: "Restez informé des offres MTN, Orange et Moov.", progress: 0, total: 5, reward: 50, done: false },
    { title: "Effectuer 3 recharges cette semaine", desc: "Toute recharge ≥ 1 000 F compte.", progress: 0, total: 3, reward: 200, done: false },
    { title: "Partager Bipbip avec un ami", desc: "Envoyez votre lien de parrainage et gagnez à 2.", progress: 0, total: 1, reward: 100, done: false }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.BB ? BB.escapeHtml(s) : String(s == null ? '' : s); }

  // ── Daily check-in ──────────────────────────────────────
  function renderDailyGrid(streak, claimedToday) {
    var grid = $('dailyGrid'); if (!grid) return;
    streak = Math.max(0, Math.min(7, streak || 0));
    grid.innerHTML = DAILY_REWARDS.map(function (r, i) {
      var cls = '';
      if (i < streak) cls = 'done';
      else if (!claimedToday && i === streak) cls = 'today';
      return '<div class="daily-day ' + cls + '"><strong>' + (i + 1) + '</strong><span class="reward">+' + r + '</span></div>';
    }).join('');
    var streakEl = $('dailyStreak'); if (streakEl) streakEl.textContent = streak + '/7';
    var btn = $('dailyClaimBtn'), st = $('dailyStatus');
    if (!btn || !st) return;
    if (claimedToday) {
      btn.disabled = true; btn.textContent = "Déjà réclamé aujourd'hui";
      st.style.display = ''; st.textContent = 'Reviens demain pour gagner +' + DAILY_REWARDS[Math.min(streak, 6)] + ' pts';
    } else {
      btn.disabled = false; btn.textContent = 'RÉCLAMER (+' + DAILY_REWARDS[Math.min(streak, 6)] + ' pts)';
      st.style.display = 'none';
    }
  }

  async function refreshDailyCheckin() {
    var streak = 0, claimedToday = false;
    if (window.BipbipAPI) {
      try {
        var d = await window.BipbipAPI.getDailyCheckin();
        if (d) { streak = d.streak || d.checkin_streak || 0; claimedToday = !!(d.claimedToday || d.already_claimed); }
      } catch (e) {}
    }
    if (!claimedToday) {
      var last = localStorage.getItem('bb_last_checkin');
      var today = new Date().toISOString().slice(0, 10);
      if (last === today) claimedToday = true;
      if (!streak) streak = parseInt(localStorage.getItem('bb_checkin_streak') || '0', 10) || 0;
    }
    renderDailyGrid(streak, claimedToday);
  }

  async function claimDaily() {
    var btn = $('dailyClaimBtn');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    var ok = false, reward = 0, newStreak = 0, serverTotal = null;
    if (window.BipbipAPI) {
      try {
        var r = await window.BipbipAPI.claimDailyCheckin();
        if (r && r.success !== false) {
          ok = true;
          newStreak = r.streak || r.checkin_streak || 1;
          reward = r.points || r.reward || r.points_earned || 0;
          if (typeof r.total_points === 'number') serverTotal = r.total_points;
          if (!reward) reward = DAILY_REWARDS[Math.min(newStreak - 1, 6)];
        }
      } catch (e) {}
    }
    if (!ok) {
      var today = new Date().toISOString().slice(0, 10);
      var lastDate = localStorage.getItem('bb_last_checkin');
      var s = parseInt(localStorage.getItem('bb_checkin_streak') || '0', 10) || 0;
      if (lastDate === today) { if (btn) btn.disabled = false; return; }
      var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      s = (lastDate === yesterday) ? Math.min(7, s + 1) : 1;
      localStorage.setItem('bb_last_checkin', today);
      localStorage.setItem('bb_checkin_streak', String(s));
      newStreak = s; reward = DAILY_REWARDS[Math.min(s - 1, 6)]; ok = true;
    }
    if (ok) {
      if (serverTotal != null) {
        BB.setServerPoints(serverTotal);
        // log local (cohérence affichage) sans recréditer
        try {
          var hist = BB.getLocalPointsHistory();
          hist.unshift({ reason: 'Daily check-in · jour ' + newStreak, delta: reward, when: new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), at: Date.now() });
          localStorage.setItem('bb_points_history', JSON.stringify(hist.slice(0, 100)));
        } catch (e) {}
        renderPointsHistory();
      } else if (reward > 0) {
        BB.addPoints(reward, 'Daily check-in · jour ' + newStreak);
      }
      renderDailyGrid(newStreak, true);
      BB.appToast('🎉 +' + reward + ' points · streak ' + newStreak + '/7', 'success');
    }
  }

  // ── Quests ──────────────────────────────────────────────
  function renderQuestsItems(items) {
    var root = $('questsList'); if (!root) return;
    root.innerHTML = items.map(function (q) {
      var pct = q.total ? Math.min(100, Math.round((q.progress / q.total) * 100)) : 0;
      return '<div class="quest-card ' + (q.done ? 'is-done' : '') + '">' +
        '<div class="quest-card__head"><div class="quest-card__title">' + esc(q.title) + '</div>' +
        '<div class="quest-card__reward">' + (q.done ? '✓ ' : '+') + q.reward + ' pts</div></div>' +
        '<div class="quest-card__desc">' + esc(q.desc) + '</div>' +
        '<div class="quest-card__bar"><div class="quest-card__fill" style="width:' + pct + '%"></div></div>' +
        '<div class="quest-card__progress"><span>' + q.progress + '/' + q.total + '</span><span>' + pct + '%</span></div>' +
      '</div>';
    }).join('');
  }

  async function loadServerQuests() {
    var base = BB.apiBase();
    var uid = BB.getRegisteredUserId();
    try {
      var reqs = [fetch(base + '/api/quests', { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); })];
      reqs.push(uid
        ? fetch(base + '/api/quests/user/' + encodeURIComponent(uid), { headers: BB.serverPointHeaders() }).then(function (r) { return r.json(); }).catch(function () { return null; })
        : Promise.resolve(null));
      var res = await Promise.all(reqs);
      var list = (res[0] && (res[0].quests || res[0].items || res[0].data)) || [];
      var userQuests = (res[1] && (res[1].user_quests || res[1].quests)) || [];
      var progById = {};
      userQuests.forEach(function (uq) { if (uq && uq.quest_id) progById[uq.quest_id] = uq; });
      if (!list.length) return;
      var mapped = list.map(function (q) {
        var up = progById[q.id] || {};
        var total = q.target_value || q.target || 1;
        var done = !!up.completed;
        return {
          title: q.titre || q.title || q.name || 'Quête',
          desc: q.description || '',
          reward: q.points_reward || q.reward || q.points || 0,
          total: total,
          progress: done ? total : (up.progress || 0),
          done: done
        };
      });
      mapped.sort(function (a, b) { return (a.done === b.done) ? 0 : (a.done ? 1 : -1); });
      renderQuestsItems(mapped);
    } catch (e) { /* garde le fallback */ }
  }

  // ── Points history (local + server) ─────────────────────
  function labelForAction(a) {
    var map = { quest: 'Quête', daily_checkin: 'Connexion quotidienne', referral: 'Parrainage', link_click: 'Lien communautaire' };
    return map[a] || (a || 'Points');
  }
  function renderPointsHistory() {
    var list = $('pointsHistory'); if (!list) return;
    var stored = BB.getLocalPointsHistory();
    if (!stored.length) {
      list.innerHTML = '<div class="empty-block"><iconify-icon icon="solar:notebook-minimalistic-linear" width="22"></iconify-icon>' +
        '<div class="t">Aucune transaction pour le moment.</div><div class="s">Tes points apparaîtront ici après ta première action.</div></div>';
    } else {
      list.innerHTML = stored.map(function (h) {
        return '<div class="ph-row"><div><div class="reason">' + esc(h.reason || '') + '</div><div class="when">' + esc(h.when || '') + '</div></div>' +
          '<div class="delta ' + (h.delta >= 0 ? 'plus' : 'minus') + '">' + (h.delta >= 0 ? '+' : '') + h.delta + ' pts</div></div>';
      }).join('');
    }
    refreshServerPointsHistory();
  }
  async function refreshServerPointsHistory() {
    var uid = BB.getRegisteredUserId();
    if (!uid) return;
    var list = $('pointsHistory'); if (!list) return;
    try {
      var r = await fetch(BB.apiBase() + '/api/telegram/points-history?limit=50&userId=' + encodeURIComponent(uid), { headers: BB.serverPointHeaders() });
      if (!r.ok) return;
      var d = await r.json();
      var hist = (d && d.history) || [];
      if (!Array.isArray(hist) || !hist.length) return;
      list.innerHTML = hist.map(function (h) {
        var delta = (typeof h.amount === 'number') ? h.amount : 0;
        var when = '';
        try { when = new Date(h.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
        var reason = h.description || labelForAction(h.action);
        return '<div class="ph-row"><div><div class="reason">' + esc(reason) + '</div><div class="when">' + esc(when) + '</div></div>' +
          '<div class="delta ' + (delta >= 0 ? 'plus' : 'minus') + '">' + (delta >= 0 ? '+' : '') + delta + ' pts</div></div>';
      }).join('');
    } catch (e) {}
  }

  function reload() {
    refreshDailyCheckin();
    loadServerQuests();
    renderPointsHistory();
    try { BB.refreshServerPoints(); } catch (e) {}
  }

  function boot() {
    if (!$('questsList')) return;   // pas sur la page quêtes
    renderQuestsItems(QUESTS_FALLBACK);   // affichage immédiat
    var cb = $('dailyClaimBtn'); if (cb) cb.addEventListener('click', claimDaily);
    // L'API client est en defer ; on attend qu'elle soit prête
    var tries = 0;
    (function whenReady() {
      if (window.BipbipAPI && window.BB) { reload(); return; }
      if (tries++ > 60) return;
      setTimeout(whenReady, 100);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.BBQuests = { reload: reload, renderPointsHistory: renderPointsHistory, loadServerQuests: loadServerQuests, refreshDailyCheckin: refreshDailyCheckin };
})();
