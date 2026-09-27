(function () {
  'use strict';
  const P = window.KintoreParser;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const fmtKg = v => v == null ? '' : (Math.round(v * 100) / 100).toString();

  // ---------- データ ----------
  const STORE = 'kintore:v1';
  const DRAFT = 'kintore:draft';
  const defaults = () => ({
    workouts: [], templates: [], custom: [],
    settings: { restDefault: 'auto', defaultSets: 3, sound: true, vibrate: true },
    active: null, rest: null,
    sync: { up: [], del: [], cfgHash: '', last: 0 },
  });
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (d) { const s = Object.assign(defaults(), d); s.settings = Object.assign(defaults().settings, d.settings); s.sync = Object.assign(defaults().sync, d.sync); return s; }
    } catch (e) { /* 読めなければ初期状態 */ }
    return defaults();
  }
  let S = load();
  let saveT = null;
  function saveNow() {
    clearTimeout(saveT);
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { toast('保存に失敗しました'); }
    if (apiUrl() && cfgString() !== S.sync.cfgHash) scheduleFlush();
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 200); }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); else { tickRest(); keepAwake(); } });

  const ui = { tab: 'workout', woOpen: true, exFilter: 'すべて', exQuery: '' };

  // ---------- 小物 ----------
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2200);
  }
  const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const restLabel = s => !s ? 'オフ' : s < 60 ? s + '秒' : (s % 60 ? mmss(s) : (s / 60) + '分');
  function dur(ms) {
    const m = Math.round(ms / 60000);
    return m < 60 ? m + '分' : Math.floor(m / 60) + '時間' + (m % 60 ? (m % 60) + '分' : '');
  }
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  function dateLabel(t, withTime) {
    const d = new Date(t);
    const s = (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')';
    return withTime ? s + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') : s;
  }
  const e1rm = (kg, reps) => (!kg || !reps) ? 0 : reps === 1 ? kg : kg * (1 + reps / 30);
  const volOf = w => w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.warmup ? 0 : (s.kg || 0) * (s.reps || 0)), 0), 0);
  const fmtVol = v => Math.round(v).toLocaleString('ja-JP') + 'kg';
  function defaultTitle() {
    const h = new Date().getHours();
    return h < 5 ? '深夜のワークアウト' : h < 11 ? '朝のワークアウト' : h < 17 ? '昼のワークアウト' : '夜のワークアウト';
  }
  function setText(s, timed) {
    if (timed || (s.sec && !s.reps)) return (s.kg ? fmtKg(s.kg) + 'kg × ' : '') + (s.sec ? restLabel(s.sec) : '-');
    if (s.kg == null && s.reps == null) return '—';
    return (s.kg ? fmtKg(s.kg) + 'kg' : '自重') + ' × ' + (s.reps == null ? '-' : s.reps);
  }
  function bestSet(sets) {
    let b = null, bv = -1;
    sets.forEach(s => { if (s.warmup) return; const v = e1rm(s.kg, s.reps) || (s.reps || 0) / 1000 || (s.sec || 0) / 1e5; if (v > bv) { bv = v; b = s; } });
    return b;
  }

  // 効果音（レスト終了）
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* 音が出せない環境 */ }
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  // 音楽やYouTubeを止めずに、重ねて鳴らす（iOS 17以降）
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* 非対応 */ }
  function beep() {
    if (S.settings.vibrate && navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
    if (!S.settings.sound || !actx) return;
    const t0 = actx.currentTime;
    [0, 0.25, 0.5].forEach((d, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.2);
      o.connect(g).connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + 0.22);
    });
  }

  // トレーニング中は画面を消さない
  let wakeLock = null;
  async function keepAwake() {
    try {
      if (S.active && !wakeLock && 'wakeLock' in navigator && !document.hidden) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!S.active && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }

  // ---------- 種目データ ----------
  function allExercises() {
    const map = new Map();
    P.BUILTIN.forEach(e => map.set(e.name, e));
    S.custom.forEach(e => map.set(e.name, e));
    S.workouts.forEach(w => w.exercises.forEach(e => {
      if (!map.has(e.name)) map.set(e.name, { name: e.name, part: e.part || 'その他', custom: true, aliases: [] });
    }));
    return Array.from(map.values());
  }
  function exMeta(name) {
    return P.findExercise(name, S.custom) || Object.assign({ name, aliases: [] }, P.guessMeta(name));
  }
  function registerCustom(ex) {
    if (P.findExercise(ex.name, S.custom)) return;
    S.custom.push({ id: 'c:' + uid(), name: ex.name, part: ex.part || 'その他', compound: !!ex.compound, timed: !!ex.timed, aliases: [] });
  }
  // その種目を前回やったときのセット
  function prevSets(name, excludeId) {
    for (const w of S.workouts) {
      if (w.id === excludeId) continue;
      const e = w.exercises.find(x => x.name === name);
      if (e && e.sets.length) return e.sets;
    }
    return null;
  }
  function prevFor(ex, si) {
    const ps = prevSets(ex.name); if (!ps) return null;
    const s = ex.sets[si];
    const idx = ex.sets.slice(0, si).filter(x => !!x.warmup === !!s.warmup).length;
    const same = ps.filter(x => !!x.warmup === !!s.warmup);
    return same[idx] || null;
  }

  // ---------- テキスト ⇄ メニュー ----------
  function fixRest(r) {
    if (S.settings.restDefault !== 'auto') r.exercises.forEach(e => { if (e.restAuto) { e.rest = +S.settings.restDefault; e.restAuto = false; } });
    return r;
  }
  function parse(text) {
    return fixRest(P.parseMenu(text, { customExercises: S.custom, defaultSets: S.settings.defaultSets }));
  }
  function parseAll(text) {
    return P.parseProgram(text, { customExercises: S.custom, defaultSets: S.settings.defaultSets }).map(fixRest);
  }
  // 複数のメニューを、それぞれテンプレートとして保存
  function saveProgram(list, fromSheet) {
    if (!confirm(list.length + 'つのテンプレートとして保存しますか？\n' + list.map(r => '・' + (r.title || '無題')).join('\n'))) return;
    list.forEach(r => r.exercises.forEach(e => { if (!e.exId) registerCustom(e); }));
    const added = list.map(r => ({ id: uid(), title: r.title || '無題のテンプレート', exercises: stripForTemplate(r.exercises), text: r.text || '' }));
    S.templates = added.concat(S.templates);
    if (fromSheet) { try { localStorage.removeItem(DRAFT); } catch (e) { /* noop */ } }
    save(); closeSheet(); ui.tab = 'workout'; render(); toast(added.length + 'つのテンプレートを追加しました');
  }
  function openPrograms() {
    const progs = window.KINTORE_PROGRAMS || [];
    const body = progs.map((p, i) => {
      const list = parseAll(p.text);
      return `<div class="card pv" style="margin-bottom:10px">
        <div class="pv-h"><b>${esc(p.title)}</b><span class="tag">${list.length}日分</span></div>
        <div class="small muted" style="margin:4px 0 8px">${esc(p.description || '')}</div>
        <div class="small">${list.map(r => '・' + esc(r.title) + '（' + r.exercises.length + '種目）').join('<br>')}</div>
        <button class="btn primary block sm" style="margin-top:10px" data-prog="${i}">テンプレートに追加</button>
      </div>`;
    }).join('') + `<div class="small muted" style="padding:4px">自分のプログラムは「メニューを書く」に貼り付けて「テンプレに保存」すると、見出し（Week1 Day1、【胸の日】など）ごとに分けて保存されます。</div>`;
    openSheet('プログラムを追加', body, [{ label: '閉じる', cls: 'gray', fn: closeSheet }]);
    $('#sheet .sh-b').addEventListener('click', ev => {
      const b = ev.target.closest('[data-prog]'); if (!b) return;
      saveProgram(parseAll(progs[+b.dataset.prog].text));
    });
  }
  function toWorkoutExercises(list) {
    return list.map(e => ({
      id: uid(), name: e.name, part: e.part, timed: !!e.timed, rest: e.rest, note: e.note || '', section: e.section || '',
      sets: e.sets.map(s => ({ id: uid(), kg: s.kg, reps: s.reps, sec: s.sec, warmup: !!s.warmup, done: false })),
    }));
  }
  function menuToText(title, exercises) {
    const lines = [];
    if (title) lines.push('【' + title + '】');
    let sec = '';
    exercises.forEach(e => {
      if ((e.section || '') !== sec) { sec = e.section || ''; if (sec) lines.push('', sec); }
      const bullet = sec ? '・' : '';
      const nm = bullet + e.name + (e.note ? '（' + e.note + '）' : '');
      const one = s => (s.warmup ? 'アップ ' : '') + (s.kg ? fmtKg(s.kg) + 'kg ' : (s.kg === 0 ? '自重 ' : '')) + (s.sec ? s.sec + '秒' : s.reps != null ? s.reps + '回' : '');
      const restTxt = ' レスト' + (e.rest || 0) + '秒';
      const sets = e.sets;
      const same = sets.length && sets.every(s => one(s) === one(sets[0]) && !s.warmup);
      if (same && one(sets[0]).trim()) lines.push(nm + ' ' + one(sets[0]).trim() + ' ' + sets.length + 'セット' + restTxt);
      else {
        lines.push(nm + restTxt);
        sets.forEach(s => { const t = one(s).trim(); lines.push(t || '10回'); });
      }
    });
    return lines.join('\n');
  }

  // ---------- 画面 ----------
  const ICONS = {
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    workout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 8v8M8 12h8"/></svg>',
    exercises: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    down: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    timer: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6"/></svg>',
  };
  const TABS = [['history', '履歴'], ['workout', 'ワークアウト'], ['exercises', '種目'], ['settings', '設定']];

  function render() {
    $('#tabbar').innerHTML = TABS.map(([k, l]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-tab="${k}">${ICONS[k]}<span>${l}</span></button>`).join('');
    const main = $('#main');
    main.innerHTML = ui.tab === 'history' ? pageHistory() : ui.tab === 'exercises' ? pageExercises() : ui.tab === 'settings' ? pageSettings() : pageHome();
    renderMini();
    renderWorkout(true);
    tickRest();
  }
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    ui.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
  });

  // ----- ホーム -----
  const EXAMPLE = 'ベンチプレス 60kg 10回 3セット\nスクワット 80x5x5\n懸垂 10,8,6\nサイドレイズ 8kg 15回 4セット レスト60秒';
  function pageHome() {
    const tpls = S.templates.map(t => `
      <button class="card tpl" data-tpl="${t.id}">
        <b>${esc(t.title)}</b>
        <span class="l">${esc(t.exercises.map(e => e.name).join('、'))}</span>
        <span class="small muted">${t.exercises.length}種目 · ${t.exercises.reduce((a, e) => a + e.sets.length, 0)}セット</span>
      </button>`).join('');
    return `
      <div class="page-h"><h1>ワークアウト</h1></div>
      ${S.active ? `<button class="btn primary block" data-act="resume" style="margin-bottom:12px">進行中のワークアウトに戻る</button>` : ''}
      <div class="card hero">
        <h2>テキストからメニューを作る</h2>
        <p>メニューを書くか貼り付けると、セットとレストを組みます。</p>
        <div class="eg">${esc(EXAMPLE)}</div>
        <button class="btn primary block" data-act="text-new">メニューを書く</button>
      </div>
      <button class="btn soft block" data-act="empty" style="margin-top:10px">空のワークアウトを始める</button>
      <div class="sec-h" style="display:flex;justify-content:space-between;align-items:center">テンプレート<button class="link small" data-act="programs">＋ プログラムを追加</button></div>
      ${tpls ? `<div class="tpl-grid">${tpls}</div>` : `<div class="card empty">まだありません。<br>メニューを書いて「テンプレートに保存」すると、ここから1タップで始められます。</div>`}
    `;
  }
  $('#main').addEventListener('click', e => {
    const a = e.target.closest('[data-act],[data-tpl],[data-hist],[data-ex],[data-part]');
    if (!a) return;
    if (a.dataset.tpl) return templateMenu(a.dataset.tpl);
    if (a.dataset.hist) return openHistoryDetail(a.dataset.hist);
    if (a.dataset.ex) return openExerciseDetail(a.dataset.ex);
    if (a.dataset.part) { ui.exFilter = a.dataset.part; return render(); }
    const act = a.dataset.act;
    if (act === 'text-new') openTextSheet('new');
    else if (act === 'empty') startWorkout({ title: defaultTitle(), exercises: [] });
    else if (act === 'resume') { ui.woOpen = true; render(); }
    else if (act === 'new-ex') openNewExercise();
    else if (act === 'programs') openPrograms();
    else if (act === 'export') exportData();
    else if (act === 'import') $('#importFile').click();
    else if (act === 'wipe') wipeData();
    else if (act === 'sync-connect') connectSheet();
    else if (act === 'sync-now') fullSync(true);
    else if (act === 'sync-off') { if (confirm('スプレッドシートとの連携を解除しますか？（シートの記録は残ります）')) { setApiUrl(''); render(); } }
    else if (act === 'sync-help') syncHelp();
    else if (act === 'push-test') pushTest();
  });

  function templateMenu(id) {
    const t = S.templates.find(x => x.id === id); if (!t) return;
    actionSheet(t.title + '\n' + t.exercises.map(e => e.name).join(' / '), [
      { label: 'このテンプレートで始める', fn: () => startWorkout({ title: t.title, exercises: toWorkoutExercises(t.exercises) }) },
      { label: 'テキストで編集', fn: () => openTextSheet('edit-template', t) },
      { label: '削除', danger: true, fn: () => { if (confirm('「' + t.title + '」を削除しますか？')) { S.templates = S.templates.filter(x => x.id !== id); save(); render(); } } },
    ]);
  }

  // ----- 履歴 -----
  function pageHistory() {
    if (!S.workouts.length) return `<div class="page-h"><h1>履歴</h1></div><div class="card empty">まだ記録がありません。<br>ワークアウトを完了すると、ここに並びます。</div>`;
    let html = '<div class="page-h"><h1>履歴</h1></div>';
    let lastMonth = '';
    S.workouts.forEach(w => {
      const d = new Date(w.start);
      const m = d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
      if (m !== lastMonth) {
        const cnt = S.workouts.filter(x => { const y = new Date(x.start); return y.getFullYear() === d.getFullYear() && y.getMonth() === d.getMonth(); }).length;
        html += `<div class="sec-h">${m} · ${cnt}回</div>`; lastMonth = m;
      }
      html += `
        <button class="card hist" data-hist="${w.id}">
          <div class="top"><b>${esc(w.title)}</b><span class="date">${dateLabel(w.start, true)}</span></div>
          <div class="stats">
            <span>⏱ ${dur(w.end - w.start)}</span><span>🏋️ ${fmtVol(volOf(w))}</span>
            ${w.prs && w.prs.length ? `<span class="pr">🏆 ${w.prs.length} PR</span>` : ''}
          </div>
          <div class="hist-ex">${w.exercises.map(e => {
            const b = bestSet(e.sets);
            return `<span>${e.sets.filter(s => !s.warmup).length} × ${esc(e.name)}</span><span class="r num">${b ? esc(setText(b, e.timed)) : ''}</span>`;
          }).join('')}</div>
        </button>`;
    });
    return html;
  }

  function openHistoryDetail(id) {
    const w = S.workouts.find(x => x.id === id); if (!w) return;
    const body = `
      <div class="muted small" style="margin:-4px 0 10px">${dateLabel(w.start, true)}</div>
      <div class="sgrid">
        <div><b>${dur(w.end - w.start)}</b><span>時間</span></div>
        <div><b>${fmtVol(volOf(w))}</b><span>総重量</span></div>
        <div><b>${w.exercises.reduce((a, e) => a + e.sets.filter(s => !s.warmup).length, 0)}</b><span>セット</span></div>
      </div>
      ${(w.prs || []).length ? `<div class="card det-ex">${w.prs.map(p => `<div class="pr">🏆 ${esc(p)}</div>`).join('')}</div>` : ''}
      ${w.exercises.map(e => {
        let n = 0;
        return `<div class="card det-ex"><b>${esc(e.name)}</b>${e.note ? `<div class="ex-note" style="padding:0">${esc(e.note)}</div>` : ''}${e.sets.map(s => `
          <div class="det-set"><span class="n">${s.warmup ? 'W' : ++n}</span><span class="num">${esc(setText(s, e.timed))}</span><span class="e num">${e1rm(s.kg, s.reps) ? '1RM ' + Math.round(e1rm(s.kg, s.reps)) : ''}</span></div>`).join('')}</div>`;
      }).join('')}`;
    openSheet(esc(w.title), body, [
      { label: '削除', cls: 'danger', fn: () => { if (confirm('この記録を削除しますか？')) { S.workouts = S.workouts.filter(x => x.id !== id); queueDelete(id); save(); closeSheet(); render(); } } },
      { label: 'テンプレに保存', cls: 'soft', fn: () => saveTemplate(w.title, w.exercises) },
      { label: 'もう一度', cls: 'primary', fn: () => { closeSheet(); startWorkout({ title: w.title, exercises: toWorkoutExercises(w.exercises) }); } },
    ]);
  }

  // ----- 種目 -----
  function exStats(name) {
    const rows = [];
    S.workouts.forEach(w => { const e = w.exercises.find(x => x.name === name); if (e) rows.push({ w, e }); });
    return rows;
  }
  function pageExercises() {
    const q = P.key(ui.exQuery || '');
    const counts = {};
    S.workouts.forEach(w => w.exercises.forEach(e => { counts[e.name] = (counts[e.name] || 0) + 1; }));
    let list = allExercises().filter(e => ui.exFilter === 'すべて' || e.part === ui.exFilter)
      .filter(e => !q || P.key(e.name).includes(q) || (e.aliases || []).some(a => P.key(a).includes(q)));
    list.sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0) || P.PARTS.indexOf(a.part) - P.PARTS.indexOf(b.part));
    return `
      <div class="page-h"><h1>種目</h1><button class="btn soft sm" data-act="new-ex">＋ 新規</button></div>
      <input class="search" id="exSearch" type="search" placeholder="種目を検索" value="${esc(ui.exQuery)}">
      <div class="chips">${['すべて'].concat(P.PARTS).map(p => `<button class="chip ${ui.exFilter === p ? 'on' : ''}" data-part="${p}">${p}</button>`).join('')}</div>
      <div class="card list" style="margin-top:8px">
        ${list.length ? list.map(e => `
          <button class="li" data-ex="${esc(e.name)}">
            <span class="ic">${esc(e.part ? e.part.slice(0, 2) : '他')}</span>
            <span class="m"><b>${esc(e.name)}</b><span>${esc(e.part || 'その他')}${e.custom || String(e.id || '').startsWith('c:') ? ' · 自分で追加' : ''}</span></span>
            <span class="r">${counts[e.name] ? counts[e.name] + '回' : ''}</span>
          </button>`).join('') : '<div class="empty">見つかりません</div>'}
      </div>`;
  }
  $('#main').addEventListener('input', e => {
    if (e.target.id === 'exSearch') {
      ui.exQuery = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const s = $('#exSearch'); s.focus(); try { s.setSelectionRange(pos, pos); } catch (_) { /* noop */ }
    }
  });

  function openExerciseDetail(name) {
    const rows = exStats(name);
    const meta = exMeta(name);
    let best = 0, maxKg = 0, sets = 0;
    const pts = [];
    rows.slice().reverse().forEach(({ w, e }) => {
      let b = 0;
      e.sets.forEach(s => { if (s.warmup) return; sets++; b = Math.max(b, e1rm(s.kg, s.reps)); maxKg = Math.max(maxKg, s.kg || 0); });
      best = Math.max(best, b);
      if (b) pts.push({ t: w.start, v: b });
    });
    const isCustom = S.custom.some(c => c.name === name);
    const body = `
      <div class="muted small" style="margin:-4px 0 10px">${esc(meta.part || 'その他')}${meta.compound ? ' · 複合種目' : ''}</div>
      <div class="sgrid">
        <div><b>${best ? Math.round(best) + 'kg' : '—'}</b><span>推定1RM</span></div>
        <div><b>${maxKg ? fmtKg(maxKg) + 'kg' : '—'}</b><span>最大重量</span></div>
        <div><b>${sets}</b><span>合計セット</span></div>
      </div>
      ${pts.length >= 2 ? `<div class="card" style="padding:12px 10px 6px;margin-bottom:10px"><div class="small muted" style="padding:0 6px 4px">推定1RMの推移</div>${chart(pts)}</div>` : ''}
      ${rows.length ? rows.slice(0, 30).map(({ w, e }) => {
        let n = 0;
        return `<div class="card det-ex"><div class="small muted">${dateLabel(w.start)} · ${esc(w.title)}</div>${e.sets.map(s => `
          <div class="det-set"><span class="n">${s.warmup ? 'W' : ++n}</span><span class="num">${esc(setText(s, e.timed))}</span><span class="e num">${e1rm(s.kg, s.reps) ? '1RM ' + Math.round(e1rm(s.kg, s.reps)) : ''}</span></div>`).join('')}</div>`;
      }).join('') : '<div class="card empty">まだ記録がありません</div>'}
      ${meta.aliases && meta.aliases.length ? `<div class="small muted" style="margin-top:10px">この書き方でも認識します: ${esc(meta.aliases.slice(0, 8).join('、'))}</div>` : ''}`;
    const btns = [];
    if (isCustom) btns.push({ label: '種目を削除', cls: 'danger', fn: () => { if (confirm('「' + name + '」を種目一覧から削除しますか？（記録は残ります）')) { S.custom = S.custom.filter(c => c.name !== name); save(); closeSheet(); render(); } } });
    btns.push({ label: '閉じる', cls: 'gray', fn: closeSheet });
    openSheet(esc(name), body, btns);
  }

  function chart(pts) {
    const W = 320, H = 150, pl = 34, pr = 10, pt = 10, pb = 22;
    const vs = pts.map(p => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 5) { lo -= 3; hi += 3; }
    const x = i => pl + (pts.length === 1 ? 0 : i * (W - pl - pr) / (pts.length - 1));
    const y = v => pt + (hi - v) * (H - pt - pb) / (hi - lo);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    const ticks = [lo, (lo + hi) / 2, hi];
    const d0 = new Date(pts[0].t), d1 = new Date(pts[pts.length - 1].t);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="推定1RMの推移">
      ${ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--sub)">${Math.round(t)}</text>`).join('')}
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="var(--accent)"/>`).join('')}
      <text x="${pl}" y="${H - 5}" font-size="10" fill="var(--sub)">${d0.getMonth() + 1}/${d0.getDate()}</text>
      <text x="${W - pr}" y="${H - 5}" font-size="10" fill="var(--sub)" text-anchor="end">${d1.getMonth() + 1}/${d1.getDate()}</text>
    </svg>`;
  }

  function openNewExercise(prefill, onDone) {
    const body = `
      <label class="lb">種目名</label>
      <input class="field" id="nxName" value="${esc(prefill || '')}" placeholder="例: ケーブルカール">
      <label class="lb">部位</label>
      <div class="chips" id="nxPart" style="margin:0;padding-left:0">${P.PARTS.map((p, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-p="${p}">${p}</button>`).join('')}</div>
      <label class="lb" style="display:flex;justify-content:space-between;align-items:center">高重量の複合種目（レスト長め）<span class="switch"><input type="checkbox" id="nxComp"><span></span></span></label>`;
    openSheet('種目を追加', body, [
      { label: 'キャンセル', cls: 'gray', fn: closeSheet },
      { label: '追加', cls: 'primary', fn: () => {
        const name = $('#nxName').value.trim(); if (!name) return toast('種目名を入れてください');
        if (P.findExercise(name, S.custom)) return toast('同じ名前の種目があります');
        const part = ($('#nxPart .on') || {}).dataset.p || 'その他';
        S.custom.push({ id: 'c:' + uid(), name, part, compound: $('#nxComp').checked, timed: false, aliases: [] });
        save(); closeSheet(); render(); toast('「' + name + '」を追加しました');
        if (onDone) onDone(name);
      } },
    ]);
    const g = P.guessMeta(prefill || '');
    $$('#nxPart .chip').forEach(c => c.classList.toggle('on', c.dataset.p === g.part));
    $('#nxComp').checked = g.compound;
    $('#nxPart').addEventListener('click', e => { const c = e.target.closest('[data-p]'); if (!c) return; $$('#nxPart .chip').forEach(x => x.classList.toggle('on', x === c)); });
  }

  // ----- 設定 -----
  function pageSettings() {
    const s = S.settings;
    const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(v) === String(k) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const sw = (id, v) => `<label class="switch"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}><span></span></label>`;
    return `
      <div class="page-h"><h1>設定</h1></div>
      <div class="sec-h">レストとセット</div>
      <div class="card">
        <div class="set-row"><span>レストの決め方<br><span class="small muted">メニューにレストがないとき</span></span>${sel('stRest', [['auto', '自動'], [60, '1分'], [90, '1分30秒'], [120, '2分'], [150, '2分30秒'], [180, '3分']], s.restDefault)}</div>
        <div class="set-row"><span>種目名だけのときのセット数</span>${sel('stSets', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], s.defaultSets)}</div>
        <div class="set-row"><span>レスト終了の音<br><span class="small muted">アプリ表示中。音楽は止めません</span></span>${sw('stSound', s.sound)}</div>
        <div class="set-row"><span>レスト終了の通知<br><span class="small muted">ロック中・YouTubeや音楽アプリ使用中も届きます</span></span>${sw('stPush', pushOn())}</div>
        ${pushOn() ? '<button class="set-row link" style="width:100%" data-act="push-test">テスト通知を送る（10秒後）</button>' : ''}
        <div class="set-row"><span>バイブ（Android）</span>${sw('stVib', s.vibrate)}</div>
      </div>
      <div class="sec-h">自動レストの目安</div>
      <div class="card guide">
        高重量の複合種目（BIG3、ロウ、懸垂など）: 5回以下 <b>3分</b>、6回以上 <b>2分</b><br>
        単関節種目（カール、レイズなど）: <b>1分30秒</b>、15回以上 <b>1分</b><br>
        プランクや有酸素: <b>1分</b><br>
        <span class="muted small">メニューに「レスト2分」と書けば、それが優先されます。</span>
      </div>
      <div class="sec-h">メニューの書き方</div>
      <div class="card guide">
        1行に1種目。重さ・回数・セット数の順は自由です。
        <code>ベンチプレス 60kg 10回 3セット
スクワット 80x5x5（重さ×回数×セット）
懸垂 10x3（回数×セット）
ダンベルカール 12kg 12,10,8（セットごとの回数）
プランク 60秒x3
デッドリフト 100kg 5回 3セット レスト3分</code>
        種目名だけの行の下に、1セットずつ書くこともできます。
        <code>ベンチプレス
アップ 40kg 10回
60kg 8回
70kg 6回</code>
        先頭に「レスト90秒」と書くと全種目に使われます。「【胸の日】」のような行はタイトルになります。
      </div>
      <div class="sec-h">Googleスプレッドシート連携</div>
      ${syncCard()}
      <div class="sec-h">データ</div>
      <div class="card">
        <button class="set-row link" style="width:100%" data-act="export">バックアップを書き出す<span class="muted small">${S.workouts.length}件</span></button>
        <button class="set-row link" style="width:100%" data-act="import">バックアップから読み込む</button>
        <button class="set-row" style="width:100%;color:var(--red)" data-act="wipe">すべてのデータを削除</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <p class="small muted" style="text-align:center;margin-top:18px">データはこの端末のブラウザに保存されます。<br>機種変更の前にバックアップを書き出してください。</p>`;
  }
  $('#main').addEventListener('change', e => {
    const t = e.target, s = S.settings;
    if (t.id === 'stRest') s.restDefault = t.value === 'auto' ? 'auto' : +t.value;
    else if (t.id === 'stSets') s.defaultSets = +t.value;
    else if (t.id === 'stSound') { s.sound = t.checked; if (t.checked) { unlockAudio(); beep(); } }
    else if (t.id === 'stVib') s.vibrate = t.checked;
    else if (t.id === 'stPush') {
      if (t.checked) enablePush().then(ok => { if (!ok) t.checked = false; else { toast('通知をオンにしました'); render(); } });
      else disablePush().then(render);
      return;
    }
    else if (t.id === 'importFile') return importData(t.files[0]);
    else return;
    save();
  });
  function exportData() {
    const blob = new Blob([JSON.stringify(Object.assign({}, S, { rest: null }), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `kintore-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importData(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.workouts)) throw new Error('形式が違います');
        if (!confirm(`${d.workouts.length}件の記録を読み込みます。今のデータは置き換わります。よろしいですか？`)) return;
        S = Object.assign(defaults(), d); S.settings = Object.assign(defaults().settings, d.settings); S.rest = null;
        S.sync = Object.assign(defaults().sync, { up: S.workouts.map(w => w.id) });
        saveNow(); render(); toast('読み込みました'); flush();
      } catch (e) { toast('読み込めませんでした: ' + e.message); }
    };
    r.readAsText(file);
  }
  function wipeData() {
    if (!confirm('記録・テンプレート・設定をすべて削除します。' + (apiUrl() ? 'スプレッドシートの記録も削除されます。' : '') + '元に戻せません。よろしいですか？')) return;
    const del = S.workouts.map(w => w.id);
    S = defaults(); S.sync.del = del; saveNow(); render(); toast('削除しました'); flush();
  }

  // ---------- テキスト入力シート ----------
  function openTextSheet(mode, tpl) {
    // mode: new（開始/テンプレ保存）, append（進行中に追加）, edit-template
    let draft = '';
    if (mode === 'edit-template') draft = tpl.text || menuToText(tpl.title, tpl.exercises);
    else if (mode === 'new') { try { draft = localStorage.getItem(DRAFT) || ''; } catch (e) { /* noop */ } }
    const body = `
      <textarea class="menu-text" id="menuText" placeholder="${esc(EXAMPLE)}">${esc(draft)}</textarea>
      <details class="eg"><summary>書き方の例</summary><pre>【胸の日】
レスト90秒
ベンチプレス 60kg×10×3
インクラインダンベルプレス 20kg 10回 3セット レスト2分
ダンベルフライ 12kg 12,10,8
ディップス 自重 10回x3

スクワット
アップ 40kg 10回
80kg 5回
100kg 3回</pre></details>
      <div id="preview"></div>`;
    const title = mode === 'append' ? '種目をテキストで追加' : mode === 'edit-template' ? 'テンプレートを編集' : 'メニューを書く';
    const btns = mode === 'append'
      ? [{ label: 'キャンセル', cls: 'gray', fn: closeSheet }, { label: '追加する', cls: 'primary', fn: () => submit('append') }]
      : mode === 'edit-template'
        ? [{ label: 'キャンセル', cls: 'gray', fn: closeSheet }, { label: '保存', cls: 'primary', fn: () => submit('update') }]
        : [{ label: 'テンプレに保存', cls: 'soft', fn: () => submit('template') }, { label: 'この内容で開始', cls: 'primary', fn: () => submit('start') }];
    openSheet(title, body, btns);
    const ta = $('#menuText');
    let t = null;
    const update = () => {
      const list = mode === 'new' ? parseAll(ta.value) : [parse(ta.value)];
      $('#preview').innerHTML = list.length > 1
        ? `<div class="card pv" style="margin-top:14px">見出しごとに <b>${list.length}つのメニュー</b> に分けました。「テンプレに保存」でまとめて保存できます。</div>` + list.map(previewHtml).join('')
        : previewHtml(list[0] || parse(''));
      if (mode === 'new') { try { localStorage.setItem(DRAFT, ta.value); } catch (e) { /* noop */ } }
    };
    ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(update, 120); });
    update();
    if (!draft) setTimeout(() => ta.focus(), 250);

    function submit(kind) {
      if (kind === 'template' && parseAll(ta.value).length > 1) return saveProgram(parseAll(ta.value), true);
      const r = parse(ta.value);
      if (!r.exercises.length) return toast('種目が見つかりません。1行に1種目で書いてください');
      r.exercises.forEach(e => { if (!e.exId) registerCustom(e); });
      if (kind === 'start') {
        try { localStorage.removeItem(DRAFT); } catch (e) { /* noop */ }
        closeSheet();
        startWorkout({ title: r.title || defaultTitle(), exercises: toWorkoutExercises(r.exercises) });
      } else if (kind === 'append') {
        if (r.title && !S.active.exercises.length) S.active.title = r.title;
        S.active.exercises.push(...toWorkoutExercises(r.exercises));
        save(); closeSheet(); renderWorkout(true);
        toast(r.exercises.length + '種目を追加しました');
      } else if (kind === 'template') {
        saveTemplate(r.title, r.exercises, ta.value);
      } else if (kind === 'update') {
        tpl.title = r.title || tpl.title; tpl.exercises = stripForTemplate(r.exercises); tpl.text = ta.value;
        save(); closeSheet(); render(); toast('保存しました');
      }
    }
  }
  function previewHtml(r) {
    if (!r.exercises.length) return r.warnings.length ? `<div class="warn">${r.warnings.map(esc).join('<br>')}</div>` : '';
    const totalSets = r.exercises.reduce((a, e) => a + e.sets.length, 0);
    return `
      <div class="sec-h" style="margin-top:16px">${r.title ? esc(r.title) + ' · ' : ''}${r.exercises.length}種目 · ${totalSets}セット</div>
      ${r.exercises.map((e, i) => {
        const secHead = e.section && (i === 0 || r.exercises[i - 1].section !== e.section) ? `<div class="sec-label">${esc(e.section)}</div>` : '';
        const same = e.sets.every(s => setText(s, e.timed) === setText(e.sets[0], e.timed) && s.warmup === e.sets[0].warmup);
        const setsTxt = same ? `${e.sets.length}セット · ${setText(e.sets[0], e.timed)}`
          : e.sets.map(s => (s.warmup ? 'W ' : '') + setText(s, e.timed)).join(' / ');
        return `${secHead}<div class="card pv">
          <div class="pv-h"><b>${esc(e.name)}</b>${e.exId ? `<span class="tag">${esc(e.part)}</span>` : `<span class="tag new">新しい種目</span>`}</div>
          ${e.note ? `<div class="ex-note" style="padding:2px 0 0">${esc(e.note)}</div>` : ''}
          <div class="pv-sets num">${esc(setsTxt)}</div>
          <div class="pv-rest">⏱ レスト ${restLabel(e.rest)}${e.restAuto ? '（自動）' : ''}</div>
        </div>`;
      }).join('')}
      ${r.warnings.length ? `<div class="warn">${r.warnings.map(esc).join('<br>')}</div>` : ''}`;
  }
  function stripForTemplate(exs) {
    return exs.map(e => ({ name: e.name, part: e.part, timed: !!e.timed, rest: e.rest, note: e.note || '', section: e.section || '', sets: e.sets.map(s => ({ kg: s.kg, reps: s.reps, sec: s.sec, warmup: !!s.warmup })) }));
  }
  function saveTemplate(title, exercises, text) {
    const name = prompt('テンプレートの名前', title || exercises.slice(0, 2).map(e => e.name).join('・'));
    if (name == null) return;
    S.templates.unshift({ id: uid(), title: name.trim() || '無題のテンプレート', exercises: stripForTemplate(exercises), text: text || '' });
    save(); closeSheet(); ui.tab = 'workout'; render(); toast('テンプレートに保存しました');
  }

  // ---------- ワークアウト ----------
  function startWorkout(w) {
    if (S.active) {
      if (!confirm('進行中のワークアウトがあります。破棄して新しく始めますか？')) { ui.woOpen = true; render(); return; }
    }
    S.active = { id: uid(), title: w.title, start: Date.now(), exercises: w.exercises };
    S.rest = null; ui.woOpen = true;
    save(); render(); keepAwake();
    const body = $('.wo-body'); if (body) body.scrollTop = 0;
  }

  function renderMini() {
    const m = $('#mini');
    if (S.active && !ui.woOpen) {
      m.hidden = false;
      m.innerHTML = `<span>▲</span><span class="t">${esc(S.active.title)}</span><span class="num" id="miniTime">${mmss((Date.now() - S.active.start) / 1000)}</span>`;
    } else m.hidden = true;
  }
  $('#mini').addEventListener('click', () => { ui.woOpen = true; render(); });

  function renderWorkout(keepScroll) {
    const wo = $('#wo');
    const w = S.active;
    if (!w || !ui.woOpen) { wo.hidden = true; document.body.style.overflow = ''; return; }
    const prevScroll = $('.wo-body') ? $('.wo-body').scrollTop : 0;
    wo.hidden = false; document.body.style.overflow = 'hidden';
    wo.innerHTML = `
      <div class="wo-h">
        <button class="icon" data-w="min" aria-label="しまう">${ICONS.down}</button>
        <div class="mid num" id="woTime">${mmss((Date.now() - w.start) / 1000)}</div>
        <button class="btn green sm" data-w="finish">完了</button>
      </div>
      <div class="wo-body"><div class="wo-inner">
        <input class="wo-title" id="woTitle" value="${esc(w.title)}" aria-label="タイトル">
        <div class="wo-meta">${dateLabel(w.start, true)} 開始</div>
        ${w.exercises.map((e, ei) => (e.section && (ei === 0 || w.exercises[ei - 1].section !== e.section) ? `<div class="sec-label">${esc(e.section)}</div>` : '') + exCard(e, ei)).join('')}
        ${!w.exercises.length ? '<div class="card empty">種目を追加してください</div>' : ''}
        <div class="wo-actions">
          <button class="btn soft block" data-w="add-text">＋ テキストで種目を追加</button>
          <button class="btn soft block" data-w="add-ex">＋ 一覧から種目を追加</button>
          <button class="btn danger block" data-w="cancel">ワークアウトを中止</button>
        </div>
      </div></div>`;
    if (keepScroll) $('.wo-body').scrollTop = prevScroll;
  }
  function exCard(e, ei) {
    let n = 0;
    const repLabel = e.timed ? '秒' : '回';
    return `
      <div class="card ex" data-ei="${ei}">
        <div class="ex-h">
          <button class="ex-name" data-w="exmenu">${esc(e.name)}</button>
          <button class="rest-chip ${e.rest ? '' : 'off'}" data-w="rest">${ICONS.timer}${restLabel(e.rest)}</button>
          <button class="dots" data-w="exmenu" aria-label="メニュー">···</button>
        </div>
        ${e.note ? `<div class="ex-note">${esc(e.note)}</div>` : ''}
        <div class="grid head"><span>セット</span><span>前回</span><span>kg</span><span>${repLabel}</span><span>✓</span></div>
        ${e.sets.map((s, si) => {
          const p = prevFor(e, si);
          const label = s.warmup ? 'W' : ++n;
          const rv = e.timed ? s.sec : s.reps;
          const prv = p ? (e.timed ? p.sec : p.reps) : null;
          return `<div class="grid row ${s.done ? 'done' : ''}" data-si="${si}">
            <button class="setno ${s.warmup ? 'w' : ''}" data-w="setmenu">${label}</button>
            <button class="prev num" data-w="prev">${p ? esc(setText(p, e.timed)) : '—'}</button>
            <input class="f" data-f="kg" inputmode="decimal" enterkeyhint="next" value="${fmtKg(s.kg)}" placeholder="${p && p.kg != null ? fmtKg(p.kg) : ''}">
            <input class="f" data-f="${e.timed ? 'sec' : 'reps'}" inputmode="numeric" enterkeyhint="done" value="${rv == null ? '' : rv}" placeholder="${prv == null ? '' : prv}">
            <button class="chk" data-w="check" aria-label="完了">${ICONS.check}</button>
          </div>`;
        }).join('')}
        <button class="addset" data-w="addset">＋ セットを追加</button>
      </div>`;
  }

  const woEl = $('#wo');
  const cur = el => {
    const card = el.closest('[data-ei]'); const row = el.closest('[data-si]');
    const e = card ? S.active.exercises[+card.dataset.ei] : null;
    return { card, row, e, ei: card ? +card.dataset.ei : -1, si: row ? +row.dataset.si : -1, s: e && row ? e.sets[+row.dataset.si] : null };
  };
  woEl.addEventListener('input', ev => {
    const t = ev.target;
    if (t.id === 'woTitle') { S.active.title = t.value; save(); return; }
    if (!t.dataset.f) return;
    const { s } = cur(t); if (!s) return;
    s[t.dataset.f] = num(t.value.replace(',', '.'));
    save();
  });
  woEl.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || !ev.target.dataset.f) return;
    ev.preventDefault();
    const inputs = $$('.f', woEl); const i = inputs.indexOf(ev.target);
    if (ev.target.dataset.f !== 'kg') { ev.target.blur(); const row = ev.target.closest('[data-si]'); const b = row && $('.chk', row); if (b && !row.classList.contains('done')) b.click(); }
    else if (inputs[i + 1]) inputs[i + 1].focus();
  });
  woEl.addEventListener('click', ev => {
    const b = ev.target.closest('[data-w]'); if (!b) return;
    const w = S.active; const act = b.dataset.w;
    const c = cur(b);
    if (act === 'min') { ui.woOpen = false; render(); }
    else if (act === 'finish') finishWorkout();
    else if (act === 'cancel') {
      if (confirm('このワークアウトを中止しますか？記録は残りません。')) { S.active = null; S.rest = null; pushRestChange(true); save(); render(); keepAwake(); }
    }
    else if (act === 'add-text') openTextSheet('append');
    else if (act === 'add-ex') pickExercise(name => {
      const m = exMeta(name);
      const ex = { name, part: m.part, compound: m.compound, timed: m.timed, sets: [] };
      const ps = prevSets(name);
      const base = ps ? ps.filter(s => !s.warmup) : [];
      const n = base.length || S.settings.defaultSets;
      for (let i = 0; i < n; i++) ex.sets.push({ kg: null, reps: null, sec: null, warmup: false });
      ex.rest = S.settings.restDefault === 'auto' ? P.autoRest(Object.assign({}, ex, { sets: base.length ? base : ex.sets })) : +S.settings.restDefault;
      w.exercises.push(toWorkoutExercises([ex])[0]);
      save(); renderWorkout(true);
      setTimeout(() => { const cards = $$('.ex', woEl); cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
    });
    else if (act === 'check') toggleDone(c);
    else if (act === 'prev') {
      const p = prevFor(c.e, c.si); if (!p) return;
      c.s.kg = p.kg; if (c.e.timed) c.s.sec = p.sec; else c.s.reps = p.reps;
      save(); renderWorkout(true);
    }
    else if (act === 'addset') {
      const last = c.e.sets[c.e.sets.length - 1];
      c.e.sets.push({ id: uid(), kg: last ? last.kg : null, reps: last ? last.reps : null, sec: last ? last.sec : null, warmup: false, done: false });
      save(); renderWorkout(true);
    }
    else if (act === 'setmenu') {
      actionSheet('セット', [
        { label: c.s.warmup ? '通常セットにする' : 'ウォームアップにする', fn: () => { c.s.warmup = !c.s.warmup; save(); renderWorkout(true); } },
        { label: 'このセットを削除', danger: true, fn: () => { c.e.sets.splice(c.si, 1); save(); renderWorkout(true); } },
      ]);
    }
    else if (act === 'rest') restPicker(c.e);
    else if (act === 'exmenu') {
      const ei = c.ei;
      actionSheet(c.e.name, [
        { label: 'レストを変更（今 ' + restLabel(c.e.rest) + '）', fn: () => restPicker(c.e) },
        ei > 0 && { label: '上へ移動', fn: () => { w.exercises.splice(ei - 1, 0, w.exercises.splice(ei, 1)[0]); save(); renderWorkout(true); } },
        ei < w.exercises.length - 1 && { label: '下へ移動', fn: () => { w.exercises.splice(ei + 1, 0, w.exercises.splice(ei, 1)[0]); save(); renderWorkout(true); } },
        { label: '種目の記録を見る', fn: () => openExerciseDetail(c.e.name) },
        { label: 'この種目を削除', danger: true, fn: () => { if (confirm('「' + c.e.name + '」を削除しますか？')) { w.exercises.splice(ei, 1); save(); renderWorkout(true); } } },
      ].filter(Boolean));
    }
  });

  function toggleDone(c) {
    const { e, s, row } = c;
    if (s.done) { s.done = false; row.classList.remove('done'); save(); return; }
    // 空欄は前回の値（プレースホルダ）で埋める
    const p = prevFor(e, c.si);
    if (s.kg == null && p && p.kg != null) s.kg = p.kg;
    const rk = e.timed ? 'sec' : 'reps';
    if (s[rk] == null && p && p[rk] != null) s[rk] = p[rk];
    if (s[rk] == null) {
      row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
      const f = $(`[data-f="${rk}"]`, row); if (f) f.focus();
      return toast((e.timed ? '秒数' : '回数') + 'を入れてください');
    }
    s.done = true;
    $('[data-f="kg"]', row).value = fmtKg(s.kg);
    $(`[data-f="${rk}"]`, row).value = s[rk];
    row.classList.add('done');
    if (navigator.vibrate && S.settings.vibrate) navigator.vibrate(20);
    save();
    // 最後のセットでなければ（または次の種目があれば）レスト開始
    const allDone = S.active.exercises.every(x => x.sets.every(y => y.done));
    if (e.rest > 0 && !allDone) startRest(e.rest, e.name, nextSetText(e, c.si));
  }

  // 次にやるセット（同じ種目の残り → 後ろの種目 → 前の種目の残り）
  function nextSetText(e, si) {
    const exs = S.active.exercises;
    const ei = exs.indexOf(e);
    const order = [];
    exs.forEach((x, i) => x.sets.forEach((s, j) => order.push({ x, s, j, k: i === ei ? (j > si ? 0 : 2) : i > ei ? 1 : 2 })));
    const hit = order.filter(o => !o.s.done).sort((a, b) => a.k - b.k)[0];
    if (!hit) return '';
    const no = hit.s.warmup ? 'アップ' : (hit.x.sets.slice(0, hit.j + 1).filter(s => !s.warmup).length + 'セット目');
    const t = hit.s;
    const amount = hit.x.timed || (t.sec && !t.reps) ? (t.sec ? restLabel(t.sec) : '') : (t.reps != null ? t.reps + '回' : '');
    const val = t.kg ? fmtKg(t.kg) + 'kg' + (amount ? ' × ' + amount : '') : amount;
    return `${hit.x.name} ${no}${val ? ' ' + val : ''}`;
  }

  function restPicker(e) {
    const opts = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];
    actionSheet('レスト: ' + e.name, opts.map(v => ({ label: restLabel(v), on: v === e.rest, fn: () => { e.rest = v; save(); renderWorkout(true); } })));
  }

  function pickExercise(onPick) {
    const body = `<input class="search" id="pkQ" type="search" placeholder="種目を検索（なければ新しく作れます）"><div class="card list" id="pkList" style="margin-top:10px"></div>`;
    openSheet('種目を追加', body, [{ label: '閉じる', cls: 'gray', fn: closeSheet }]);
    const draw = () => {
      const q = P.key($('#pkQ').value);
      const raw = $('#pkQ').value.trim();
      const list = allExercises().filter(e => !q || P.key(e.name).includes(q) || (e.aliases || []).some(a => P.key(a).includes(q)));
      const exact = raw && P.findExercise(raw, S.custom);
      $('#pkList').innerHTML = (raw && !exact ? `<button class="li" data-new="1"><span class="ic">＋</span><span class="m"><b>「${esc(raw)}」を新しく作る</b></span></button>` : '')
        + list.slice(0, 80).map(e => `<button class="li" data-pick="${esc(e.name)}"><span class="ic">${esc((e.part || '他').slice(0, 2))}</span><span class="m"><b>${esc(e.name)}</b><span>${esc(e.part || '')}</span></span></button>`).join('');
    };
    $('#pkQ').addEventListener('input', draw);
    $('#pkList').addEventListener('click', ev => {
      const p = ev.target.closest('[data-pick]');
      if (p) { closeSheet(); onPick(p.dataset.pick); return; }
      if (ev.target.closest('[data-new]')) { const raw = $('#pkQ').value.trim(); closeSheet(); openNewExercise(raw, name => onPick(name)); }
    });
    draw();
  }

  function finishWorkout() {
    const w = S.active;
    const done = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    const undone = w.exercises.reduce((a, e) => a + e.sets.filter(s => !s.done).length, 0);
    if (!done) { toast('完了したセットがありません。✓ を押して記録してください'); return; }
    if (undone && !confirm(`未完了のセットが${undone}個あります。完了したセットだけ記録して終えますか？`)) return;
    const rec = {
      id: w.id, title: (w.title || '').trim() || defaultTitle(), start: w.start, end: Date.now(),
      exercises: w.exercises.map(e => ({
        name: e.name, part: e.part, timed: !!e.timed, rest: e.rest, note: e.note || '', section: e.section || '',
        sets: e.sets.filter(s => s.done).map(s => ({ kg: s.kg, reps: s.reps, sec: s.sec, warmup: !!s.warmup })),
      })).filter(e => e.sets.length),
    };
    // 自己ベスト（推定1RM・最大重量）を判定
    rec.prs = [];
    rec.exercises.forEach(e => {
      let pb1 = 0, pbKg = 0, seen = false;
      S.workouts.forEach(x => x.exercises.forEach(y => {
        if (y.name !== e.name) return; seen = true;
        y.sets.forEach(s => { if (!s.warmup) { pb1 = Math.max(pb1, e1rm(s.kg, s.reps)); pbKg = Math.max(pbKg, s.kg || 0); } });
      }));
      if (!seen) return;
      let b1 = 0, bKg = 0;
      e.sets.forEach(s => { if (!s.warmup) { b1 = Math.max(b1, e1rm(s.kg, s.reps)); bKg = Math.max(bKg, s.kg || 0); } });
      if (bKg > pbKg) rec.prs.push(`${e.name} 最大重量 ${fmtKg(bKg)}kg`);
      else if (b1 > pb1 + 0.01) rec.prs.push(`${e.name} 推定1RM ${Math.round(b1)}kg`);
    });
    rec.exercises.forEach(e => { if (!P.findExercise(e.name, S.custom)) registerCustom(Object.assign({}, e, exMeta(e.name))); });
    S.workouts.unshift(rec);
    queueUpsert(rec.id);
    S.workouts.sort((a, b) => b.start - a.start);
    S.active = null; S.rest = null; pushRestChange(true);
    saveNow(); ui.tab = 'history'; render(); keepAwake();
    showSummary(rec, w);
  }

  function showSummary(rec, src) {
    const n = S.workouts.length;
    const body = `
      <div class="sum-top"><div class="big">💪</div><h2>おつかれさまでした！</h2><div class="muted small">${n}回目のワークアウト</div></div>
      <div class="sgrid">
        <div><b>${dur(rec.end - rec.start)}</b><span>時間</span></div>
        <div><b>${fmtVol(volOf(rec))}</b><span>総重量</span></div>
        <div><b>${rec.exercises.reduce((a, e) => a + e.sets.filter(s => !s.warmup).length, 0)}</b><span>セット</span></div>
      </div>
      ${rec.prs.length ? `<div class="card det-ex">${rec.prs.map(p => `<div class="pr">🏆 ${esc(p)}</div>`).join('')}</div>` : ''}
      <div class="card det-ex">${rec.exercises.map(e => { const b = bestSet(e.sets); return `<div class="det-set" style="grid-template-columns:1fr auto"><span>${e.sets.filter(s => !s.warmup).length} × ${esc(e.name)}</span><span class="num muted">${b ? esc(setText(b, e.timed)) : ''}</span></div>`; }).join('')}</div>`;
    openSheet('記録しました', body, [
      { label: 'テンプレに保存', cls: 'soft', fn: () => saveTemplate(rec.title, src.exercises) },
      { label: '閉じる', cls: 'primary', fn: closeSheet },
    ]);
  }

  // ---------- レストタイマー ----------
  function startRest(sec, label, next) {
    S.rest = { endAt: Date.now() + sec * 1000, total: sec, label, next: next || '', fired: false };
    save(); tickRest();
    pushRest(label, next);
  }
  const rb = $('#restbar');
  rb.addEventListener('click', ev => {
    const b = ev.target.closest('[data-r]'); if (!b || !S.rest) return;
    const r = b.dataset.r;
    if (r === 'skip') { S.rest = null; pushRestChange(true); }
    else {
      const d = +r * 1000;
      S.rest.endAt = Math.max(Date.now(), S.rest.endAt + d); S.rest.total = Math.max(1, S.rest.total + +r);
      S.rest.fired = false;
      pushRestChange(false);
    }
    save(); tickRest();
  });
  let rbShape = '';
  function tickRest() {
    const r = S.rest;
    if (S.active) {
      const el = $('#woTime'); if (el) el.textContent = mmss((Date.now() - S.active.start) / 1000);
      const m = $('#miniTime'); if (m) m.textContent = mmss((Date.now() - S.active.start) / 1000);
    }
    if (!r || !S.active) { rb.hidden = true; rbShape = ''; return; }
    const left = (r.endAt - Date.now()) / 1000;
    rb.hidden = false;
    rb.classList.toggle('below-mini', !ui.woOpen);
    if (left <= 0) {
      if (!r.fired) { r.fired = true; r.finAt = Date.now(); beep(); save(); }
      if (rbShape !== 'fin') {
        rbShape = 'fin'; rb.classList.add('fin');
        rb.innerHTML = `<div class="rb-in"><div class="rb-l"><div class="rb-label">${esc(r.label)}</div><div class="rb-time">レスト終了！</div></div><button class="rb-btn" data-r="skip" style="background:rgba(255,255,255,.25);color:#fff">閉じる</button></div>`;
      }
      if (Date.now() - (r.finAt || 0) > 6000) { S.rest = null; save(); rb.hidden = true; rbShape = ''; }
      return;
    }
    if (rbShape !== 'run') {
      rbShape = 'run'; rb.classList.remove('fin');
      rb.innerHTML = `<div class="rb-prog"></div><div class="rb-in">
        <div class="rb-l"><div class="rb-label">${r.next ? '次: ' + esc(r.next) : 'レスト · ' + esc(r.label)}</div><div class="rb-time"></div></div>
        <button class="rb-btn" data-r="-15">−15</button><button class="rb-btn" data-r="15">＋15</button><button class="rb-btn skip" data-r="skip">スキップ</button></div>`;
    }
    $('.rb-time', rb).textContent = mmss(Math.ceil(left));
    $('.rb-prog', rb).style.width = Math.min(100, 100 * (1 - left / r.total)) + '%';
  }
  setInterval(tickRest, 250);

  // ---------- シート ----------
  let sheetStack = 0;
  function openSheet(title, body, buttons) {
    const sh = $('#sheet');
    sh.innerHTML = `<div class="sh-h"><h3>${title}</h3><button class="close-x" data-close aria-label="閉じる">×</button></div>
      <div class="sh-b">${body}</div>
      ${buttons && buttons.length ? `<div class="sh-f">${buttons.map((b, i) => `<button class="btn ${b.cls || 'gray'}" data-b="${i}">${esc(b.label)}</button>`).join('')}</div>` : ''}`;
    sh.hidden = false; $('#sheetBack').hidden = false; sheetStack++;
    sh.onclick = ev => {
      if (ev.target.closest('[data-close]')) return closeSheet();
      const b = ev.target.closest('[data-b]'); if (b) buttons[+b.dataset.b].fn();
    };
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheetBack').hidden = true; $('#sheet').innerHTML = ''; }
  $('#sheetBack').addEventListener('click', closeSheet);
  function actionSheet(title, items) {
    const sh = $('#sheet');
    sh.innerHTML = `<div class="acts"><div class="grp">${title ? `<div class="t">${esc(title).replace(/\n/g, '<br>')}</div>` : ''}${items.map((it, i) => `<button class="a ${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''}" data-i="${i}">${esc(it.label)}${it.on ? ' ✓' : ''}</button>`).join('')}</div>
      <div class="grp"><button class="a on" data-close>キャンセル</button></div></div>`;
    sh.hidden = false; $('#sheetBack').hidden = false;
    sh.onclick = ev => {
      if (ev.target.closest('[data-close]')) return closeSheet();
      const b = ev.target.closest('[data-i]'); if (!b) return;
      closeSheet(); items[+b.dataset.i].fn();
    };
  }

  // ---------- スプレッドシート連携 ----------
  // ワークアウトを完了すると、Apps Script のウェブアプリ経由でシートに保存する。
  // 電波がないときは S.sync に溜めておき、次に開いたときに送る。
  const API_KEY = 'kintore:api';
  function apiUrl() { try { return localStorage.getItem(API_KEY) || ''; } catch (e) { return ''; } }
  function setApiUrl(u) { try { if (u) localStorage.setItem(API_KEY, u); else localStorage.removeItem(API_KEY); } catch (e) { /* noop */ } }
  const cfgString = () => JSON.stringify({ templates: S.templates, custom: S.custom, settings: S.settings });
  let syncState = { busy: false, error: '' };

  async function api(action, payload) {
    const res = await fetch(apiUrl(), {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, payload || {})),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '保存に失敗しました');
    return j;
  }
  function queueUpsert(id) { S.sync.del = S.sync.del.filter(x => x !== id); if (!S.sync.up.includes(id)) S.sync.up.push(id); flush(); }
  function queueDelete(id) { S.sync.up = S.sync.up.filter(x => x !== id); if (!S.sync.del.includes(id)) S.sync.del.push(id); flush(); }
  let flushT = null;
  function scheduleFlush() { clearTimeout(flushT); flushT = setTimeout(flush, 1500); }

  async function flush() {
    if (!apiUrl() || syncState.busy || !navigator.onLine) return;
    const cfg = cfgString();
    if (!S.sync.up.length && !S.sync.del.length && cfg === S.sync.cfgHash) return;
    syncState.busy = true; refreshSyncCard();
    try {
      if (S.sync.del.length) { const ids = S.sync.del.slice(); await api('delete', { ids }); S.sync.del = S.sync.del.filter(x => !ids.includes(x)); }
      if (S.sync.up.length) {
        const ids = S.sync.up.slice();
        const workouts = S.workouts.filter(w => ids.includes(w.id));
        if (workouts.length) await api('upsert', { workouts });
        S.sync.up = S.sync.up.filter(x => !ids.includes(x));
      }
      if (cfg !== S.sync.cfgHash) { await api('saveConfig', { config: JSON.parse(cfg) }); S.sync.cfgHash = cfg; }
      S.sync.last = Date.now(); syncState.error = '';
    } catch (e) {
      syncState.error = e.message || String(e);
    } finally {
      syncState.busy = false;
      try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* noop */ }
      refreshSyncCard();
    }
  }

  // シートとアプリの記録を突き合わせる（新しい端末ではシートから復元される）
  async function fullSync(verbose) {
    if (!apiUrl() || syncState.busy) return;
    syncState.busy = true; refreshSyncCard();
    try {
      const j = await api('load');
      const local = new Set(S.workouts.map(w => w.id));
      const remote = new Set((j.workouts || []).map(w => w.id));
      let got = 0, addedTpl = 0;
      (j.workouts || []).forEach(w => { if (!local.has(w.id) && !S.sync.del.includes(w.id)) { S.workouts.push(w); got++; } });
      S.workouts.sort((a, b) => b.start - a.start);
      S.workouts.forEach(w => { if (!remote.has(w.id) && !S.sync.up.includes(w.id)) S.sync.up.push(w.id); });
      const sent = S.sync.up.length;
      if (j.config) {
        const c = j.config;
        const tIds = new Set(S.templates.map(t => t.id));
        (c.templates || []).forEach(t => { if (!tIds.has(t.id)) { S.templates.push(t); addedTpl++; } });
        const names = new Set(S.custom.map(x => x.name));
        (c.custom || []).forEach(x => { if (!names.has(x.name)) S.custom.push(x); });
      }
      S.sync.cfgHash = j.config ? JSON.stringify({ templates: j.config.templates, custom: j.config.custom, settings: j.config.settings }) : '';
      syncState.busy = false; syncState.error = '';
      saveNow();
      if (got || addedTpl || ui.tab === 'settings') render();
      await flush();
      if (verbose) toast(`同期しました（受信 ${got}件・送信 ${sent}件）`);
    } catch (e) {
      syncState.busy = false; syncState.error = e.message || String(e);
      refreshSyncCard();
      if (verbose) toast('同期できませんでした: ' + syncState.error);
    }
  }

  function syncCard() {
    const url = apiUrl();
    if (!url) return `
      <div class="card" style="padding:14px 16px">
        <div class="small" style="margin-bottom:10px">記録をGoogleスプレッドシートに自動で保存します。Claudeに頼めば、伸びの分析やグラフ作りができます。</div>
        <input class="search" id="syncUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec">
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn gray sm" data-act="sync-help" style="flex:1">設定方法</button>
          <button class="btn primary sm" data-act="sync-connect" style="flex:1">接続する</button>
        </div>
      </div>`;
    const pend = S.sync.up.length + S.sync.del.length;
    const last = S.sync.last ? dateLabel(S.sync.last, true) : 'まだ';
    const status = syncState.busy ? '同期中…' : syncState.error ? '⚠️ ' + syncState.error : pend ? `未送信 ${pend}件（電波が戻ったら送ります）` : '✓ 最新です';
    return `
      <div class="card" id="syncCard">
        <div class="set-row"><span>状態</span><span class="small ${syncState.error ? '' : 'muted'}" style="text-align:right">${esc(status)}</span></div>
        <div class="set-row"><span>最終同期</span><span class="small muted">${esc(last)}</span></div>
        <button class="set-row link" style="width:100%" data-act="sync-now">今すぐ同期</button>
        <button class="set-row" style="width:100%;color:var(--red)" data-act="sync-off">連携を解除</button>
      </div>`;
  }
  function refreshSyncCard() {
    const c = $('#syncCard');
    if (c && ui.tab === 'settings') c.outerHTML = syncCard();
  }
  async function connectSheet() {
    const url = ($('#syncUrl').value || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) return toast('「https://script.google.com/macros/s/…/exec」の形のURLを貼ってください');
    setApiUrl(url);
    toast('接続しています…');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'load' }) });
      const j = await res.json();
      if (!j.ok || j.app !== 'kintore') throw new Error('キントレ用のスクリプトではないようです');
    } catch (e) {
      setApiUrl(''); render();
      return toast('接続できませんでした: ' + (e.message || e));
    }
    S.sync.cfgHash = '';
    render();
    fullSync(true);
  }
  function syncHelp() {
    openSheet('スプレッドシート連携の設定', `<div class="guide card" style="line-height:1.8">
      パソコンで行うのがおすすめです。<br>
      1. Googleスプレッドシートを新しく作り、名前を「キントレデータ」にする<br>
      2. 拡張機能 → Apps Script を開き、中身を全部消して <a class="link" href="https://github.com/maomax0427/kintore/blob/main/apps-script/Code.gs" target="_blank" rel="noopener">Code.gs</a> を貼り付けて保存<br>
      3. 上の関数選択で「setup」を選んで ▶ 実行 → 権限を許可<br>
      4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」でデプロイ<br>
      5. 表示されたウェブアプリのURLを、ここに貼って「接続する」<br>
      <span class="muted small">URLは合言葉のようなものなので、人に教えないでください。</span>
    </div>`, [{ label: '閉じる', cls: 'gray', fn: closeSheet }]);
  }
  window.addEventListener('online', flush);

  // ---------- レスト終了の通知 ----------
  // 端末で暗号化した通知を Apps Script に預け、レスト終了の時刻に送ってもらう。
  const PUSH_KEY = 'kintore:push';
  function pushState() { try { return JSON.parse(localStorage.getItem(PUSH_KEY)) || null; } catch (e) { return null; } }
  function setPushState(v) { try { if (v) localStorage.setItem(PUSH_KEY, JSON.stringify(v)); else localStorage.removeItem(PUSH_KEY); } catch (e) { /* noop */ } }
  const pushOn = () => { const st = pushState(); return !!(st && st.sub); };
  const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  let restToken = null;

  async function enablePush() {
    if (!apiUrl()) { toast('先に「スプレッドシート連携」を設定してください'); return false; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      toast(isStandalone() ? 'この端末では通知が使えません（iOS 16.4以降が必要）' : 'ホーム画面に追加したキントレから設定してください');
      return false;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('通知が許可されていません（iPhoneの 設定 → 通知 → キントレ で許可できます）'); return false; }
    try {
      const info = await fetch(apiUrl()).then(r => r.json());
      if (!info || (info.version || 1) < 2) { toast('スプレッドシートのスクリプトを最新版に更新してください'); return false; }
      const reg = await navigator.serviceWorker.ready;
      const st = pushState() || {};
      let sub = await reg.pushManager.getSubscription();
      if (!st.vapid) { st.vapid = await KintorePush.generateVapid(); if (sub) { await sub.unsubscribe(); sub = null; } }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: KintorePush.unb64u(st.vapid.pub) });
      st.sub = sub.toJSON();
      setPushState(st);
      return true;
    } catch (e) {
      toast('通知をオンにできませんでした: ' + (e.message || e));
      return false;
    }
  }
  async function disablePush() {
    setPushState(null);
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* noop */ }
  }
  const postApi = body => fetch(apiUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(r => r.json());

  async function pushRest(label, next) {
    const st = pushState();
    if (!st || !st.sub || !apiUrl()) return;
    const token = uid(); restToken = token;
    try {
      const req = await KintorePush.buildRequest(st.sub, st.vapid, { title: 'レスト終了', body: next ? '次: ' + next : label + ' のレストが終わりました', tag: 'rest' });
      if (restToken !== token || !S.rest) return;
      postApi(Object.assign({ action: 'rest', token, ms: Math.max(0, S.rest.endAt - Date.now()) }, req)).catch(() => {});
    } catch (e) { /* 通知が送れなくてもアプリ内のタイマーは動く */ }
  }
  function pushRestChange(cancel) {
    if (!restToken || !apiUrl()) return;
    const body = { action: cancel || !S.rest ? 'restCancel' : 'restUpdate', token: restToken, ms: S.rest ? Math.max(0, S.rest.endAt - Date.now()) : 0 };
    if (body.action === 'restCancel') restToken = null;
    postApi(body).catch(() => {});
  }
  async function pushTest() {
    const st = pushState(); if (!st) return;
    toast('10秒後に届きます。画面をロックするか、ほかのアプリに切り替えてください');
    try {
      const req = await KintorePush.buildRequest(st.sub, st.vapid, { title: 'キントレ', body: 'テスト通知です。届いていれば設定完了です 💪', tag: 'test' });
      const j = await postApi(Object.assign({ action: 'rest', token: 'test-' + uid(), ms: 10000 }, req));
      if (!j.ok) toast('送れませんでした: ' + (j.error || '') + (j.status ? '（' + j.status + '）' : ''));
    } catch (e) { toast('送れませんでした: ' + (e.message || e)); }
  }

  // ---------- 起動 ----------
  if (S.active) ui.woOpen = true;
  render();
  keepAwake();
  if (apiUrl()) fullSync(false);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
