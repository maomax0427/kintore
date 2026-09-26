/**
 * キントレ — 記録保存用 Apps Script
 * スプレッドシート「キントレデータ」の 拡張機能 → Apps Script に貼り付けて、
 *   1. 関数「setup」を一度実行（権限を承認）
 *   2. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行：自分
 *        アクセスできるユーザー：全員
 * で公開してください。発行された URL をアプリの 設定 → スプレッドシート連携 に貼ります（他人に教えないこと）。
 *
 * シート
 *   workouts … 1回のワークアウトにつき1行（最後の data 列はアプリ復元用の JSON）
 *   sets     … 1セットにつき1行（グラフや分析用）
 *   config   … テンプレート・自作種目・設定（A2 に JSON）
 */
const WO_SHEET = 'workouts';
const SET_SHEET = 'sets';
const CFG_SHEET = 'config';
const WO_HEAD = ['workoutId', '日付', '開始', '終了', '時間(分)', 'タイトル', '種目数', 'セット数', '総重量(kg)', 'PR', 'data'];
const SET_HEAD = ['workoutId', '日時', 'タイトル', '順番', '種目', '部位', 'セクション', 'セット', 'ウォームアップ', '重量(kg)', '回数', '秒', '推定1RM', 'ボリューム(kg)', 'メモ'];

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name, head, formats) {
  let sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    Object.keys(formats || {}).forEach(a1 => sh.getRange(a1).setNumberFormat(formats[a1]));
  }
  return sh;
}
const woSheet_ = () => sheet_(WO_SHEET, WO_HEAD, { 'A:A': '@', 'B:B': 'yyyy-mm-dd', 'C:D': 'yyyy-mm-dd hh:mm', 'F:F': '@', 'J:K': '@' });
const setSheet_ = () => sheet_(SET_SHEET, SET_HEAD, { 'A:A': '@', 'B:B': 'yyyy-mm-dd hh:mm', 'C:C': '@', 'E:G': '@', 'O:O': '@' });
function cfgSheet_() {
  let sh = ss_().getSheetByName(CFG_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(CFG_SHEET);
    sh.getRange('A1').setValue('config (JSON)').setFontWeight('bold');
    sh.getRange('A2').setNumberFormat('@');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const e1rm_ = (kg, reps) => (!kg || !reps) ? '' : Math.round((reps === 1 ? kg : kg * (1 + reps / 30)) * 10) / 10;
const blank_ = v => (v == null ? '' : v);

function woRow_(w) {
  let sets = 0, vol = 0;
  w.exercises.forEach(e => e.sets.forEach(s => { if (!s.warmup) { sets++; vol += (s.kg || 0) * (s.reps || 0); } }));
  const start = new Date(w.start);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return [String(w.id), day, start, new Date(w.end), Math.round((w.end - w.start) / 60000), w.title || '',
    w.exercises.length, sets, Math.round(vol), (w.prs || []).join(' / '), JSON.stringify(w)];
}

function setRows_(w) {
  const rows = [];
  const start = new Date(w.start);
  w.exercises.forEach((e, i) => {
    let n = 0;
    e.sets.forEach(s => {
      rows.push([String(w.id), start, w.title || '', i + 1, e.name, e.part || '', e.section || '',
        s.warmup ? '' : ++n, !!s.warmup, blank_(s.kg), blank_(s.reps), blank_(s.sec),
        s.warmup ? '' : e1rm_(s.kg, s.reps), s.warmup ? 0 : (s.kg || 0) * (s.reps || 0), e.note || '']);
    });
  });
  return rows;
}

// 指定した workoutId の行を消す（残す行だけ書き戻す）
function removeIds_(sh, width, ids) {
  const last = sh.getLastRow();
  if (last < 2 || !ids.length) return;
  const del = {};
  ids.forEach(id => { del[String(id)] = true; });
  const rng = sh.getRange(2, 1, last - 1, width);
  const vals = rng.getValues();
  const keep = vals.filter(r => !del[String(r[0])]);
  if (keep.length === vals.length) return;
  rng.clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
}

function append_(sh, rows, width) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}

function upsert_(workouts) {
  const wo = woSheet_(), st = setSheet_();
  const ids = workouts.map(w => w.id);
  removeIds_(wo, WO_HEAD.length, ids);
  removeIds_(st, SET_HEAD.length, ids);
  workouts.sort((a, b) => a.start - b.start);
  append_(wo, workouts.map(woRow_), WO_HEAD.length);
  append_(st, [].concat.apply([], workouts.map(setRows_)), SET_HEAD.length);
}

function load_() {
  const sh = woSheet_();
  const last = sh.getLastRow();
  const workouts = [];
  if (last >= 2) {
    sh.getRange(2, WO_HEAD.length, last - 1, 1).getValues().forEach(r => {
      if (!r[0]) return;
      try { workouts.push(JSON.parse(r[0])); } catch (e) { /* 壊れた行は飛ばす */ }
    });
  }
  let config = null;
  try { const raw = cfgSheet_().getRange('A2').getValue(); config = raw ? JSON.parse(raw) : null; } catch (e) { config = null; }
  return { ok: true, app: 'kintore', workouts, config };
}

function doGet() { return json_({ ok: true, app: 'kintore' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    switch (req.action) {
      case 'load': return json_(load_());
      case 'upsert': upsert_(req.workouts || []); break;
      case 'delete':
        removeIds_(woSheet_(), WO_HEAD.length, req.ids || []);
        removeIds_(setSheet_(), SET_HEAD.length, req.ids || []);
        break;
      case 'saveConfig': cfgSheet_().getRange('A2').setValue(JSON.stringify(req.config || {})); break;
      default: return json_({ ok: false, error: 'unknown action' });
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 最初に一度だけ実行（シートの準備と、権限の承認のため） */
function setup() {
  ss_().setSpreadsheetTimeZone('Asia/Tokyo');
  woSheet_();
  setSheet_();
  cfgSheet_();
  const s1 = ss_().getSheetByName('シート1') || ss_().getSheetByName('Sheet1');
  if (s1 && ss_().getSheets().length > 1) ss_().deleteSheet(s1);
}
