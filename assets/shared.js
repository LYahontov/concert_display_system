/* Concert Screen — общий код пульта и экрана вывода */
(function () {
  'use strict';
  const CS = (window.CS = {});

  CS.KEY_STATE = 'cs-state-v1';
  CS.KEY_PING = 'cs-ping-v1';

  CS.DEFAULT_SETTINGS = {
    aspect: '16:9', safe: 6, offsetX: 0, offsetY: 0, scale: 100, flipH: false, grid: false,
    bgColor: '#16182a', bgMediaId: null, bgDim: 25, bgFull: true,
    fadeOut: 350, logoSize: 55, imageSize: 100,
  };
  CS.DEFAULT_STYLE = {
    lang: 'ru', fontRu: 'Inter', fontEn: 'Inter', bold: true, italic: false, upper: false,
    color: '#ffffff', sizeMode: 'auto', size: 14, maxSize: 26, lineHeight: 1.15, letterSpacing: 0,
    preset: 'clean', accent: '#000000',
    effect: 'type', speed: 55, letterFade: 250, duration: 900, jitter: true,
    cursor: true, cursorShape: 'bar', cursorAfter: 'blink',
  };
  CS.ASPECTS = { '16:9': 16 / 9, '16:10': 16 / 10, '4:3': 4 / 3, 'fill': 0 };
  CS.LETTER_FX = { type: 'fx-type', letters: 'fx-letters', up: 'fx-up', blurl: 'fx-blurl' };
  CS.WHOLE_FX = { fade: 'anim-fade', rise: 'anim-rise', zoom: 'anim-zoom', blur: 'anim-blur', flicker: 'anim-flicker', none: '' };

  /* детерминированный случайный ритм: экран и монитор пульта печатают одинаково */
  CS.rng = (seed) => {
    let h = 1779033703 ^ String(seed).length;
    for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  CS.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  CS.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  CS.merge = (def, obj) => Object.assign({}, def, obj || {});
  CS.lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  CS.lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  /* ---------- IndexedDB для медиафайлов ---------- */
  let dbp = null;
  CS.db = {
    open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('concert-screen', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('media', { keyPath: 'id' });
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
      return dbp;
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('media', mode); const s = t.objectStore('media');
        const out = fn(s); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
      });
    },
    put(rec) { return this.tx('readwrite', s => s.put(rec)); },
    get(id) { return this.tx('readonly', s => s.get(id)); },
    all() { return this.tx('readonly', s => s.getAll()); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); },
  };

  /* ---------- Рендер сцены ---------- */
  const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

  class Stage {
    constructor(host, opts) {
      this.opts = opts || {};
      this.getMedia = this.opts.getMedia || (() => null);
      this.root = el('div', 'cs-root', host);
      this.world = el('div', 'cs-world', this.root);
      this.bg = el('div', 'cs-bg', this.world);
      this.stage = el('div', 'cs-stage', this.world);
      this.safe = el('div', 'cs-safe', this.stage);
      this.grid = el('div', 'cs-grid', this.stage);
      this.grid.innerHTML = '<div class="cs-gsafe"></div><div class="cs-gcirc"></div><div class="cs-glbl"></div>';
      this.black = el('div', 'cs-black', this.root);
      this.settings = CS.merge(CS.DEFAULT_SETTINGS);
      this.live = null; this.layer = null; this.token = 0; this.timers = [];
      this.bgKey = null;
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(this.stage);
      if (document.fonts) document.fonts.addEventListener('loadingdone', () => this.fit());
    }

    setSettings(s) {
      const o = this.settings; s = CS.merge(CS.DEFAULT_SETTINGS, s); this.settings = s;
      const r = this.root.style, st = this.stage;
      const ar = CS.ASPECTS[s.aspect];
      st.classList.toggle('fill', !ar);
      if (ar) r.setProperty('--ar', ar);
      r.setProperty('--safe', s.safe + '%');
      r.setProperty('--ox', s.offsetX + '%');
      r.setProperty('--oy', s.offsetY + '%');
      r.setProperty('--sc', s.scale / 100);
      r.setProperty('--bg', s.bgColor);
      r.setProperty('--dim', s.bgDim / 100);
      r.setProperty('--fo', s.fadeOut + 'ms');
      r.setProperty('--bo', Math.max(250, s.fadeOut) + 'ms');
      this.world.classList.toggle('flip', !!s.flipH);
      this.grid.classList.toggle('on', !!s.grid);
      this.grid.querySelector('.cs-glbl').textContent = (s.aspect === 'fill' ? 'весь экран' : s.aspect) + ' · поля ' + s.safe + '%';
      // фон: на весь экран или только в кадре
      const bgParent = s.bgFull ? this.world : this.stage;
      if (this.bg.parentNode !== bgParent) bgParent.insertBefore(this.bg, bgParent.firstChild);
      this.renderBg();
      // перерисовать логотип/картинку при смене размеров
      if (this.live && (this.live.mode === 'logo' || this.live.mode === 'image') && o &&
          (o.logoSize !== s.logoSize || o.imageSize !== s.imageSize)) this.applyMediaSize();
      this.fit();
    }

    renderBg() {
      const s = this.settings;
      const m = s.bgMediaId ? this.getMedia(s.bgMediaId) : null;
      const key = m ? s.bgMediaId : null;
      if (key === this.bgKey) return;
      this.bgKey = key;
      this.bg.innerHTML = '';
      if (m) {
        let node;
        if (m.kind === 'video') {
          node = el('video'); node.muted = true; node.loop = true; node.autoplay = true; node.playsInline = true;
          node.setAttribute('muted', ''); node.src = m.url; node.play().catch(() => {});
        } else { node = el('img'); node.src = m.url; node.alt = ''; }
        node.className = 'media-in'; this.bg.appendChild(node);
      }
      el('div', 'cs-dim', this.bg);
    }

    mediaArrived() { this.renderBg(); if (this.live && this.pendingMedia) this.show(this.live, { animate: false }); }

    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

    /* live = {id, mode:'text'|'image'|'logo'|'empty'|'black', text, style, mediaId, logoId} */
    show(live, opt) {
      opt = opt || {};
      const animate = opt.animate !== false;
      this.token++; const tok = this.token; this.clearTimers();
      this.live = live; this.pendingMedia = false;
      this.rng = CS.rng(live.id || 'x');
      const s = this.settings;
      // сообщить, когда показ закончил появляться (нужно для автопоказа)
      const done = (ms) => { const f = () => { if (tok === this.token && this.opts.onDone) this.opts.onDone(live.id); }; if (ms > 0) this.timers.push(setTimeout(f, ms)); else f(); };
      this.done = done;
      const old = this.layer; this.layer = null;

      if (live.mode === 'black') {
        this.black.style.transitionDuration = animate ? '' : '0ms';
        this.black.classList.add('on');
        const kill = () => { if (tok === this.token) this.safe.innerHTML = ''; };
        if (animate) this.timers.push(setTimeout(kill, Math.max(250, s.fadeOut) + 30)); else kill();
        done(0); return;
      }
      const wasBlack = this.black.classList.contains('on');
      this.black.style.transitionDuration = animate ? '' : '0ms';
      this.black.classList.remove('on');

      // убрать предыдущий слой
      let delay = 0;
      this.safe.querySelectorAll('.cs-layer').forEach(l => {
        if (!animate || wasBlack || s.fadeOut <= 0) { l.remove(); return; }
        l.classList.add('out'); setTimeout(() => l.remove(), s.fadeOut + 40);
        if (l === old) delay = s.fadeOut;
      });
      if (live.mode === 'empty') { done(delay); return; }

      const layer = el('div', 'cs-layer');
      const st = CS.merge(CS.DEFAULT_STYLE, live.style);
      layer.style.setProperty('--dur', st.duration + 'ms');
      layer.style.setProperty('--lf', st.letterFade + 'ms');
      this.layer = layer;

      if (live.mode === 'text') this.buildText(layer, live.text || '', st);
      else {
        const id = live.mode === 'logo' ? live.logoId : live.mediaId;
        const m = id ? this.getMedia(id) : null;
        if (!m) { this.pendingMedia = true; return; }
        let node;
        if (m.kind === 'video') {
          node = el('video', 'cs-media'); node.muted = true; node.loop = true; node.autoplay = true; node.playsInline = true;
          node.src = m.url; node.play().catch(() => {});
        } else { node = el('img', 'cs-media'); node.src = m.url; node.alt = ''; }
        layer.appendChild(node); this.mediaNode = node;
      }

      const start = () => {
        if (tok !== this.token) return;
        this.safe.appendChild(layer);
        if (live.mode === 'text') { this.fit(); this.fontsThenFit(st, live.text); }
        else this.applyMediaSize();
        if (!animate) { this.revealAll(st, true); done(0); return; }
        if (live.mode === 'text' && CS.LETTER_FX[st.effect] && st.speed > 0) this.runLetters(st, tok);
        else {
          const fx = CS.WHOLE_FX[st.effect] !== undefined ? CS.WHOLE_FX[st.effect] : 'anim-fade';
          if (fx) layer.classList.add(fx);
          this.revealAll(st, false);
          done(fx ? st.duration : 0);
        }
      };
      if (delay > 0) this.timers.push(setTimeout(start, delay)); else start();
    }

    applyMediaSize() {
      if (!this.layer || !this.mediaNode) return;
      const s = this.settings, pct = this.live.mode === 'logo' ? s.logoSize : s.imageSize;
      this.mediaNode.style.maxHeight = pct + '%'; this.mediaNode.style.maxWidth = pct + '%';
    }

    fontFamily(st) {
      const f = st.lang === 'en' ? st.fontEn : st.fontRu;
      return `'${f}', 'Inter', system-ui, sans-serif`;
    }

    applyTextStyle(t, st) {
      t.className = 'cs-text pr-' + (st.preset || 'clean');
      t.style.fontFamily = this.fontFamily(st);
      t.style.fontWeight = st.bold ? 700 : 400;
      t.style.fontStyle = st.italic ? 'italic' : 'normal';
      t.style.textTransform = st.upper ? 'uppercase' : 'none';
      t.style.lineHeight = st.lineHeight;
      t.style.letterSpacing = (st.letterSpacing / 100) + 'em';
      t.style.setProperty('--txt', st.color);
      t.style.setProperty('--acc', st.accent);
    }

    buildText(layer, text, st) {
      const wrap = el('div', 'cs-tw' + (st.preset === 'box' ? ' box' : ''), layer); this.textWrap = wrap;
      const mk = (cls) => {
        const t = el('div', '', wrap);
        this.applyTextStyle(t, st); if (cls) t.classList.add(cls);
        if (CS.LETTER_FX[st.effect]) t.classList.add(CS.LETTER_FX[st.effect]);
        const chars = [];
        let word = null; // буквы слова в одной обёртке без переносов: «Нью-Йорке» не разорвётся на дефисе
        for (const c of Array.from(text)) {
          if (c === '\n') { word = null; if (chars.length) chars[chars.length - 1].classList.add('nl'); t.appendChild(document.createElement('br')); continue; }
          let parent = t;
          if (/\s/.test(c)) word = null;
          else { if (!word) word = el('span', 'w', t); parent = word; }
          const s = el('span', 'ch', parent); s.textContent = c; chars.push(s);
        }
        if (!chars.length) t.appendChild(document.createTextNode('\u200b'));
        return [t, chars];
      };
      // для «плашки» фон рисуется отдельным слоем позади, чтобы не перекрывать буквы
      if (st.preset === 'box') { [this.backEl, this.backChars] = mk('cs-back'); }
      else { this.backEl = null; this.backChars = []; }
      [this.textEl, this.chars] = mk('cs-front');
      this.cur = st.cursor ? el('span', 'cs-cur cur-' + (st.cursorShape || 'bar')) : null;
    }

    reveal(i) { this.chars[i].classList.add('in'); if (this.backChars[i]) this.backChars[i].classList.add('in'); }

    /* сменить оформление текущего текста без анимации */
    restyle(style) {
      if (!this.live || this.live.mode !== 'text' || !this.textEl) return;
      this.show(Object.assign({}, this.live, { style }), { animate: false });
    }

    revealAll(st, instant) {
      if (!this.chars) return;
      if (this.layer && this.live && this.live.mode === 'text') {
        this.chars.forEach((c, i) => this.reveal(i));
        if (instant && this.layer) this.layer.querySelectorAll('.ch').forEach(c => { c.style.transition = 'none'; });
        this.placeCursorEnd(st);
      }
    }

    placeCursorEnd(st) {
      if (!this.cur || !this.textEl) return;
      const lastCh = this.chars[this.chars.length - 1];
      if (lastCh) lastCh.after(this.cur); else this.textEl.appendChild(this.cur);
      this.finishCursor(st);
    }

    finishCursor(st) {
      const cur = this.cur; if (!cur) return;
      if (st.cursorAfter === 'hide') { cur.classList.remove('blink'); this.timers.push(setTimeout(() => cur.classList.add('gone'), 900)); }
      else if (st.cursorAfter === 'blink') cur.classList.add('blink');
    }

    runLetters(st, tok) {
      const chars = this.chars, cur = this.cur;
      let i = 0;
      const per = Math.max(1, Math.round(16 / Math.max(1, st.speed)));
      if (cur) { if (chars[0]) chars[0].before(cur); else this.textEl.appendChild(cur); }
      const step = () => {
        if (tok !== this.token) return;
        if (i >= chars.length) { this.finishCursor(st); this.done(st.effect === 'type' ? 0 : st.letterFade); return; }
        let last;
        for (let k = 0; k < per && i < chars.length; k++, i++) { last = chars[i]; this.reveal(i); }
        if (cur) last.after(cur);
        let d = st.speed;
        if (st.jitter) {
          d *= 0.55 + this.rng() * 0.9;
          const c = last.textContent;
          if (/[.!?…]/.test(c)) d += st.speed * 6; else if (/[,;:—–]/.test(c)) d += st.speed * 3;
          if (last.classList.contains('nl')) d += st.speed * 4;
        }
        this.timers.push(setTimeout(step, d));
      };
      const lead = cur ? Math.min(700, 180 + st.speed * 4) : 0;
      this.timers.push(setTimeout(step, lead));
    }

    async fontsThenFit(st, text) {
      if (!document.fonts) return;
      const tok = this.token;
      const spec = `${st.italic ? 'italic ' : ''}${st.bold ? 700 : 400} 40px ${this.fontFamily(st)}`;
      try { await Promise.race([document.fonts.load(spec, text || 'Аa'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
      if (tok === this.token) this.fit();
    }

    fit() {
      const t = this.textEl;
      if (!t || !t.isConnected || !this.live || this.live.mode !== 'text') return;
      const st = CS.merge(CS.DEFAULT_STYLE, this.live.style);
      if (st.sizeMode === 'manual') { this.textWrap.style.fontSize = st.size + 'cqh'; this.markLineEnds(); return; }
      const H = this.safe.clientHeight;
      if (!this.safe.clientWidth || !H) return;
      const w = this.textWrap;
      let lo = 0.5, hi = Math.max(1, st.maxSize);
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2; w.style.fontSize = mid + 'cqh';
        if (t.scrollWidth <= t.clientWidth + 1 && w.offsetHeight <= H + 1) lo = mid; else hi = mid;
      }
      w.style.fontSize = lo + 'cqh';
      this.markLineEnds();
    }

    /* пробел в конце строки не должен тянуть за собой плашку */
    markLineEnds() {
      if (!this.backEl) return;
      const f = this.chars, b = this.backChars;
      for (let i = 0; i < f.length; i++) {
        if (f[i].textContent !== ' ') continue;
        const nx = f[i + 1];
        const eol = !nx || nx.offsetTop > f[i].offsetTop + 2 || (f[i].nextSibling && f[i].nextSibling.nodeName === 'BR');
        b[i].classList.toggle('eol', !!eol);
      }
    }
  }
  CS.Stage = Stage;
})();
