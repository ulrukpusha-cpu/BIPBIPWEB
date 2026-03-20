/* ============================================
   BipbipDynamicScene v4.1 — Battery Optimized
   Premium effects + aggressive power saving
   ============================================ */

(function () {
  'use strict';

  // ── PERF DETECTION ──
  const IS_LOW_END = (function () {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    return mem <= 2 || cores <= 2;
  })();

  const CFG = {
    STAR_COUNT:      IS_LOW_END ? 12 : 25,
    RAIN_COUNT:      IS_LOW_END ? 12 : 25,
    LIGHT_DOT_COUNT: IS_LOW_END ? 6  : 12,
    CLOUD_COUNT:     IS_LOW_END ? 1  : 2,
    PARTICLE_COUNT:  IS_LOW_END ? 0  : 10,
    FIREFLY_COUNT:   IS_LOW_END ? 3  : 6,
    UPDATE_INTERVAL: 60000, // 1 min always (no need to check more)
    SUNRISE: 6,
    SUNSET_START: 17,
    SUNSET_END: 19,
  };

  const el = (tag, cls, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  };
  const rand = (a, b) => Math.random() * (b - a) + a;

  function getPhase(hour) {
    if (hour === undefined) {
      const now = new Date();
      hour = now.getHours() + now.getMinutes() / 60;
    }
    if (hour >= CFG.SUNRISE && hour < CFG.SUNSET_START) return 'day';
    if (hour >= CFG.SUNSET_START && hour < CFG.SUNSET_END) return 'sunset';
    return 'night';
  }

  function getTrigger(hour) {
    if (hour >= 6 && hour < 9)   return { type: 'morning', label: 'Bonus Matin' };
    if (hour >= 18 && hour < 20) return { type: 'evening', label: 'Promo Soir' };
    if (hour >= 20 || hour < 6)  return { type: 'night',  label: 'Mode Calme' };
    return null;
  }

  class BipbipDynamicScene {
    constructor(selector) {
      this.root = typeof selector === 'string'
        ? document.querySelector(selector)
        : selector;

      if (!this.root) {
        console.error('[BipbipScene] Container introuvable:', selector);
        return;
      }

      this.root.classList.add('bds-container');
      if (IS_LOW_END) this.root.dataset.perf = 'low';
      this._phase = null;
      this._lastTrigger = null;
      this._visible = true;
      this._parallaxX = 0;
      this._parallaxY = 0;
      this._animEls = []; // cached animated elements

      this._build();
      this._preloadImages();
      this._update();
      this._tick = setInterval(() => this._update(), CFG.UPDATE_INTERVAL);

      // Pause when offscreen
      this._observer = new IntersectionObserver(
        ([entry]) => this._onVisibility(entry.isIntersecting),
        { threshold: 0.1 }
      );
      this._observer.observe(this.root);

      // Pause on background tab
      this._visHandler = () => this._onVisibility(!document.hidden);
      document.addEventListener('visibilitychange', this._visHandler);

      // Parallax (not on low-end)
      if (!IS_LOW_END) this._initParallax();

      if (IS_LOW_END) console.log('[BipbipScene] Mode basse consommation');
    }

    _preloadImages() {
      ['scene-day.png', 'scene-sunset.png', 'scene-night.png'].forEach(src => {
        const img = new Image();
        img.src = 'assets/' + src;
      });
    }

    // ── PARALLAX (throttled) ──
    _initParallax() {
      let lastGyro = 0;
      const GYRO_THROTTLE = 100; // ms

      if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', (e) => {
          const now = Date.now();
          if (now - lastGyro < GYRO_THROTTLE || !this._visible) return;
          lastGyro = now;
          if (!e.gamma && !e.beta) return;
          const x = Math.max(-6, Math.min(6, e.gamma * 0.12));
          const y = Math.max(-4, Math.min(4, (e.beta - 45) * 0.08));
          this._applyParallax(x, y);
        }, { passive: true });
      }

      let mouseRAF = null;
      this.root.addEventListener('mousemove', (e) => {
        if (mouseRAF || !this._visible) return;
        mouseRAF = requestAnimationFrame(() => {
          const rect = this.root.getBoundingClientRect();
          const cx = (e.clientX - rect.left) / rect.width - 0.5;
          const cy = (e.clientY - rect.top) / rect.height - 0.5;
          this._applyParallax(cx * 6, cy * 4);
          mouseRAF = null;
        });
      }, { passive: true });

      this.root.addEventListener('mouseleave', () => {
        this._applyParallax(0, 0);
      }, { passive: true });
    }

    _applyParallax(x, y) {
      this._parallaxX = x;
      this._parallaxY = y;
      const active = this._layers[this._phase];
      if (active) {
        active.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.05)`;
      }
    }

    // ── VISIBILITY (battery saver) ──
    _onVisibility(visible) {
      if (this._visible === visible) return;
      this._visible = visible;
      const state = visible ? 'running' : 'paused';
      // Use cached list instead of querySelectorAll
      for (let i = 0; i < this._animEls.length; i++) {
        this._animEls[i].style.animationPlayState = state;
      }
    }

    // ── BUILD DOM ──
    _build() {
      const frag = document.createDocumentFragment();

      // Scene layers
      this._layers = {};
      ['day', 'sunset', 'night'].forEach(p => {
        const layer = el('div', `bds-scene-layer bds-scene-${p}`, frag);
        layer.style.transform = 'scale(1.05)';
        this._layers[p] = layer;
      });

      // Lens flare (jour) — skipped on low-end via CSS
      this._flare = el('div', 'bds-lens-flare', frag);

      // Shooting stars (nuit) — only 2 elements, very light
      this._shootingStars = el('div', 'bds-shooting-stars', frag);
      const s1 = el('div', 'bds-shooting-star bds-shooting-star--1', this._shootingStars);
      s1.style.cssText = 'top:12%;right:25%';
      this._animEls.push(s1);
      if (!IS_LOW_END) {
        const s2 = el('div', 'bds-shooting-star bds-shooting-star--2', this._shootingStars);
        s2.style.cssText = 'top:22%;right:40%';
        this._animEls.push(s2);
      }

      // Aurora (nuit) — skipped on low-end via CSS
      this._aurora = el('div', 'bds-aurora', frag);
      const aw1 = el('div', 'bds-aurora-wave', this._aurora);
      const aw2 = el('div', 'bds-aurora-wave', this._aurora);
      this._animEls.push(aw1, aw2);

      // Dust particles (jour) — 0 on low-end
      this._particles = el('div', 'bds-particles', frag);
      for (let i = 0; i < CFG.PARTICLE_COUNT; i++) {
        const p = el('div', 'bds-particle', this._particles);
        p.style.cssText =
          `left:${rand(10,90)}%;top:${rand(15,70)}%;` +
          `--dur:${rand(7,14).toFixed(0)}s;--delay:${rand(0,7).toFixed(0)}s;` +
          `--dx:${rand(-25,25).toFixed(0)}px;--dy:${rand(-15,10).toFixed(0)}px`;
        this._animEls.push(p);
      }

      // Fireflies (sunset)
      this._fireflies = el('div', 'bds-fireflies', frag);
      for (let i = 0; i < CFG.FIREFLY_COUNT; i++) {
        const f = el('div', 'bds-firefly', this._fireflies);
        f.style.cssText =
          `left:${rand(10,85)}%;top:${rand(30,75)}%;` +
          `--dur:${rand(6,12).toFixed(0)}s;--delay:${rand(0,6).toFixed(0)}s;` +
          `--fx:${rand(-35,35).toFixed(0)}px;--fy:${rand(-25,15).toFixed(0)}px`;
        this._animEls.push(f);
      }

      // Stars
      this._stars = el('div', 'bds-stars', frag);
      for (let i = 0; i < CFG.STAR_COUNT; i++) {
        const s = el('div', `bds-star${Math.random() > 0.88 ? ' bds-star--big' : ''}`, this._stars);
        s.style.cssText = `left:${rand(3,97)}%;top:${rand(3,42)}%;--dur:${rand(2.5,6).toFixed(0)}s;--delay:${rand(0,5).toFixed(0)}s`;
        this._animEls.push(s);
      }

      // Clouds
      const clouds = el('div', 'bds-clouds', frag);
      const c1 = el('div', 'bds-cloud bds-cloud--1', clouds);
      this._animEls.push(c1);
      if (CFG.CLOUD_COUNT >= 2) {
        const c2 = el('div', 'bds-cloud bds-cloud--2', clouds);
        this._animEls.push(c2);
      }

      // Night glow
      this._glow = el('div', 'bds-night-glow', frag);

      // Light dots
      this._dots = el('div', 'bds-light-dots', frag);
      for (let i = 0; i < CFG.LIGHT_DOT_COUNT; i++) {
        const d = el('div', 'bds-light-dot', this._dots);
        d.style.cssText = `left:${rand(15,90)}%;bottom:${rand(15,55)}%;--delay:${rand(0,4).toFixed(0)}s`;
        this._animEls.push(d);
      }

      // Rain (lazy)
      this._rain = el('div', 'bds-rain', frag);
      this._rainBuilt = false;

      // Shimmer (triggered on phase change, not continuous)
      this._shimmer = el('div', 'bds-shimmer', frag);

      // Vignette
      el('div', 'bds-vignette', frag);

      // Time
      this._timeEl = el('div', 'bds-time', frag);

      // Badge
      this._badge = el('div', 'bds-trigger-badge', frag);

      this.root.appendChild(frag);
    }

    _buildRain() {
      if (this._rainBuilt) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < CFG.RAIN_COUNT; i++) {
        const r = el('div', 'bds-raindrop', frag);
        r.style.cssText = `--x:${rand(0,100)}%;--dur:${rand(0.5,1).toFixed(2)}s;--delay:${rand(0,0.8).toFixed(2)}s`;
        this._animEls.push(r);
      }
      this._rain.appendChild(frag);
      this._rainBuilt = true;
    }

    // ── SHIMMER (fires once per phase change) ──
    _triggerShimmer() {
      if (IS_LOW_END) return;
      this._shimmer.classList.remove('bds-shimmer--active');
      // Force reflow to restart animation
      void this._shimmer.offsetWidth;
      this._shimmer.classList.add('bds-shimmer--active');
      // Remove after animation completes (1.5s)
      clearTimeout(this._shimmerTimeout);
      this._shimmerTimeout = setTimeout(() => {
        this._shimmer.classList.remove('bds-shimmer--active');
      }, 2000);
    }

    // ── UPDATE ──
    _update() {
      if (!this._visible) return;

      const now = new Date();
      const hour = now.getHours() + now.getMinutes() / 60;
      const phase = getPhase(hour);

      this._timeEl.textContent =
        now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0');

      if (phase !== this._phase) {
        this._applyPhase(phase);
        this._triggerShimmer();
        console.log(`[BipbipScene] Phase: ${phase} (${this._timeEl.textContent})`);
      }

      const trigger = getTrigger(now.getHours());
      const tType = trigger ? trigger.type : null;
      if (tType !== this._lastTrigger) {
        this._lastTrigger = tType;
        this._badge.className = 'bds-trigger-badge';
        if (trigger) {
          this._badge.classList.add(`bds-trigger-badge--${trigger.type}`, 'bds-trigger-badge--visible');
          this._badge.textContent = trigger.label;
          console.log(`[BipbipScene] Trigger: ${trigger.label}`);
        }
      }
    }

    _applyPhase(phase) {
      this._phase = phase;
      this.root.dataset.phase = phase;

      for (const p in this._layers) {
        const active = p === phase;
        this._layers[p].classList.toggle('bds-scene-layer--active', active);
        this._layers[p].style.transform = active
          ? `translate3d(${this._parallaxX}px, ${this._parallaxY}px, 0) scale(1.05)`
          : 'scale(1.05)';
      }

      const isNight = phase === 'night';
      const isSunset = phase === 'sunset';
      const isDay = phase === 'day';

      this._stars.classList.toggle('bds-stars--visible', isNight);
      this._shootingStars.classList.toggle('bds-shooting-stars--visible', isNight);
      this._aurora.classList.toggle('bds-aurora--visible', isNight);
      this._glow.classList.toggle('bds-night-glow--active', isNight);
      this._dots.classList.toggle('bds-light-dots--visible', isNight);
      this._flare.classList.toggle('bds-lens-flare--visible', isDay);
      this._particles.classList.toggle('bds-particles--visible', isDay);
      this._fireflies.classList.toggle('bds-fireflies--visible', isSunset);
    }

    // ── PUBLIC API ──

    setPhase(phase) {
      if (!['day', 'sunset', 'night'].includes(phase)) return;
      this._applyPhase(phase);
      this._triggerShimmer();
      const fakeH = { day: 8, sunset: 18, night: 22 };
      const trigger = getTrigger(fakeH[phase]);
      this._lastTrigger = trigger ? trigger.type : null;
      this._badge.className = 'bds-trigger-badge';
      if (trigger) {
        this._badge.classList.add(`bds-trigger-badge--${trigger.type}`, 'bds-trigger-badge--visible');
        this._badge.textContent = trigger.label;
      }
      console.log(`[BipbipScene] Phase forcée: ${phase}`);
    }

    setRain(active) {
      if (active) this._buildRain();
      this._rain.classList.toggle('bds-rain--active', !!active);
      console.log(`[BipbipScene] Pluie: ${active ? 'ON' : 'OFF'}`);
    }

    destroy() {
      clearInterval(this._tick);
      clearTimeout(this._shimmerTimeout);
      if (this._observer) this._observer.disconnect();
      document.removeEventListener('visibilitychange', this._visHandler);
      this.root.innerHTML = '';
      this.root.classList.remove('bds-container');
      delete this.root.dataset.phase;
      delete this.root.dataset.perf;
    }
  }

  window.BipbipDynamicScene = BipbipDynamicScene;
})();
