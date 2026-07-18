/* =========================================================
   Bipbip Recharge — Seasonal theme engine (vanilla)

   Reads ./seasons.json, detects the active season for "now"
   (or ?season=<id> override), applies data-season on <html>,
   and mounts a particle overlay.

   Public API on window.BipbipTheme:
     - detect(date?) -> { id, label, emoji } | null
     - apply(id|null)
     - listSeasons()
     - mountParticles(opts?)
     - unmountParticles()
   ========================================================= */
(function () {
  "use strict";

  var THEME_BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/[^/]+$/, "");
    return "/shared/theme/";
  })();

  var SEASONS = null;          // loaded async
  var ACTIVE = null;           // {id,label,emoji} or null
  var PARTICLE_EL = null;
  var OVERRIDE_KEY = "bb-season-override";

  // ---- Date helpers ----------------------------------------------------
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function md(d) { return pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ymd(d) { return d.getFullYear() + "-" + md(d); }

  // For a "from MM-DD to MM-DD" recurring window. Handles year wrap (12-26 to 01-06).
  function inRecurringMD(now, from, to) {
    var cur = md(now);
    if (from <= to) return cur >= from && cur <= to;
    // wraps around year-end
    return cur >= from || cur <= to;
  }

  function inExplicitRange(now, ranges) {
    var cur = ymd(now);
    for (var i = 0; i < ranges.length; i++) {
      if (cur >= ranges[i].from && cur <= ranges[i].to) return true;
    }
    return false;
  }

  // ---- Detection -------------------------------------------------------
  function detect(date) {
    if (!SEASONS) return null;
    var now = date || new Date();

    // 1) URL override ?season=<id> wins (incl. ?season=none)
    try {
      var p = new URLSearchParams(window.location.search).get("season");
      if (p) {
        if (p === "none" || p === "default") return null;
        var s = SEASONS.find(function (x) { return x.id === p; });
        if (s) return { id: s.id, label: s.label, emoji: s.emoji };
      }
    } catch (e) {}

    // 2) localStorage override (set by admin UI / dev console)
    try {
      var ov = window.localStorage.getItem(OVERRIDE_KEY);
      if (ov === "none" || ov === "default") return null;
      if (ov) {
        var so = SEASONS.find(function (x) { return x.id === ov; });
        if (so) return { id: so.id, label: so.label, emoji: so.emoji };
      }
    } catch (e) {}

    // 3) Auto by date — first match in seasons.json order wins
    for (var i = 0; i < SEASONS.length; i++) {
      var s2 = SEASONS[i];
      var w = s2.window || {};
      var hit = false;
      if (w.type === "recurring-md") {
        hit = inRecurringMD(now, w.from, w.to);
      } else if (w.type === "explicit") {
        hit = inExplicitRange(now, w.ranges || []);
      }
      if (!hit) continue;
      // Honor priority overrides — e.g. "ete" must not win during "indep" week.
      if (Array.isArray(w.exclude)) {
        var displaced = false;
        for (var j = 0; j < w.exclude.length; j++) {
          var other = SEASONS.find(function (x) { return x.id === w.exclude[j]; });
          if (!other) continue;
          var ow = other.window;
          var oHit = ow.type === "recurring-md"
            ? inRecurringMD(now, ow.from, ow.to)
            : (ow.type === "explicit" && inExplicitRange(now, ow.ranges || []));
          if (oHit) { displaced = true; break; }
        }
        if (displaced) continue;
      }
      return { id: s2.id, label: s2.label, emoji: s2.emoji };
    }
    return null;
  }

  // ---- Apply -----------------------------------------------------------
  function apply(id) {
    var html = document.documentElement;
    if (!id) {
      html.removeAttribute("data-season");
      ACTIVE = null;
    } else {
      html.setAttribute("data-season", id);
      var s = (SEASONS || []).find(function (x) { return x.id === id; });
      ACTIVE = s ? { id: s.id, label: s.label, emoji: s.emoji } : { id: id };
    }
    // Notify listeners (e.g. analytics, dynamic-scene)
    try {
      window.dispatchEvent(new CustomEvent("bipbip-season-changed", {
        detail: { season: ACTIVE }
      }));
    } catch (e) {}
  }

  function listSeasons() { return SEASONS ? SEASONS.slice() : []; }
  function getActive() { return ACTIVE; }

  // ---- Particles overlay ----------------------------------------------
  var ANIM_FOR = {
    snow: "fall", halloween: "fall", eggs: "fall", pencils: "fall",
    hearts: "rise", lanterns: "rise", flags: "rise", sun: "rise",
    fireworks: "twinkle"
  };
  var GLYPH_FOR = {
    noel: { kind: "snow",      glyph: { type: "dot" } },
    nouvel: { kind: "fireworks", glyph: { type: "firework", colors: ["#FDE68A","#EC4899","#60A5FA","#A78BFA"] } },
    valentin: { kind: "hearts",  glyph: { type: "emoji", char: "💖" } },
    ramadan:  { kind: "lanterns", glyph: { type: "emoji", char: "🏮" } },
    paques:   { kind: "eggs",    glyph: { type: "emoji", char: "🥚" } },
    indep:    { kind: "flags",   glyph: { type: "emoji", char: "🇨🇮" } },
    rentree:  { kind: "pencils", glyph: { type: "emoji", char: "✏️" } },
    halloween:{ kind: "halloween", glyph: { type: "emoji", char: "🎃" } },
    ete:      { kind: "sun",     glyph: { type: "emoji", char: "🌴" } }
  };

  function mountParticles(opts) {
    unmountParticles();
    if (!ACTIVE || !ACTIVE.id) return;
    var conf = GLYPH_FOR[ACTIVE.id];
    if (!conf) return;
    var density = (opts && typeof opts.density === "number") ? opts.density : 40;
    // Respect lite-mode + reduced-motion
    try {
      if (document.documentElement.classList.contains("bipbip-lite")) return;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch (e) {}

    var wrap = document.createElement("div");
    wrap.className = "bb-particles";
    wrap.setAttribute("aria-hidden", "true");
    if (opts && opts.attachTo === "card") wrap.setAttribute("data-attach", "card");

    var anim = ANIM_FOR[conf.kind] || "fall";
    for (var i = 0; i < density; i++) {
      var p = document.createElement("div");
      p.className = "bb-particle";
      p.setAttribute("data-anim", anim);
      var left = Math.random() * 100;
      var dur = 6 + Math.random() * 14;
      var delay = -Math.random() * 14;
      var size = 0.7 + Math.random() * 1.1;
      p.style.left = left.toFixed(2) + "%";
      p.style.setProperty("--bb-p-dur", dur.toFixed(2) + "s");
      p.style.setProperty("--bb-p-delay", delay.toFixed(2) + "s");
      p.style.fontSize = (16 * size).toFixed(1) + "px";

      if (conf.glyph.type === "dot") {
        p.classList.add("bb-glyph-dot");
        var sz = Math.round(8 * size);
        p.style.width = sz + "px";
        p.style.height = sz + "px";
      } else if (conf.glyph.type === "firework") {
        p.classList.add("bb-glyph-firework");
        var color = conf.glyph.colors[Math.floor(Math.random() * conf.glyph.colors.length)];
        p.style.color = color;
        p.style.background = color;
        var fsz = Math.round(8 * size);
        p.style.width = fsz + "px";
        p.style.height = fsz + "px";
        p.style.top = (Math.random() * 100) + "%";
      } else if (conf.glyph.type === "emoji") {
        p.textContent = conf.glyph.char;
      }
      wrap.appendChild(p);
    }
    (opts && opts.parent ? opts.parent : document.body).appendChild(wrap);
    PARTICLE_EL = wrap;
  }

  function unmountParticles() {
    if (PARTICLE_EL && PARTICLE_EL.parentNode) {
      PARTICLE_EL.parentNode.removeChild(PARTICLE_EL);
    }
    PARTICLE_EL = null;
  }

  // ---- Boot ------------------------------------------------------------
  function ensureStylesheetsLoaded() {
    var have = function (href) {
      return Array.from(document.styleSheets).some(function (s) {
        return s.href && s.href.indexOf(href) !== -1;
      });
    };
    var inject = function (href) {
      if (have(href)) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = THEME_BASE + href;
      document.head.appendChild(link);
    };
    inject("theme-tokens.css");
    inject("theme-particles.css");
  }

  function bootstrap(opts) {
    ensureStylesheetsLoaded();
    var url = THEME_BASE + "seasons.json";
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        SEASONS = (data && data.seasons) || [];
        var detected = detect();
        apply(detected ? detected.id : null);
        if (!opts || opts.particles !== false) {
          mountParticles({ density: (opts && opts.density) || 40 });
        }
        return ACTIVE;
      })
      .catch(function (err) {
        console.warn("[BipbipTheme] seasons.json load failed:", err);
        return null;
      });
  }

  window.BipbipTheme = {
    bootstrap: bootstrap,
    detect: detect,
    apply: apply,
    listSeasons: listSeasons,
    getActive: getActive,
    mountParticles: mountParticles,
    unmountParticles: unmountParticles,
    setOverride: function (id) {
      try {
        if (!id || id === "default" || id === "none") {
          window.localStorage.removeItem(OVERRIDE_KEY);
        } else {
          window.localStorage.setItem(OVERRIDE_KEY, id);
        }
      } catch (e) {}
      var d = detect();
      apply(d ? d.id : null);
      mountParticles();
    }
  };

  // Auto-bootstrap unless opted out via <script data-no-auto>
  if (!document.currentScript || !document.currentScript.hasAttribute("data-no-auto")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { bootstrap(); });
    } else {
      bootstrap();
    }
  }
})();
