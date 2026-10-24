/**
 * 萩ジオパーク サイトデータベース（Googleスプレッドシートに付けるApps Script）
 *
 * GET  ?action=data                 … 公開してよい列だけを返す（データベースのページ用）
 * GET  ?action=status&key=合言葉     … 点検ログと点検の間隔・記録者の一覧（地図の運営モード用）
 * POST {key, id, recorder, state, content, photo, uid} … 点検ログに1行追加（写真はドライブの「点検写真」フォルダへ）
 *
 * 合言葉は「プロジェクトの設定」→「スクリプト プロパティ」の KEY に入れる（コードには書かない）
 */
const SITE_SHEETS = ["ジオサイト", "文化サイト", "生態サイト", "神社", "展望地", "解説板"];
const LOG_SHEET = "点検ログ";
const LOG_COLS = ["日時", "対象ID", "対象名", "記録者", "状態", "内容", "写真", "送信ID"];
const PHOTO_FOLDER = "点検写真";
const TZ = "Asia/Tokyo";

function doGet(e) {
  const p = (e && e.parameter) || {};   // エディタから直接「実行」したときは e が無い
  if (p.action === "status") {
    if (!keyOk(p.key)) return json({ ok: false, error: "合言葉が違います" });
    return json({ ok: true, logs: readLogs(), intervals: readIntervals(), recorders: readList("記録者") });
  }
  return json({ ok: true, updated: new Date().toISOString(), sheets: publicData() });
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: "送信の形式が違います" }); }
  if (!keyOk(d.key)) return json({ ok: false, error: "合言葉が違います" });
  if (["問題なし", "問題あり"].indexOf(d.state) < 0) return json({ ok: false, error: "状態は「問題なし」か「問題あり」" });
  const name = siteName(d.id);
  if (!name) return json({ ok: false, error: "対象IDが見つかりません：" + d.id });

  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = logSheet();
    if (d.uid && recentUids(sh).indexOf(String(d.uid)) >= 0) return json({ ok: true, duplicate: true });   // 電波が悪くて同じ記録を2度送ったとき
    let photoUrl = "";
    if (d.photo && d.state === "問題あり") {
      const m = String(d.photo).match(/^data:(image\/\w+);base64,(.+)$/);
      if (m) {
        const stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
        const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], `${d.id}_${stamp}.jpg`);
        photoUrl = photoFolder().createFile(blob).getUrl();
      }
    }
    const when = d.time ? new Date(d.time) : new Date();   // 電波が戻ってから送ったときは、記録した時刻を使う
    sh.appendRow([when, d.id, name, d.recorder || "", d.state, d.content || "", photoUrl, d.uid || ""]);
    return json({ ok: true });
  } finally { lock.releaseLock(); }
}

// ---- 公開してよいデータ ----
function publicData() {
  const out = {};
  SITE_SHEETS.forEach(name => {
    out[name] = readSheet(name).filter(r => {
      if (name === "生態サイト" && r["地図に出す"] === "N") return false;   // 地図に出さない生態サイトはどこにも出さない
      return true;
    }).map(r => {
      delete r["メモ"];   // メモは公開しない
      if (name === "生態サイト") {   // 生態サイトの位置はぼかす（× は出さない、○ は約1km）
        if (r["場所の公開"] === "×") { r["緯度"] = ""; r["経度"] = ""; }
        else { r["緯度"] = round2(r["緯度"]); r["経度"] = round2(r["経度"]); }
      }
      return r;
    });
  });
  return out;
}

// ---- 読み書きの部品 ----
function readSheet(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name); if (!sh) return [];
  const v = sh.getDataRange().getValues(); const head = v.shift();
  return v.filter(row => row[0] !== "").map(row => {
    const r = {}; head.forEach((h, i) => { if (h !== "") r[h] = cellValue(row[i]); }); return r;
  });
}
function readLogs() {
  return readSheet(LOG_SHEET).filter(r => r["対象ID"]).map(r => {
    delete r["送信ID"]; return r;
  });
}
function readList(col) {
  const sh = SpreadsheetApp.getActive().getSheetByName("一覧");
  const v = sh.getDataRange().getValues(); const j = v[0].indexOf(col); if (j < 0) return [];
  return v.slice(1).map(row => row[j]).filter(x => x !== "");
}
function readIntervals() {
  const sh = SpreadsheetApp.getActive().getSheetByName("一覧");
  const v = sh.getDataRange().getValues(); const j = v[0].indexOf("点検の対象"); if (j < 0) return [];
  return v.slice(1).filter(row => row[j] !== "").map(row => ({ 対象: row[j], ランク: row[j + 1], 月: Number(row[j + 2]) }));
}
function siteName(id) {
  const sheet = { G: "ジオサイト", K: "解説板" }[String(id).charAt(0)]; if (!sheet) return "";
  const r = readSheet(sheet).find(x => x["ID"] === id); return r ? r["名前"] : "";
}
function logSheet() {
  const ss = SpreadsheetApp.getActive(); let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) sh = ss.insertSheet(LOG_SHEET);
  const head = sh.getRange(1, 1, 1, LOG_COLS.length).getValues()[0];
  LOG_COLS.forEach((c, i) => { if (head[i] !== c) sh.getRange(1, i + 1).setValue(c); });   // 「送信ID」の列が無ければ足す
  return sh;
}
function recentUids(sh) {
  const n = sh.getLastRow(); if (n < 2) return [];
  const from = Math.max(2, n - 300);
  return sh.getRange(from, LOG_COLS.indexOf("送信ID") + 1, n - from + 1, 1).getValues().map(r => String(r[0]));
}
function photoFolder() {
  const parent = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents().next();   // スプレッドシートと同じフォルダの中
  const it = parent.getFoldersByName(PHOTO_FOLDER);
  return it.hasNext() ? it.next() : parent.createFolder(PHOTO_FOLDER);
}
function keyOk(k) {
  const key = PropertiesService.getScriptProperties().getProperty("KEY");
  return !!key && k === key;
}
function cellValue(x) { return x instanceof Date ? Utilities.formatDate(x, TZ, "yyyy-MM-dd HH:mm") : x; }
function round2(x) { return x === "" ? "" : Math.round(Number(x) * 100) / 100; }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// 設定の確認用（エディタで選んで「実行」）：シートが読めるか・合言葉が入っているかを表示
function checkSetup() {
  SITE_SHEETS.concat([LOG_SHEET, "一覧"]).forEach(n => Logger.log(n + "：" + (SpreadsheetApp.getActive().getSheetByName(n) ? readSheet(n).length + "件" : "シートがありません")));
  Logger.log("合言葉（KEY）：" + (PropertiesService.getScriptProperties().getProperty("KEY") ? "設定済み" : "未設定"));
  Logger.log("写真の保存先：" + photoFolder().getName());
}
