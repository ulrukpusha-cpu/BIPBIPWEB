/* =========================================================
   Bipbip Recharge — Web · Actualités (Phase 5)
   Ports from app/index.html: LED marquee (/api/led/messages +
   actualités + config ledScrollSeconds), news list (/api/actualites),
   detail (/api/actualites/slug/:slug) with full content + sources.
   Reading an article credits points via BB.trackArticleRead.
   ========================================================= */
(function () {
  var NEWS_PAGE_SIZE = 8;
  var newsCat = '', newsOffset = 0, newsHasMore = true, newsItems = [];

  function $(id) { return document.getElementById(id); }
  function newsLang() { try { return localStorage.getItem('bipbip_lang') || 'fr'; } catch (e) { return 'fr'; } }
  function esc(s) { return window.BB ? BB.escapeHtml(s) : String(s == null ? '' : s); }
  function absUrl(u) { if (!u) return ''; if (/^https?:\/\//i.test(u)) return u; var b = BB.apiBase(); return b + (u.charAt(0) === '/' ? '' : '/') + u; }

  function formatNewsDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso), now = new Date(), diff = Math.round((now - d) / 60000);
      if (diff < 1) return "à l'instant";
      if (diff < 60) return 'il y a ' + diff + ' min';
      var h = Math.round(diff / 60); if (h < 24) return 'il y a ' + h + ' h';
      var j = Math.round(h / 24); if (j < 30) return 'il y a ' + j + ' j';
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch (e) { return ''; }
  }

  // ── News list ──
  function srcName(n) {
    if (n.source || n.src) return n.source || n.src;
    var s = n.sources;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch (e) { s = null; } }
    if (Array.isArray(s) && s[0] && (s[0].name || s[0].source)) return s[0].name || s[0].source;
    return 'Actualités IA';
  }
  function buildCard(n, idx) {
    var src = srcName(n);
    var summary = n.summary_short || n.summary || n.description || '';
    var cat = n.category || '';
    var catLabel = ({ region: '🏛️ Région', finance: '💰 Finance', tech: '💻 Tech', mode: '👗 Mode', science: '🔬 Science', music: '🎵 Musique' })[cat] || '';
    var img = n.image_url || n.image || '';
    var imgHtml = img ? '<div class="news-card__cover" style="margin:-2px -2px 10px;border-radius:12px;overflow:hidden;aspect-ratio:16/9;background:rgba(255,255,255,.05)"><img src="' + esc(/^https?:\/\//.test(img) ? img : absUrl(img)) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.parentNode.style.display=\'none\'"></div>' : '';
    return '<article class="news-card" data-idx="' + idx + '">' + imgHtml +
      '<h3 class="news-card__title">' + esc(n.title || '') + '</h3>' +
      (summary ? '<p class="news-card__summary">' + esc(summary) + '</p>' : '') +
      '<div class="news-card__meta"><span class="src">' + esc(src) + '</span>' +
      (catLabel ? '<span class="pill">' + esc(catLabel) + '</span>' : '') +
      '<span style="margin-left:auto">' + esc(formatNewsDate(n.published_at || n.date)) + '</span></div></article>';
  }
  function renderItems(items) {
    var root = $('newsList'); if (!root) return;
    newsItems = (items || []).slice();
    if (!items || !items.length) { root.innerHTML = '<p class="muted" style="text-align:center;padding:30px;font-size:13px">Aucune actualité dans cette catégorie</p>'; return; }
    root.innerHTML = items.map(function (n, i) { return buildCard(n, i); }).join('');
  }
  async function loadNewsCat(cat, append) {
    var root = $('newsList'), loadMoreBtn = $('newsLoadMore');
    if (!append) {
      newsCat = cat || ''; newsOffset = 0; newsHasMore = true;
      root.innerHTML = '<p class="muted" style="text-align:center;padding:30px;font-size:13px">Chargement…</p>';
    }
    if (!window.BipbipAPI || !newsHasMore) return;
    try {
      var path = '/api/actualites?limit=' + NEWS_PAGE_SIZE + '&offset=' + newsOffset + (newsCat ? '&category=' + encodeURIComponent(newsCat) : '') + '&lang=' + newsLang();
      var r = await fetch(BB.apiBase() + path, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var items = (d && (d.actualites || d.items || d.data)) || [];
      if (items.length < NEWS_PAGE_SIZE) newsHasMore = false;
      if (append) {
        var base = newsItems.length; newsItems = newsItems.concat(items);
        root.insertAdjacentHTML('beforeend', items.map(function (n, i) { return buildCard(n, base + i); }).join(''));
      } else {
        renderItems(items);
      }
      newsOffset += items.length;
      if (loadMoreBtn) loadMoreBtn.style.display = newsHasMore ? 'block' : 'none';
    } catch (e) {
      if (!append) root.innerHTML = '<p class="muted" style="text-align:center;padding:30px;font-size:13px">Actualités indisponibles — réessayez plus tard.</p>';
    }
  }

  // ── Detail modal ──
  function fillSources(sources) {
    var wrap = $('newsDetailSource'); if (!wrap) return;
    if (typeof sources === 'string') {
      var t = sources.trim();
      if (t.charAt(0) === '[' || t.charAt(0) === '{') { try { sources = JSON.parse(t); } catch (e) {} }
    }
    var arr = Array.isArray(sources) ? sources : (sources ? [sources] : []);
    var pills = arr.map(function (s) {
      var name, url;
      if (typeof s === 'string') { url = /^https?:\/\//.test(s) ? s : ''; name = url ? url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : s; }
      else { name = s.name || s.title || s.source || ''; url = s.url || s.link || ''; if (!name && url) name = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]; if (!name) name = 'Source'; }
      var attr = url ? ' href="' + esc(url) + '" target="_blank" rel="noopener"' : '';
      return '<a class="news-detail__src-pill"' + attr + '><iconify-icon icon="solar:link-linear" width="14"></iconify-icon><span>' + esc(name) + '</span></a>';
    });
    if (pills.length) { wrap.style.display = ''; wrap.innerHTML = '<div class="news-detail__src-label">Sources</div><div style="display:flex;flex-direction:column;gap:8px">' + pills.join('') + '</div>'; }
    else wrap.style.display = 'none';
  }
  async function openDetail(idx) {
    var n = newsItems[idx]; if (!n) return;
    $('newsDetailTitle').textContent = n.title || '';
    $('newsDetailDate').textContent = formatNewsDate(n.published_at || n.date);
    $('newsDetailBody').textContent = n.content || n.summary_short || n.summary || 'Chargement…';
    var imgEl = $('newsDetailImg'); imgEl.style.display = 'none';
    fillSources(n.sources || n.source || (n.url || ''));
    $('newsModal').classList.add('is-open');
    // Crédite la quête "lire 5 articles"
    try { BB.trackArticleRead(n.slug || n.id || n.title); } catch (e) {}
    if (n.slug) {
      try {
        var r = await fetch(BB.apiBase() + '/api/actualites/slug/' + encodeURIComponent(n.slug) + '?lang=' + newsLang(), { headers: { 'Accept': 'application/json' } });
        var d = await r.json().catch(function () { return null; });
        var full = d && (d.actualite || d.article || d);
        if (full) {
          newsItems[idx] = Object.assign({}, n, full);
          $('newsDetailBody').textContent = full.content || full.summary_short || n.summary_short || 'Contenu non disponible.';
          var img = full.image || full.image_url;
          if (img) { imgEl.src = /^https?:\/\//.test(img) ? img : absUrl(img); imgEl.style.display = 'block'; }
          fillSources(full.sources || full.source || (full.url || ''));
        }
      } catch (e) {}
    }
  }
  function closeDetail() { $('newsModal').classList.remove('is-open'); }

  function boot() {
    if (!$('newsList')) return;
    var tabs = $('newsTabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.news-tab'); if (!b) return;
      tabs.querySelectorAll('.news-tab').forEach(function (t) { t.classList.remove('is-active'); });
      b.classList.add('is-active');
      loadNewsCat(b.dataset.cat || '', false);
    });
    $('newsList').addEventListener('click', function (e) { var c = e.target.closest('.news-card'); if (c) openDetail(parseInt(c.dataset.idx, 10)); });
    var lm = $('newsLoadMore'); if (lm) lm.addEventListener('click', function () { loadNewsCat(newsCat, true); });
    document.querySelectorAll('[data-close="news"]').forEach(function (b) { b.addEventListener('click', closeDetail); });
    (function ready() { if (window.BipbipAPI && window.BB) { loadNewsCat('', false); } else setTimeout(ready, 120); })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.BBNews = {};
})();
