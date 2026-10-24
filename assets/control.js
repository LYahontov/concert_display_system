/* Concert Screen — пульт */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const FONTS = window.CS_FONTS || [{ family: 'Inter', cyr: true }];

  /* ---------- состояние ---------- */
  const saved = CS.lsGet(CS.KEY_STATE, null);
  let settings = CS.merge(CS.DEFAULT_SETTINGS, CS.lsGet('cs-ctl-settings', saved && saved.settings));
  let style = CS.merge(CS.DEFAULT_STYLE, CS.lsGet('cs-ctl-style', null));
  let live = (saved && saved.live) || { id: CS.uid(), mode: 'empty' };
  let logoId = CS.lsGet('cs-ctl-logo', null);
  let queue = CS.lsGet('cs-ctl-queue', []);
  let qptr = CS.lsGet('cs-ctl-qptr', 0);
  let history = CS.lsGet('cs-ctl-history', []);
  let beforeBlack = CS.lsGet('cs-ctl-beforeblack', null);
  const mediaMap = new Map(); // id -> {id,name,kind,blob,url}

  const save = () => {
    CS.lsSet('cs-ctl-settings', settings); CS.lsSet('cs-ctl-style', style); CS.lsSet('cs-ctl-logo', logoId);
    CS.lsSet('cs-ctl-queue', queue); CS.lsSet('cs-ctl-qptr', qptr); CS.lsSet('cs-ctl-history', history);
    CS.lsSet('cs-ctl-beforeblack', beforeBlack);
  };
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- мониторы ---------- */
  const getMedia = id => { const m = mediaMap.get(id); return m ? { url: m.url, kind: m.kind } : null; };
  const prevStage = new CS.Stage($('#prevScreen'), { getMedia });
  const liveStage = new CS.Stage($('#liveScreen'), { getMedia, onDone: id => autoOnDone(id) });

  /* ---------- связь с экраном ---------- */
  let outWin = null, lastPing = 0, lastSession = null, lastHave = [];
  let pubPending = false;
  function publish() { if (pubPending) return; pubPending = true; Promise.resolve().then(() => { pubPending = false; publishNow(); }); }
  function publishNow() {
    const state = { rev: CS.uid(), settings, live, logoId };
    CS.lsSet(CS.KEY_STATE, state);
    const m = {};
    [settings.bgMediaId, live.mediaId, live.logoId, logoId].filter(Boolean).forEach(id => {
      const r = mediaMap.get(id); if (r) m[id] = { blob: r.blob, kind: r.kind };
    });
    if (outWin && !outWin.closed) { try { outWin.postMessage({ cs: 'state', state, media: m }, '*'); } catch (e) {} }
    updateLiveMonitor();
    save();
  }
  function onPing(d, src) {
    if (!d || d.cs !== 'hello') return;
    if (src) outWin = src;
    lastPing = Date.now();
    const need = [settings.bgMediaId, live.mediaId, live.logoId].filter(Boolean);
    const missing = src && need.some(id => mediaMap.has(id) && !(d.have || []).includes(id));
    if (d.session !== lastSession || missing) { lastSession = d.session; publishNow(); }
    lastHave = d.have || [];
    renderStatus();
  }
  window.addEventListener('message', e => onPing(e.data, e.source));
  window.addEventListener('storage', e => { if (e.key === CS.KEY_PING && e.newValue) { try { onPing(JSON.parse(e.newValue), null); } catch (err) {} } });
  function renderStatus() {
    const ok = Date.now() - lastPing < 4000;
    $('#status').classList.toggle('ok', ok);
    $('#status span').textContent = ok ? 'Экран на связи' : 'Экран не подключён';
  }
  setInterval(renderStatus, 1000);

  $('#openOut').addEventListener('click', () => {
    // окно открываем сразу (пока жест пользователя «свежий»), а на проектор переносим потом
    const w = window.open('output.html', 'csOutput', 'popup=yes,width=1280,height=720,left=60,top=60');
    if (!w) { toast('Chrome заблокировал окно. Разрешите всплывающие окна для этой страницы (значок справа в адресной строке) и нажмите ещё раз.', 7000); return; }
    outWin = w;
    toast('Окно экрана открыто. Если оно не переехало на проектор само — перетащите его туда и нажмите в нём F или двойной клик.', 6500);
    moveToProjector(w);
  });
  async function moveToProjector(w) {
    try {
      if (!('getScreenDetails' in window)) return;
      const sd = await window.getScreenDetails(); // при первом запуске Chrome спросит разрешение «Управление окнами»
      const other = sd.screens.find(s => s !== sd.currentScreen && !s.isPrimary) || sd.screens.find(s => s !== sd.currentScreen);
      if (!other || w.closed) return;
      w.moveTo(other.availLeft, other.availTop);
      w.resizeTo(other.availWidth, other.availHeight);
    } catch (e) {}
  }

  /* ---------- монитор эфира ---------- */
  let monId = null, monStyle = null, firstMon = true;
  function updateLiveMonitor() {
    liveStage.setSettings(settings);
    const sj = JSON.stringify(live.style || {});
    if (live.id !== monId) { monId = live.id; monStyle = sj; liveStage.show(Object.assign({ logoId }, live), { animate: !firstMon }); }
    else if (sj !== monStyle) { monStyle = sj; liveStage.restyle(live.style); }
    firstMon = false;
    $('#liveMeta').textContent = describe(live);
    $('#bBlack').classList.toggle('on', live.mode === 'black');
    $('#bBlack').firstChild.textContent = live.mode === 'black' ? 'ВЕРНУТЬ ' : 'ЗАТЕМНИТЬ ';
    $('#bEmpty').classList.toggle('on', live.mode === 'empty');
    $('#bLogo').classList.toggle('on', live.mode === 'logo');
    updateBadges();
  }
  function describe(l) {
    if (!l) return '';
    switch (l.mode) {
      case 'text': return '«' + (l.text || '').replace(/\n/g, ' / ').slice(0, 90) + '»';
      case 'image': { const m = mediaMap.get(l.mediaId); return 'Медиа: ' + (m ? m.name : '—'); }
      case 'logo': return 'Логотип';
      case 'empty': return 'Пустой экран (только фон)';
      case 'black': return 'Затемнено';
    }
    return '';
  }

  /* ---------- отправка ---------- */
  function goLive(l, opts) {
    opts = opts || {};
    if (l.mode !== 'black') beforeBlack = null;
    live = Object.assign({}, l, { id: CS.uid() });
    if (autoOn && !opts.auto) autoInterrupt(l.mode, opts.restore);
    if (!opts.noHistory && (l.mode === 'text' || l.mode === 'image' || l.mode === 'logo')) {
      history.unshift({ t: Date.now(), live: clone(live) });
      if (history.length > 300) history.length = 300;
      renderHistory();
    }
    publishNow();
  }
  function sendText(text, lang, opts) {
    if (!text || !text.trim()) { toast('Пустое сообщение не отправлено'); return false; }
    const st = clone(style); if (lang) st.lang = lang;
    goLive({ mode: 'text', text: text.replace(/\s+$/, ''), style: st }, opts);
    return true;
  }
  function sendMedia(id) { goLive({ mode: 'image', mediaId: id, style: clone(style) }); }
  function sendLogo() {
    if (live.mode === 'logo') { sendEmpty(); return; } // повторное нажатие ЛОГО убирает его с экрана
    if (!logoId || !mediaMap.has(logoId)) { switchTab('media'); toast('Логотип не назначен: загрузите файл во вкладке «Медиа» и нажмите «Лого».', 5000); return; }
    goLive({ mode: 'logo', logoId, style: clone(style) });
  }
  function sendEmpty() { goLive({ mode: 'empty' }); }
  function toggleBlack() {
    if (live.mode === 'black') {
      const back = beforeBlack; beforeBlack = null;
      goLive(back && back.mode !== 'black' ? Object.assign({}, back, { id: undefined }) : { mode: 'empty' }, { noHistory: true, restore: true });
    } else { const prev = clone(live); goLive({ mode: 'black' }); beforeBlack = prev; save(); }
  }
  function replay() { if (live.mode === 'black') return; goLive(Object.assign({}, clone(live), { id: CS.uid() }), { noHistory: true }); }

  const input = $('#input');
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (editId) {
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); saveEdit(); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addToQueue(input.value); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); doSend(); return; }
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyB') { e.preventDefault(); setVal('style', 'bold', !style.bold); }
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyI') { e.preventDefault(); setVal('style', 'italic', !style.italic); }
  });
  function doSend() {
    if (sendText(input.value)) { if ($('#clearAfter').checked) { input.value = ''; onDraft(); } }
  }
  $('#send').addEventListener('click', () => { doSend(); input.focus(); });
  $('#toQueue').addEventListener('click', () => { addToQueue(input.value); input.focus(); });

  /* ---------- превью черновика ---------- */
  const detectLang = t => {
    const cyr = (t.match(/[Ѐ-ӿ]/g) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length;
    if (!cyr && !lat) return null; return cyr >= lat ? 'ru' : 'en';
  };
  let draftT = null;
  function onDraft() { clearTimeout(draftT); draftT = setTimeout(() => refreshPreview(false), 40); }
  input.addEventListener('input', onDraft);
  function refreshPreview(animate) {
    prevStage.setSettings(settings);
    const text = input.value;
    $('#prevPh').classList.toggle('hidden', !!text.trim());
    prevStage.show({ id: CS.uid(), mode: text.trim() ? 'text' : 'empty', text, style }, { animate: !!animate });
    const n = Array.from(text).length;
    $('#count').textContent = n ? n + ' зн.' : '';
    $('#prevMeta').textContent = (style.lang === 'en' ? 'EN · ' + style.fontEn : 'RU · ' + style.fontRu) +
      (style.bold ? ' · жирный' : '') + (style.italic ? ' · курсив' : '') + ' · ' + effectName(style.effect);
    const dl = detectLang(text), w = $('#langWarn');
    if (dl && dl !== style.lang) {
      w.innerHTML = `Похоже на ${dl === 'ru' ? 'русский' : 'английский'}, а выбран ${style.lang.toUpperCase()} <button class="btn xs" id="fixLang">Переключить</button>`;
      w.classList.remove('hidden'); $('#fixLang').onclick = () => { setVal('style', 'lang', dl); input.focus(); };
    } else w.classList.add('hidden');
  }
  const effectName = v => { const o = $(`select[data-s="style.effect"] option[value="${v}"]`); return o ? o.textContent.toLowerCase() : v; };
  $('#playPrev').addEventListener('click', () => refreshPreview(true));

  /* ---------- привязка контролов ---------- */
  const objOf = n => (n === 'style' ? style : settings);
  const UNITS = {
    'style.maxSize': v => v + '% выс.', 'style.size': v => v + '% выс.', 'style.lineHeight': v => (+v).toFixed(2),
    'style.letterSpacing': v => (v > 0 ? '+' : '') + v, 'style.speed': v => v + ' мс/знак', 'style.letterFade': v => v + ' мс',
    'style.duration': v => (v / 1000).toFixed(2) + ' с', 'settings.bgDim': v => v + '%', 'settings.safe': v => v + '%',
    'settings.offsetX': v => (v > 0 ? '+' : '') + v + '%', 'settings.offsetY': v => (v > 0 ? '+' : '') + v + '%',
    'settings.scale': v => v + '%', 'settings.fadeOut': v => v + ' мс', 'settings.logoSize': v => v + '%', 'settings.imageSize': v => v + '%',
  };
  function setVal(objName, key, val) {
    objOf(objName)[key] = val;
    save(); syncUI();
    if (objName === 'settings') publish();
    refreshPreview(false);
  }
  function syncUI() {
    $$('[data-s]').forEach(elm => {
      const [o, k] = elm.dataset.s.split('.'); const v = objOf(o)[k];
      if (elm.classList.contains('seg')) $$('button', elm).forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
      else if (elm.hasAttribute('data-toggle')) elm.classList.toggle('on', !!v);
      else if (elm.type === 'checkbox') elm.checked = !!v;
      else if (document.activeElement !== elm || elm.type !== 'range') elm.value = v;
    });
    $$('[data-out]').forEach(o => { const [a, k] = o.dataset.out.split('.'); const f = UNITS[o.dataset.out]; o.textContent = f ? f(objOf(a)[k]) : objOf(a)[k]; });
    const letter = !!CS.LETTER_FX[style.effect];
    $$('[data-when]').forEach(e => {
      const w = e.dataset.when; let show = true;
      if (w === 'auto') show = style.sizeMode === 'auto'; if (w === 'manual') show = style.sizeMode === 'manual';
      if (w === 'letter') show = letter; if (w === 'soft') show = letter && style.effect !== 'type';
      if (w === 'whole') show = !letter; if (w === 'cursor') show = !!style.cursor;
      e.classList.toggle('hidden', !show);
    });
    $$('#presets button').forEach(b => b.classList.toggle('on', b.dataset.p === style.preset));
    const s1 = $('#sampleRu'), s2 = $('#sampleEn');
    [[s1, style.fontRu], [s2, style.fontEn]].forEach(([s, f]) => {
      s.style.fontFamily = `'${f}', Inter, sans-serif`; s.style.fontWeight = style.bold ? 700 : 400;
      s.style.fontStyle = style.italic ? 'italic' : 'normal'; s.style.textTransform = style.upper ? 'uppercase' : 'none';
      s.style.color = style.color;
    });
    s1.style.outline = style.lang === 'ru' ? '1px solid var(--acc)' : ''; s2.style.outline = style.lang === 'en' ? '1px solid var(--acc)' : '';
    const bm = settings.bgMediaId && mediaMap.get(settings.bgMediaId);
    $('#bgMediaName').textContent = bm ? 'Медиа-фон: ' + bm.name : 'Медиа-фон не выбран';
    $('#bgClear').disabled = !settings.bgMediaId;
  }
  $$('[data-s]').forEach(elm => {
    const [o, k] = elm.dataset.s.split('.');
    if (elm.classList.contains('seg')) elm.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setVal(o, k, b.dataset.v); });
    else if (elm.hasAttribute('data-toggle')) elm.addEventListener('click', () => setVal(o, k, !objOf(o)[k]));
    else if (elm.type === 'checkbox') elm.addEventListener('change', () => setVal(o, k, elm.checked));
    else if (elm.type === 'range') elm.addEventListener('input', () => setVal(o, k, parseFloat(elm.value)));
    else elm.addEventListener('input', () => setVal(o, k, elm.value));
  });

  // шрифты
  const cat = c => ({ 'sans-serif': 'гротеск', serif: 'антиква', display: 'акцидентный', handwriting: 'рукописный', monospace: 'моноширинный' }[c] || c);
  const fillFonts = (sel, list) => { sel.innerHTML = list.map(f => `<option value="${f.family}">${f.family} — ${cat(f.cat)}${f.cyr ? '' : ' (только латиница)'}</option>`).join(''); };
  fillFonts($('#fontRu'), FONTS.filter(f => f.cyr));
  fillFonts($('#fontEn'), FONTS.slice().sort((a, b) => (a.cyr === b.cyr ? 0 : a.cyr ? 1 : -1)));

  // палитры
  const SW = {
    'style.color': ['#ffffff', '#fff3d6', '#ffd23f', '#ff9f1c', '#ff4a4a', '#ff5fa2', '#b388ff', '#5aa2ff', '#3ee0d0', '#35d07f', '#111111'],
    'style.accent': ['#000000', '#1b1b2f', '#ffffff', '#ffd23f', '#ff4a4a', '#ff5fa2', '#7c4dff', '#2d6bff', '#00c2a8'],
    'settings.bgColor': ['#16182a', '#0f1f1a', '#1f1020', '#241a0e', '#10202e', '#2a2a2a', '#3b0d0d', '#ffffff', '#0b0b0b'],
  };
  $$('[data-sw]').forEach(box => {
    const [o, k] = box.dataset.sw.split('.');
    box.innerHTML = SW[box.dataset.sw].map(c => `<button style="background:${c}" data-c="${c}" title="${c}"></button>`).join('');
    box.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setVal(o, k, b.dataset.c); });
  });

  // пресеты надписи
  const PRESETS = [['clean', 'Чистый'], ['shadow', 'Тень'], ['outline', 'Обводка'], ['hollow', 'Контур'], ['box', 'Плашка'], ['neon', 'Неон'], ['glow', 'Свечение'], ['retro', 'Ретро']];
  $('#presets').innerHTML = PRESETS.map(([p, n]) => `<button data-p="${p}"><span class="cs-text pr-${p}" style="--txt:#fff;--acc:#ff4a4a;color:var(--txt)"><span class="ch"${p === 'box' ? ' style="background:#ff4a4a;padding:0 .2em"' : ''}>Aa</span></span><small>${n}</small></button>`).join('');
  $('#presets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setVal('style', 'preset', b.dataset.p); });

  $('#applyLive').addEventListener('click', () => {
    if (live.mode !== 'text') { toast('Сейчас в эфире не текст'); return; }
    const st = clone(style); st.lang = live.style ? live.style.lang : st.lang;
    live = Object.assign({}, live, { style: st });
    publishNow();
  });

  /* ---------- очередь ---------- */
  function addToQueue(text) {
    if (!text || !text.trim()) { toast('Нечего добавлять'); return; }
    queue.push({ id: CS.uid(), text: text.replace(/\s+$/, ''), lang: detectLang(text) || style.lang });
    input.value = ''; onDraft(); save(); renderQueue(); toast('Добавлено в очередь (' + queue.length + ')');
  }
  function renderQueue(scrollToPtr) {
    $('#qcount').textContent = queue.length || '';
    qptr = CS.clamp(qptr, 0, queue.length);
    const L = $('#qlist');
    if (!queue.length) { L.innerHTML = '<div class="empty">Очередь пуста.<br>Добавьте сообщение через ⌘Enter или «Вставить списком».</div>'; return; }
    L.innerHTML = queue.map((q, i) => `<div class="qi ${i === qptr ? 'ptr' : ''} ${autoOn && !autoInsert && q.id === autoShownId ? 'autonow' : ''} ${i < qptr ? 'sent' : ''} ${q.id === editId ? 'editing' : ''}" data-i="${i}" title="Клик — редактировать">
      <div class="n" title="Начать отсюда">${i + 1}</div>
      <div class="txt"><span class="lg">${(q.lang || 'ru').toUpperCase()}</span>${esc(q.text)}</div>
      <div class="act"><button class="btn xs icon" data-a="go" title="Сразу на экран">▶</button><button class="btn xs icon" data-a="edit" title="Редактировать">✎</button><button class="btn xs icon" data-a="up" title="Выше">↑</button><button class="btn xs icon" data-a="down" title="Ниже">↓</button><button class="btn xs icon" data-a="del" title="Удалить">✕</button></div>
    </div>`).join('');
    // прокручиваем к текущему, только когда указатель сдвинули кнопками/автопоказом, а не при клике по списку
    if (scrollToPtr) { const p = L.querySelector('.ptr'); if (p) p.scrollIntoView({ block: 'nearest' }); }
    renderAuto();
  }
  $('#qlist').addEventListener('click', e => {
    const it = e.target.closest('.qi'); if (!it) return; const i = +it.dataset.i; const b = e.target.closest('button');
    if (e.target.closest('.n')) { qptr = i; save(); renderQueue(); toast('Следующим пойдёт №' + (i + 1)); return; }
    const a = b && b.dataset.a;
    if (a === 'go') { sendText(queue[i].text, queue[i].lang); qptr = i + 1; }
    else if (a === 'up' && i > 0) { [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]]; }
    else if (a === 'down' && i < queue.length - 1) { [queue[i + 1], queue[i]] = [queue[i], queue[i + 1]]; }
    else if (a === 'del') { const gone = queue.splice(i, 1)[0]; if (i < qptr) qptr--; if (gone.id === editId) cancelEdit(); }
    else if (!a || a === 'edit') { startEdit(i); }
    save(); renderQueue(); if (editId) $('#editN').textContent = '№' + (queue.findIndex(q => q.id === editId) + 1);
  });

  /* правка сообщения из очереди */
  let editId = null;
  function setEditUI() {
    const idx = queue.findIndex(q => q.id === editId); if (idx < 0) editId = null;
    $('#editBar').classList.toggle('hidden', !editId); $('.composer').classList.toggle('editing', !!editId);
    $('#send').classList.toggle('hidden', !!editId); $('#toQueue').classList.toggle('hidden', !!editId); $('#clearAfter').closest('label').classList.toggle('hidden', !!editId);
    if (editId) $('#editN').textContent = '№' + (idx + 1);
    renderQueue();
  }
  function startEdit(i) {
    editId = queue[i].id; input.value = queue[i].text;
    if (queue[i].lang) style.lang = queue[i].lang;
    syncUI(); setEditUI(); onDraft(); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }
  function saveEdit() {
    const q = queue.find(x => x.id === editId); if (!q) { cancelEdit(); return; }
    if (!input.value.trim()) { toast('Текст пустой. Чтобы убрать сообщение, нажмите ✕ в очереди.'); return; }
    q.text = input.value.replace(/\s+$/, ''); q.lang = style.lang;
    editId = null; input.value = ''; save(); setEditUI(); onDraft(); toast('Сохранено в очереди');
  }
  function cancelEdit() { editId = null; input.value = ''; setEditUI(); onDraft(); }
  $('#editSave').addEventListener('click', saveEdit);
  $('#editCancel').addEventListener('click', cancelEdit);
  /* ---------- автопоказ очереди ---------- */
  let auto = CS.merge({ mode: 'end', hold: 4 }, CS.lsGet('cs-ctl-auto', null));
  let autoOn = false, autoAwaiting = false, autoTimer = null, autoNextAt = 0, autoShownId = null, autoHoldMs = 0;
  let autoPaused = false, autoInsert = false;
  const saveAuto = () => CS.lsSet('cs-ctl-auto', auto);
  function startAuto() {
    if (!queue.length) { toast('Очередь пуста'); return; }
    if (editId) cancelEdit();
    if (qptr >= queue.length) {
      if (auto.mode === 'loop') qptr = 0;
      else { toast('Указатель в конце списка. Кликните номер сообщения, с которого начать.', 4500); return; }
    }
    autoOn = true; autoPaused = false; autoInsert = false; autoStep();
  }
  function autoStep() {
    if (!autoOn) return;
    clearTimeout(autoTimer); autoNextAt = 0;
    if (qptr >= queue.length) {
      if (auto.mode === 'loop' && queue.length) qptr = 0;
      else { stopAuto('Автопоказ: список закончился'); return; }
    }
    const q = queue[qptr]; qptr++; save();
    autoShownId = q.id; autoAwaiting = true; autoInsert = false; autoPaused = false;
    if (!sendText(q.text, q.lang, { auto: true })) { autoAwaiting = false; autoTimer = setTimeout(autoStep, 50); }
    renderQueue(true);
  }
  function autoOnDone(id) {
    if (!autoOn || !autoAwaiting || id !== live.id) return;
    autoAwaiting = false; autoHoldMs = auto.hold * 1000; autoNextAt = Date.now() + autoHoldMs;
    autoTimer = setTimeout(autoStep, autoHoldMs);
  }
  /* ручной вывод во время автопоказа: показать вставку, выдержать паузу и продолжить список.
     ЗАТЕМНИТЬ ставит автопоказ на паузу до «ВЕРНУТЬ». Остановить совсем — ⌥A или кнопкой. */
  function autoInterrupt(mode, restore) {
    clearTimeout(autoTimer); autoNextAt = 0;
    if (mode === 'black') { autoPaused = true; autoAwaiting = false; renderAuto(); return; }
    autoPaused = false; autoInsert = autoInsert && restore ? true : !restore; autoAwaiting = true; // ждём, пока вставка допечатается (autoOnDone)
    renderAuto();
  }
  function stopAuto(msg) {
    if (!autoOn) return;
    autoOn = false; autoAwaiting = false; autoNextAt = 0; autoPaused = false; autoInsert = false; clearTimeout(autoTimer);
    renderQueue(); if (msg) toast(msg, 3500);
  }
  function renderAuto() {
    const b = $('#autoBtn'); if (!b) return;
    b.classList.toggle('on', autoOn);
    const startN = qptr < queue.length ? qptr + 1 : (auto.mode === 'loop' && queue.length ? 1 : null);
    b.innerHTML = autoOn ? '■ Остановить автопоказ <kbd>⌥A</kbd>' : (startN ? `⏵ Автопоказ с №${startN} <kbd>⌥A</kbd>` : '⏵ Автопоказ <kbd>⌥A</kbd>');
    $$('#autoMode button').forEach(x => x.classList.toggle('on', x.dataset.v === auto.mode));
    $('#autoHold').value = auto.hold; $('#autoHoldOut').textContent = auto.hold + ' с';
    tickAuto();
  }
  function tickAuto() {
    const el = $('#autoStatus'); if (!el) return;
    if (!autoOn) { el.innerHTML = 'Сообщения идут одно за другим, начиная с выделенного рамкой. <b>Клик по номеру</b> — выбрать, с какого начать.'; return; }
    if (autoPaused) { el.innerHTML = '<b>Пауза</b>: экран затемнён. «ВЕРНУТЬ» (⌥B) продолжит автопоказ.'; return; }
    const shownN = queue.findIndex(q => q.id === autoShownId) + 1;
    const shown = autoInsert ? 'ручное сообщение' : '№' + shownN;
    const nextN = qptr < queue.length ? '№' + (qptr + 1) : (auto.mode === 'loop' ? '№1 (новый круг)' : 'конец списка');
    if (autoNextAt) {
      const left = Math.max(0, autoNextAt - Date.now());
      el.innerHTML = `В эфире <b>${shown}</b> · дальше ${nextN} через <b>${Math.ceil(left / 1000)} с</b><div class="pbar"><i style="width:${100 - left / autoHoldMs * 100}%"></i></div>`;
    } else el.innerHTML = `В эфире <b>${shown}</b> · появляется… · дальше ${nextN}`;
  }
  setInterval(() => { if (autoOn) tickAuto(); }, 200);
  $('#autoBtn').addEventListener('click', () => (autoOn ? stopAuto() : startAuto()));
  $('#autoMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { auto.mode = b.dataset.v; saveAuto(); renderAuto(); } });
  $('#autoHold').addEventListener('input', e => { auto.hold = parseFloat(e.target.value); saveAuto(); $('#autoHoldOut').textContent = auto.hold + ' с'; });

  function qNext() {
    if (autoOn) { autoStep(); return; }
    if (qptr >= queue.length) { toast(queue.length ? 'Очередь закончилась' : 'Очередь пуста'); return; }
    const q = queue[qptr]; sendText(q.text, q.lang); qptr++; save(); renderQueue(true);
  }
  $('#qNext').addEventListener('click', qNext);
  $('#qPrev').addEventListener('click', () => { qptr = Math.max(0, qptr - 1); save(); renderQueue(true); });
  $('#qReset').addEventListener('click', () => { qptr = 0; save(); renderQueue(true); });
  $('#qClear').addEventListener('click', () => { if (queue.length && confirm('Очистить всю очередь?')) { queue = []; qptr = 0; if (editId) cancelEdit(); save(); renderQueue(); } });
  const dlg = $('#bulkDlg');
  $('#qBulk').addEventListener('click', () => { $('#bulkText').value = ''; dlg.showModal(); $('#bulkText').focus(); });
  $('#bulkCancel').addEventListener('click', () => dlg.close());
  $('#bulkOk').addEventListener('click', () => {
    const parts = $('#bulkText').value.replace(/\r/g, '').split(/\n[ \t]*\n+/).map(s => s.trim()).filter(Boolean);
    parts.forEach(t => queue.push({ id: CS.uid(), text: t, lang: detectLang(t) || style.lang }));
    dlg.close(); save(); renderQueue(); toast('Добавлено: ' + parts.length);
  });

  /* ---------- медиа ---------- */
  async function loadMedia() {
    try {
      const all = await CS.db.all();
      all.sort((a, b) => a.added - b.added).forEach(r => mediaMap.set(r.id, Object.assign({}, r, { url: URL.createObjectURL(r.blob) })));
    } catch (e) { toast('Хранилище медиа недоступно: файлы будут жить только до перезагрузки пульта', 6000); }
  }
  async function addFiles(files) {
    let n = 0;
    for (const f of files) {
      if (!/^(image|video)\//.test(f.type)) continue;
      const rec = { id: CS.uid(), name: f.name, kind: f.type.startsWith('video') ? 'video' : 'image', mime: f.type, blob: f, added: Date.now() };
      try { await CS.db.put(rec); } catch (e) {}
      mediaMap.set(rec.id, Object.assign({}, rec, { url: URL.createObjectURL(f) })); n++;
    }
    if (n) { switchTab('media'); renderMedia(); toast('Добавлено файлов: ' + n); }
    else toast('Поддерживаются картинки и видео');
  }
  function badges(m) {
    const onLive = (live.mode === 'image' && live.mediaId === m.id) || (live.mode === 'logo' && live.logoId === m.id);
    return (onLive ? '<span class="b-live">ЭФИР</span>' : '') + (settings.bgMediaId === m.id ? '<span class="b-bg">ФОН</span>' : '') +
      (logoId === m.id ? '<span class="b-logo">ЛОГО</span>' : '') + (m.kind === 'video' ? '<span>ВИДЕО</span>' : '');
  }
  function renderMedia() {
    $('#mcount').textContent = mediaMap.size || '';
    const G = $('#mgrid');
    G.innerHTML = [...mediaMap.values()].reverse().map(m => `<div class="mi" data-id="${m.id}"><div class="th">${m.kind === 'video' ? `<video src="${m.url}" muted loop autoplay playsinline></video>` : `<img src="${m.url}" alt="">`}
        <div class="badges"></div></div>
        <div class="nm" title="${esc(m.name)}">${esc(m.name)}</div>
        <div class="ac"><button class="btn xs" data-a="live">Эфир</button><button class="btn xs" data-a="bg">Фон</button><button class="btn xs" data-a="logo">Лого</button><button class="btn xs icon" data-a="del" title="Удалить">✕</button></div></div>`).join('');
    updateBadges();
  }
  // нажатые кнопки на карточках: Эфир / Фон / Лого работают как переключатели
  (function () {
    const css = document.createElement('style');
    css.textContent = '.mi .ac .btn.on[data-a=live]{background:var(--red);border-color:var(--red);color:#fff}' +
      '.mi .ac .btn.on[data-a=bg]{background:var(--blue);border-color:var(--blue);color:#001226}' +
      '.mi .ac .btn.on[data-a=logo]{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}';
    document.head.appendChild(css);
  })();
  const isOnScreen = id => (live.mode === 'image' && live.mediaId === id) || (live.mode === 'logo' && live.logoId === id);
  function updateBadges() {
    $$('#mgrid .mi').forEach(c => {
      const id = c.dataset.id, m = mediaMap.get(id); if (!m) return;
      const h = badges(m); const b = c.querySelector('.badges'); if (b.innerHTML !== h) b.innerHTML = h;
      const set = (a, on, t) => { const btn = c.querySelector(`[data-a=${a}]`); if (btn) { btn.classList.toggle('on', on); btn.title = t; } };
      set('live', isOnScreen(id), isOnScreen(id) ? 'Убрать с экрана' : 'Показать на экране вместо текста');
      set('bg', settings.bgMediaId === id, settings.bgMediaId === id ? 'Убрать фон' : 'Поставить фоном');
      set('logo', logoId === id, logoId === id ? 'Снять логотип' : 'Назначить логотипом');
    });
  }
  $('#mgrid').addEventListener('click', async e => {
    const b = e.target.closest('button'); const it = e.target.closest('.mi'); if (!b || !it) return;
    const id = it.dataset.id, a = b.dataset.a;
    if (a === 'live') { if (isOnScreen(id)) sendEmpty(); else sendMedia(id); }
    if (a === 'bg') {
      if (settings.bgMediaId === id) { setVal('settings', 'bgMediaId', null); toast('Медиа-фон снят'); }
      else setVal('settings', 'bgMediaId', id);
    }
    if (a === 'logo') {
      if (logoId === id) {
        const shown = live.mode === 'logo' && live.logoId === id;
        logoId = null; save(); if (shown) sendEmpty(); updateBadges();
        toast(shown ? 'Логотип снят и убран с экрана' : 'Логотип снят. Назначьте другой кнопкой «Лого».');
      }
      else { logoId = id; save(); updateBadges(); toast('Логотип назначен. Кнопка ЛОГО или ⌥G выводит его.'); }
    }
    if (a === 'del') {
      // мешает удалению только то, что прямо сейчас на экране как контент
      const onScreen = (live.mode === 'image' && live.mediaId === id) || (live.mode === 'logo' && live.logoId === id);
      if (onScreen) { toast('Этот файл сейчас на экране. Сначала выведите что-то другое (например, ПУСТО).', 4500); return; }
      const roles = [settings.bgMediaId === id && 'фоном', logoId === id && 'логотипом'].filter(Boolean);
      if (!confirm(roles.length ? `Файл назначен ${roles.join(' и ')}. Удалить его и снять назначение?` : 'Удалить файл из медиа?')) return;
      if (logoId === id) logoId = null;
      if (settings.bgMediaId === id) setVal('settings', 'bgMediaId', null);
      save();
      try { await CS.db.del(id); } catch (err) {}
      const m = mediaMap.get(id); if (m) URL.revokeObjectURL(m.url); mediaMap.delete(id); renderMedia();
    }
  });
  $('#bgClear').addEventListener('click', () => setVal('settings', 'bgMediaId', null));
  $('#drop').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
  let dragN = 0;
  window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragN++; $('#dragover').classList.add('on'); } });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#dragover').classList.remove('on'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dragover').classList.remove('on'); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

  $('#calReset').addEventListener('click', () => {
    Object.assign(settings, { safe: CS.DEFAULT_SETTINGS.safe, offsetX: 0, offsetY: 0, scale: 100, flipH: false });
    save(); syncUI(); publish(); refreshPreview(false);
  });

  /* ---------- вкладки ---------- */
  function switchTab(t) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t));
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* ---------- история ---------- */
  const hp = $('#hpanel');
  $('#hbtn').addEventListener('click', e => { e.stopPropagation(); hp.classList.toggle('hidden'); renderHistory(); });
  document.addEventListener('click', e => { if (!hp.contains(e.target) && e.target !== $('#hbtn')) hp.classList.add('hidden'); });
  function renderHistory() {
    if (hp.classList.contains('hidden')) return;
    const fmt = t => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    hp.innerHTML = `<div class="hh"><span>История эфира · ${history.length}</span>${history.length ? '<button class="btn xs" data-a="clear">Очистить</button>' : ''}</div>` +
      (history.length ? history.map((h, i) => {
        const l = h.live; const label = l.mode === 'text' ? esc((l.text || '').replace(/\n/g, ' / ')) : l.mode === 'logo' ? 'Логотип' : 'Медиа: ' + esc((mediaMap.get(l.mediaId) || {}).name || '—');
        const tag = l.mode === 'text' ? (l.style && l.style.lang || 'ru').toUpperCase() : l.mode === 'logo' ? 'ЛОГО' : 'МЕДИА';
        return `<div class="hi" data-i="${i}"><span class="t">${fmt(h.t)}</span><span class="x" title="${label}"><em>${tag}</em>${label}</span>
          <span class="a">${l.mode === 'text' ? '<button class="btn xs" data-a="edit" title="В редактор (текст и стиль)">✎</button>' : ''}<button class="btn xs" data-a="go" title="Снова в эфир">↻ В эфир</button></span></div>`;
      }).join('') : '<div class="empty">Пока ничего не отправлялось</div>');
  }
  hp.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'clear') { if (confirm('Очистить историю?')) { history = []; save(); renderHistory(); } return; }
    const i = +b.closest('.hi').dataset.i; const l = clone(history[i].live); delete l.id;
    if (b.dataset.a === 'go') { if (l.mode === 'image' && !mediaMap.has(l.mediaId)) { toast('Файл удалён из медиа'); return; } goLive(l); }
    if (b.dataset.a === 'edit') { input.value = l.text; style = CS.merge(CS.DEFAULT_STYLE, l.style); save(); syncUI(); onDraft(); hp.classList.add('hidden'); input.focus(); }
  });

  /* ---------- кнопки и горячие клавиши ---------- */
  $('#bLogo').addEventListener('click', sendLogo);
  $('#bEmpty').addEventListener('click', sendEmpty);
  $('#bBlack').addEventListener('click', toggleBlack);
  $('#replay').addEventListener('click', replay);
  document.addEventListener('keydown', e => {
    if (dlg.open) return;
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    const map = {
      KeyA: () => (autoOn ? stopAuto() : startAuto()), KeyB: toggleBlack, KeyE: sendEmpty, KeyG: sendLogo, ArrowDown: qNext, KeyR: replay,
      ArrowUp: () => { qptr = Math.max(0, qptr - 1); save(); renderQueue(true); },
      KeyL: () => setVal('style', 'lang', style.lang === 'ru' ? 'en' : 'ru'),
      KeyP: () => refreshPreview(true),
    };
    if (map[e.code]) { e.preventDefault(); map[e.code](); }
  });
  window.addEventListener('beforeunload', save);

  /* ---------- утилиты ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  let tt; function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), ms || 2600); }

  /* ---------- старт ---------- */
  (async function boot() {
    syncUI(); renderQueue();
    await loadMedia();
    if (!FONTS.some(f => f.family === style.fontRu && f.cyr)) style.fontRu = 'Inter';
    syncUI(); renderMedia(); refreshPreview(false); publishNow();
    input.focus();
  })();
})();
