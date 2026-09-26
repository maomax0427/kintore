// テキストで書いた筋トレメニューを「種目・セット・レスト」に変換する。
// 例: 「ベンチプレス 60kg 10回 3セット レスト2分」「スクワット 80x5x5」「懸垂 10,8,6」
(function (root) {
  'use strict';

  // 種目ライブラリ: [名前, 部位, 複合種目か, 別名..., (timed=時間で行う種目)]
  const LIB_SRC = [
    ['ベンチプレス', '胸', 1, 'ベンチ', 'bench', 'benchpress', 'bp', 'バーベルベンチプレス'],
    ['インクラインベンチプレス', '胸', 1, 'インクラインベンチ', 'インクライン', 'inclinebench', 'inclinebenchpress'],
    ['ダンベルプレス', '胸', 1, 'dbプレス', 'dbベンチ', 'ダンベルベンチプレス', 'dumbbellpress', 'dbpress'],
    ['インクラインダンベルプレス', '胸', 1, 'インクラインdbプレス', 'inclinedumbbellpress'],
    ['ダンベルフライ', '胸', 0, 'フライ', 'dbフライ', 'dumbbellfly'],
    ['ケーブルクロスオーバー', '胸', 0, 'ケーブルクロス', 'cablecrossover', 'ケーブルフライ'],
    ['チェストプレス', '胸', 1, 'マシンチェストプレス', 'chestpress'],
    ['ペックフライ', '胸', 0, 'ペックデック', 'マシンフライ', 'pecdeck', 'pecfly'],
    ['ディップス', '胸', 1, 'ディップ', 'dips', 'dip'],
    ['腕立て伏せ', '胸', 1, '腕立て', 'プッシュアップ', 'pushup', 'pushups'],
    ['デッドリフト', '背中', 1, 'デッド', 'deadlift', 'dl'],
    ['懸垂', '背中', 1, 'チンニング', 'プルアップ', 'pullup', 'pullups', 'chinup', 'チンアップ'],
    ['ラットプルダウン', '背中', 1, 'ラットプル', 'プルダウン', 'latpulldown', 'pulldown'],
    ['ベントオーバーロウ', '背中', 1, 'ベントロウ', 'バーベルロウ', 'ベントオーバーロー', 'bentoverrow', 'barbellrow'],
    ['ダンベルロウ', '背中', 1, 'ワンハンドロウ', 'ワンハンドダンベルロウ', 'dumbbellrow', 'dbrow'],
    ['シーテッドロウ', '背中', 1, 'ケーブルロウ', 'シーテッドケーブルロウ', 'seatedrow', 'cablerow'],
    ['Tバーロウ', '背中', 1, 'tbarrow'],
    ['バックエクステンション', '背中', 0, 'backextension', 'ハイパーエクステンション'],
    ['シュラッグ', '背中', 0, 'shrug', 'shrugs'],
    ['スクワット', '脚', 1, 'バックスクワット', 'バーベルスクワット', 'squat', 'squats', 'sq'],
    ['フロントスクワット', '脚', 1, 'frontsquat'],
    ['ブルガリアンスクワット', '脚', 1, 'ブルガリアン', 'ブルガリアンスプリットスクワット', 'bulgariansplitsquat'],
    ['ゴブレットスクワット', '脚', 1, 'gobletsquat'],
    ['ハックスクワット', '脚', 1, 'hacksquat'],
    ['レッグプレス', '脚', 1, 'legpress'],
    ['ルーマニアンデッドリフト', '脚', 1, 'ルーマニアンデッド', 'ルーマニアン', 'rdl', 'romaniandeadlift'],
    ['ランジ', '脚', 1, 'lunge', 'lunges', 'ウォーキングランジ'],
    ['ヒップスラスト', '脚', 1, 'hipthrust'],
    ['レッグエクステンション', '脚', 0, 'legextension'],
    ['レッグカール', '脚', 0, 'legcurl', 'ライイングレッグカール', 'シーテッドレッグカール'],
    ['カーフレイズ', '脚', 0, 'calfraise', 'カーフ'],
    ['ショルダープレス', '肩', 1, 'オーバーヘッドプレス', 'ohp', 'ミリタリープレス', 'shoulderpress', 'overheadpress'],
    ['ダンベルショルダープレス', '肩', 1, 'dbショルダープレス', 'dumbbellshoulderpress'],
    ['サイドレイズ', '肩', 0, 'ラテラルレイズ', 'サイドレイズ', 'lateralraise', 'sideraise', 'dbサイドレイズ'],
    ['フロントレイズ', '肩', 0, 'frontraise'],
    ['リアレイズ', '肩', 0, 'リアデルト', 'リアデルトフライ', 'reardelt', 'rearraise', 'リアデルトレイズ'],
    ['フェイスプル', '肩', 0, 'facepull'],
    ['アップライトロウ', '肩', 1, 'uprightrow'],
    ['バーベルカール', '腕', 0, 'barbellcurl', 'ezバーカール'],
    ['ダンベルカール', '腕', 0, 'アームカール', 'カール', 'dumbbellcurl', 'curl', 'dbカール'],
    ['ハンマーカール', '腕', 0, 'hammercurl'],
    ['プリーチャーカール', '腕', 0, 'preachercurl'],
    ['トライセプスエクステンション', '腕', 0, 'フレンチプレス', 'オーバーヘッドエクステンション', 'tricepsextension', 'トライセップスエクステンション'],
    ['トライセプスプレスダウン', '腕', 0, 'プレスダウン', 'ケーブルプレスダウン', 'pushdown', 'pressdown', 'トライセプスプッシュダウン', 'プッシュダウン'],
    ['スカルクラッシャー', '腕', 0, 'ライイングトライセプスエクステンション', 'skullcrusher'],
    ['ナローベンチプレス', '腕', 1, 'ナローベンチ', 'クローズグリップベンチプレス', 'closegripbench'],
    ['クランチ', '腹', 0, 'crunch', 'crunches', '腹筋'],
    ['プランク', '腹', 0, 'plank', 'timed'],
    ['アブローラー', '腹', 0, '腹筋ローラー', 'abroller', 'アブホイール', 'abwheel'],
    ['レッグレイズ', '腹', 0, 'legraise'],
    ['ハンギングレッグレイズ', '腹', 0, 'hanginglegraise'],
    ['ロシアンツイスト', '腹', 0, 'russiantwist'],
    ['ボックスジャンプ', '脚', 0, 'boxjump'],
    ['片脚ボックスジャンプ', '脚', 0, 'シングルレッグボックスジャンプ'],
    ['トラップバースクワットジャンプ', '脚', 0, 'トラップバージャンプ', 'ヘックスバージャンプ'],
    ['クォータースクワット', '脚', 1, 'quartersquat', 'クオータースクワット'],
    ['バーベルラテラルランジ', '脚', 1, 'ラテラルランジ', 'laterallunge'],
    ['ワンレッグワンハンドダンベルRDL', '脚', 0, 'シングルレッグrdl', '片脚rdl'],
    ['アイソメトリックチンニング', '背中', 0, 'アイソメトリック懸垂', 'timed'],
    ['ハングクリーン', '全身', 1, 'hangclean'],
    ['パワークリーン', '全身', 1, 'powerclean'],
    ['プッシュプレス', '肩', 1, 'pushpress'],
    ['ランドマインローテーション', '腹', 0, 'landminerotation', 'ランドマインツイスト'],
    ['ランニング', '有酸素', 0, 'ラン', 'run', 'running', 'ジョギング', 'timed'],
    ['トレッドミル', '有酸素', 0, 'treadmill', 'timed'],
    ['エアロバイク', '有酸素', 0, 'バイク', 'bike', 'timed'],
  ];

  const PARTS = ['胸', '背中', '脚', '肩', '腕', '腹', '全身', '有酸素', 'その他'];

  const key = s => String(s).normalize('NFKC').toLowerCase().replace(/[\s・\-_.]/g, '');

  const BUILTIN = LIB_SRC.map(([name, part, compound, ...aliases]) => ({
    id: 'b:' + name,
    name, part, compound: !!compound,
    timed: aliases.includes('timed'),
    aliases: aliases.filter(a => a !== 'timed'),
  }));

  function findExercise(name, custom) {
    const k = key(name);
    const all = BUILTIN.concat(custom || []);
    return all.find(e => key(e.name) === k || (e.aliases || []).some(a => key(a) === k)) || null;
  }

  // ライブラリにない種目は、名前から部位と「複合種目か」を推測する
  function guessMeta(name) {
    const n = key(name);
    const has = list => list.some(w => n.includes(w));
    let part = 'その他';
    if (has(['カール', 'トライセプス', 'トライセップス', '腕', 'curl', 'tricep', 'bicep'])) part = '腕';
    else if (has(['スクワット', 'レッグ', 'ランジ', 'カーフ', '脚', 'ヒップ', 'squat', 'leg', 'lunge', 'glute'])) part = '脚';
    else if (has(['ショルダー', 'レイズ', 'デルト', '肩', 'shoulder', 'raise', 'delt'])) part = '肩';
    else if (has(['ロウ', 'ロー', 'プル', '懸垂', 'デッド', '背', 'row', 'pull', 'dead', 'lat'])) part = '背中';
    else if (has(['ベンチ', 'チェスト', 'フライ', '胸', 'bench', 'chest', 'fly'])) part = '胸';
    else if (has(['腹', 'クランチ', 'プランク', 'abs', 'crunch', 'plank'])) part = '腹';
    const compound = has(['スクワット', 'デッド', 'ベンチ', 'ロウ', '懸垂', 'チン', 'ディップ', 'クリーン', 'スナッチ', 'ランジ', 'squat', 'dead', 'bench', 'row', 'pullup', 'chin', 'dip'])
      || (has(['プレス', 'press']) && !has(['プレスダウン', 'pressdown']));
    const timed = has(['プランク', 'plank', 'ラン', 'run', 'バイク', 'bike', 'ウォーク', 'walk']);
    return { part, compound, timed };
  }

  // 「2分」「90秒」「1分30秒」「2」(単位なし: 10以下は分とみなす) → 秒
  function toSeconds(num, unit, extraSec) {
    let v = parseFloat(num);
    if (/^(分|m|min|mins|minutes?)$/.test(unit || '')) v *= 60;
    else if (!unit) v = v <= 10 ? v * 60 : v;
    return Math.round(v + (extraSec ? parseFloat(extraSec) : 0));
  }

  // 「レスト60-90秒」のような幅は長い方を使う
  const REST_RE = /(?:レスト|休憩|インターバル|休息|rest|interval)\s*(?:は|を)?\s*(?:全部|すべて|全て)?\s*[:：=]?\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(分|秒|s|sec|secs|seconds?|m|min|mins|minutes?)?(?:\s*(\d+)\s*(?:秒|s|sec))?/i;

  // 1つの塊（例「60kg 10回 3セット」「60x10x3」「8」）を読む
  function parseChunk(c, lb) {
    const r = { kg: null, reps: null, sets: null, sec: null, bw: false };
    let s = ' ' + c + ' ';
    if (/自重|bw\b|bodyweight/.test(s)) { r.bw = true; s = s.replace(/自重|bw\b|bodyweight/g, ' '); }
    s = s.replace(/(\d+(?:\.\d+)?)\s*(kg|lb)/, (_, n, u) => {
      r.kg = u === 'lb' ? Math.round(parseFloat(n) * 0.4536 * 2) / 2 : parseFloat(n); return ' ';
    });
    s = s.replace(/(\d+)\s*set/, (_, n) => { r.sets = +n; return ' '; });
    s = s.replace(/(\d+)\s*回/, (_, n) => { r.reps = +n; return ' '; });
    s = s.replace(/(\d+(?:\.\d+)?)\s*(秒|sec|s\b|分|min)/, (_, n, u) => { r.sec = toSeconds(n, u === '秒' || u === 'sec' || u === 's' ? '秒' : '分'); return ' '; });
    const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);

    // 2つの数字は基本「回数×セット」（2×4 = 2回を4セット）。「3x10」のように 5以下×8以上 のときだけ「セット×回数」
    const pair = (a, b) => {
      if (a <= 5 && b >= 8) { r.sets = a; r.reps = b; } else { r.reps = a; r.sets = b; }
    };
    const free = nums.slice();
    if (r.kg == null && r.reps == null && r.sets == null && !r.bw && r.sec == null) {
      if (free.length >= 3) { r.kg = free[0]; pair(free[1], free[2]); }
      else if (free.length === 2) {
        const [a, b] = free;
        if (Math.min(a, b) <= 6 && Number.isInteger(a) && a < 20) pair(a, b);
        else { r.kg = a; r.reps = b; }
      } else if (free.length === 1) r.reps = free[0];
    } else {
      // すでに分かっている値を除いて、残りを 重さ→回数→セット の順に埋める
      const want = [];
      if (r.kg == null && !r.bw && r.sec == null && r.reps != null) want.push('kg');
      if (r.reps == null && r.sec == null) want.push('reps');
      if (r.sets == null) want.push('sets');
      if (free.length >= 2 && want[0] === 'reps' && want[1] === 'sets') pair(free[0], free[1]);
      else if (want[0] === 'kg' && free.length === 1) {
        // 「10回 x3」→ セット、「60 10回」→ 重さ
        if (free[0] <= 10 && /x/.test(c)) r.sets = free[0]; else r.kg = free[0];
      } else {
        want.forEach((w, i) => { if (free[i] != null) r[w] = free[i]; });
      }
    }
    return r;
  }

  const BULLET_RE = /^\s*(?:[①-⑳]|[-・•*●○◯▶>＞]|\d{1,2}[.)．）、](?!\d))/;
  function stripBullet(line) {
    return line
      .replace(/^\s*[①-⑳]\s*/, '')
      .replace(/^\s*(?:[-・•*●○◯▶>＞]|\d{1,2}[.)．）、](?!\d))\s*/, '');
  }

  const TITLE_RE = /^\s*(#|【|■|◆|\[|(week|day)\s*\d)/i;
  function isTitle(raw, name, spec) {
    if (TITLE_RE.test(raw)) return true;
    if (spec) return false;
    return /の日$|メニュー$|^(push|pull|legs?|upper|lower)\b/i.test(name) || PARTS.includes(name) || /^(胸|背中|脚|肩|腕|腹)[・と、&+ ]/.test(name);
  }
  // 「メイン」「サブメニュー」のような区切りの行
  const SECTION_RE = /^(ウォームアップ|ウォーミングアップ|メイン|サブ|補助|アクセサリー|ポテンシエーション|プライオ|コンディショニング|フィニッシャー|仕上げ|クールダウン|ストレッチ|スーパーセット|サーキット|パワー|スピード|アジリティ|コア)/;

  function median(a) { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; }

  // レストの自動設定: 高重量の複合種目は長め、単関節種目は短め
  function autoRest(ex) {
    const reps = median(ex.sets.map(s => s.reps));
    if (ex.timed || ex.part === '有酸素') return 60;
    if (ex.compound) return reps != null && reps <= 5 ? 180 : 120;
    return reps != null && reps >= 15 ? 60 : 90;
  }

  const tilde = s => s.replace(/(\d)\s*-\s*(\d)/g, '$1〜$2');
  const clean = s => s.replace(/^[\s・、,:：\-–]+|[\s・、,:：\-–]+$/g, '').trim();

  // 略称（ベンチ、デッド、bench）は正式名に。「バックスクワット」「チンニング」のように書いた名前はそのまま使う
  function displayName(name, lib) {
    if (!lib) return name;
    if (/^[\x00-\x7f]+$/.test(name) || name.length < lib.name.length) return lib.name;
    return name;
  }

  function normalizeLine(raw) {
    return stripBullet(raw).normalize('NFKC')
      .replace(/[×✕✖＊*]/g, 'x')
      .replace(/[〜～]/g, '-')
      .replace(/@?\s*rpe\s*\d+(\.\d+)?/ig, ' ');
  }

  function parseMenu(text, opts) {
    opts = opts || {};
    const custom = opts.customExercises || [];
    const defaultSets = opts.defaultSets || 3;
    const out = { title: '', exercises: [], warnings: [], globalRest: null };
    let last = null;
    let section = null; // { label, rest, rounds, exs: [] }
    const lines = String(text || '').split(/\r?\n/);

    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      if (!raw.trim() || /^\s*(※|\/\/|-{3,}|={3,})/.test(raw)) continue;
      const bulleted = BULLET_RE.test(raw);
      let line = normalizeLine(raw);

      if (TITLE_RE.test(raw) && !out.exercises.length) {
        out.title = out.title || clean(tilde(line).replace(/^[#【■◆\[\s]+|[】\]]\s*$/g, ''));
        continue;
      }

      // レスト指定を先に取り出す
      let rest = null, restAll = false, restText = '';
      const m = line.match(REST_RE);
      if (m) {
        rest = toSeconds(m[2] || m[1], m[3] && m[3].toLowerCase(), m[4]);
        restAll = /全部|すべて|全て|all/.test(m[0]) || /全部|すべて|全て|共通/.test(line);
        restText = 'レスト' + tilde(m[0].replace(/^\D+/, '')).replace(/\s+/g, '');
        line = line.replace(m[0], ' ');
      }
      // 「2周」
      let rounds = null;
      line = line.replace(/(\d+)\s*(周|ラウンド|rounds?)/i, (_, n) => { rounds = +n; return ' '; });

      // メモ: かっこの中身、「92-95%1RM」「DL1RMの60-70%」、左右
      const notes = [];
      line = line.replace(/[(（]([^)）]*)[)）]|((?:[A-Za-z]+\s*1RMの)?\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*%(?:\s*[A-Za-z]*1RM)?)|左右(?:それぞれ|各)?|片側ずつ|各側/gi, (t, paren, pct) => {
        const c = paren != null ? clean(tilde(paren)) : pct ? tilde(pct.replace(/\s+/g, '')) : '左右それぞれ';
        if (c) notes.push(c);
        return ' ';
      });
      line = line.replace(/ずつ/g, ' ');

      // 区切り（セクション）の行
      const plain = clean(line);
      if (plain && !/\d|自重|\bbw\b/i.test(plain) && !bulleted) {
        let next = '';
        for (let k = li + 1; k < lines.length; k++) if (lines[k].trim()) { next = lines[k]; break; }
        const nextIsItem = BULLET_RE.test(next) && !/^\d/.test(normalizeLine(next).trim());
        if (SECTION_RE.test(plain) || (nextIsItem && !findExercise(plain, custom))) {
          const extras = [restText, rounds ? rounds + '周' : ''].concat(notes).filter(Boolean);
          section = { label: plain + (extras.length ? '（' + extras.join('・') + '）' : ''), rest, rounds, exs: [] };
          continue;
        }
      }

      // ウォームアップ行
      let warmup = false;
      line = line.replace(/^\s*(ウォームアップ|ウォーミングアップ|アップ|w-?up|wu)\s*[:：]?\s*/i, () => { warmup = true; return ''; });

      // 最初の数字 or 「自重」の前までが種目名（「10kgプレート」のように名前の一部なら含める）
      let idx = line.search(/\d|自重|\bbw\b/i);
      let nameEnd = idx;
      const inName = idx >= 0 && line.slice(idx).match(/^\d+(?:\.\d+)?\s*kg[^\s\dx,、\/;]+/i);
      if (inName && clean(line.slice(0, idx))) {
        nameEnd = idx + inName[0].length;
        const j = line.slice(nameEnd).search(/\d|自重|\bbw\b/i);
        idx = j < 0 ? -1 : nameEnd + j;
      }
      let name = clean(nameEnd < 0 ? line : line.slice(0, nameEnd));
      let spec = (idx < 0 ? '' : line.slice(idx)).toLowerCase()
        .replace(/キロ/g, 'kg').replace(/lbs|ポンド/g, 'lb')
        .replace(/レップス?|reps?\b/g, '回').replace(/sets?\b|セット/g, 'set')
        .trim();

      if (!name && !spec) {
        if (rest != null) {
          if (!last || restAll) out.globalRest = rest;
          else if (section && section.exs.length) section.exs.forEach(e => { if (!e.restFromLine) { e.rest = rest; e.restExplicit = true; } });
          else { last.rest = rest; last.restExplicit = true; last.restFromLine = true; }
        }
        if (last && notes.length) last.note = [last.note].concat(notes).filter(Boolean).join(' / ');
        continue;
      }

      if (name && isTitle(raw, name, spec)) { out.title = out.title || name.replace(/^[#【■◆\[\s]+|[】\]]$/g, '').trim(); continue; }

      // セット内容を読む
      const chunks = spec ? spec.split(/[,、;\/，]/).map(s => s.trim()).filter(Boolean) : [];
      const parsed = chunks.map(c => parseChunk(c));
      const newSets = [];
      let carryKg = last && !name && last.sets.length ? last.sets[last.sets.length - 1].kg : null;
      parsed.forEach(r => {
        const kg = r.bw ? 0 : (r.kg != null ? r.kg : carryKg);
        if (r.bw) carryKg = 0; else if (r.kg != null) carryKg = r.kg;
        const n = r.sets || (chunks.length === 1 && name ? 0 : 1);
        for (let k = 0; k < (n || 1); k++) newSets.push({ kg, reps: r.reps, sec: r.sec, warmup });
      });
      const implicit = name && chunks.length === 1 && !parsed[0].sets; // セット数の指定なし

      if (name) {
        const lib = findExercise(name, custom);
        const meta = lib || guessMeta(name);
        const ex = {
          name: displayName(name, lib),
          exId: lib ? lib.id : null,
          part: meta.part, compound: meta.compound, timed: meta.timed,
          note: notes.join(' / '),
          section: section ? section.label : '',
          sets: [], rest: null, restExplicit: false,
          implicit: false,
        };
        if (rest != null) { ex.rest = rest; ex.restExplicit = true; ex.restFromLine = true; }
        else if (section && section.rest != null) { ex.rest = section.rest; ex.restExplicit = true; }
        const n = (section && section.rounds) || rounds || defaultSets;
        if (!chunks.length) { // 種目名だけ → 空のセット（下の行でセットが来たら置き換え）
          for (let k = 0; k < n; k++) ex.sets.push({ kg: null, reps: null, sec: null, warmup: false });
          ex.implicit = 'empty';
        } else if (implicit) {
          for (let k = 0; k < n; k++) ex.sets.push(Object.assign({}, newSets[0]));
          ex.implicit = 'repeat';
        } else ex.sets = newSets;
        out.exercises.push(ex);
        if (section) section.exs.push(ex);
        last = ex;
      } else {
        if (!last) { out.warnings.push('種目名が見つからない行: ' + raw.trim()); continue; }
        if (last.implicit === 'empty') last.sets = [];
        else if (last.implicit === 'repeat') last.sets = last.sets.slice(0, 1);
        last.implicit = false;
        // 前のセットの重さを引き継ぐ
        let prevKg = last.sets.length ? last.sets[last.sets.length - 1].kg : null;
        newSets.forEach(s => { if (s.kg == null) s.kg = prevKg; else prevKg = s.kg; });
        last.sets.push(...newSets);
        if (notes.length) last.note = [last.note].concat(notes).filter(Boolean).join(' / ');
        if (rest != null) { last.rest = rest; last.restExplicit = true; last.restFromLine = true; }
      }
    }

    // ウォームアップを先頭に並べ、レストを決める
    out.exercises.forEach(ex => {
      ex.sets.sort((a, b) => (b.warmup ? 1 : 0) - (a.warmup ? 1 : 0));
      if (!ex.timed && ex.sets.length && ex.sets.every(s => s.sec && !s.reps)) ex.timed = true;
      if (!ex.restExplicit) { ex.rest = out.globalRest != null ? out.globalRest : autoRest(ex); ex.restAuto = out.globalRest == null; }
      delete ex.implicit; delete ex.restFromLine;
    });
    return out;
  }

  // 「Week1 Day1」「【胸の日】」のような見出しごとに分けて、複数のメニューとして読む
  function parseProgram(text, opts) {
    const blocks = [];
    let cur = [];
    String(text || '').split(/\r?\n/).forEach(l => {
      if (TITLE_RE.test(l) && cur.some(x => x.trim() && !TITLE_RE.test(x))) { blocks.push(cur); cur = []; }
      cur.push(l);
    });
    blocks.push(cur);
    return blocks.map(b => Object.assign(parseMenu(b.join('\n'), opts), { text: b.join('\n').trim() })).filter(r => r.exercises.length);
  }

  const api = { parseMenu, parseProgram, findExercise, guessMeta, autoRest, BUILTIN, PARTS, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KintoreParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
