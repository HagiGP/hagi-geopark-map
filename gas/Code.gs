/**
 * 萩ジオパーク サイトデータベース（Googleスプレッドシートに付けるApps Script）
 *
 * GET  ?action=data                 … 公開してよい列だけを返す（データベースのページ・地図用。地質区分・文献・つながりの一覧も）
 * GET  ?action=status&key=合言葉     … 点検ログと点検の間隔・記録者の一覧（地図の運営モード用）
 * POST {key, id, recorder, state, content, photo, uid} … 点検ログに1行追加（写真はドライブの「点検写真」フォルダへ）
 *
 * 合言葉は「プロジェクトの設定」→「スクリプト プロパティ」の KEY に入れる（コードには書かない）
 */
const SITE_SHEETS = ["ジオサイト", "文化サイト", "生態サイト", "神社", "展望地", "解説板"];
const GEO_SHEETS = ["地質区分", "文献", "つながり"];   // ジオサイトの「地質区分」列の分け方（年代・成り立ちのステージ）、地質区分ごとの文献、大地と文化・生態サイトのつながり
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
  GEO_SHEETS.forEach(name => out[name] = readSheet(name).map(r => { delete r["確認"]; return r; }));   // 「確認」はつながりの下書きの作業メモ
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

// 地質区分を入れるとき1回だけ（エディタで選んで「実行」）：「ジオサイトの地質区分」シートの値を、
// ジオサイトのシートの「地質区分」列へIDで書き写す（列が無ければメモの前に足す）。終わったら「ジオサイトの地質区分」シートは消してよい
function setupGeology() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName("ジオサイト");
  if (!ss.getSheetByName("ジオサイトの地質区分")) { Logger.log("「ジオサイトの地質区分」シートがありません"); return; }
  const map = {}; readSheet("ジオサイトの地質区分").forEach(r => map[r["ID"]] = r["地質区分"]);
  let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], col = head.indexOf("地質区分");
  if (col < 0) {
    const memo = head.indexOf("メモ");
    if (memo >= 0) { sh.insertColumnBefore(memo + 1); col = memo; } else col = head.length;
    sh.getRange(1, col + 1).setValue("地質区分");
  }
  const n = sh.getLastRow() - 1, ids = sh.getRange(2, head.indexOf("ID") + 1, n, 1).getValues();
  const vals = ids.map(r => [map[r[0]] || ""]);
  sh.getRange(2, col + 1, n, 1).setValues(vals);
  const list = ss.getSheetByName("地質区分");   // 入力は地質区分のシートから選ぶ（打ち間違い防止）
  if (list) sh.getRange(2, col + 1, Math.max(n, 1) + 200, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(list.getRange("A2:A"), true).setAllowInvalid(false).build());
  Logger.log("地質区分を入れた：" + vals.filter(v => v[0]).length + "件／" + n + "件。入らなかったID：" + ids.filter((r, i) => r[0] && !vals[i][0]).map(r => r[0]).join("、"));
  GEO_SHEETS.forEach(name => Logger.log(name + "：" + readSheet(name).length + "件"));
}

// ジオサイトの管理番号（地質体ごとの番号。例：BY-G001＝阿武火山岩（後期）の1番）を入れるとき1回だけ（エディタで選んで「実行」）：
// ジオサイトのシートの ID の右に「管理番号」の列を足して書き入れる。ID（G-001）は点検ログ・URLとのつなぎなので変えない
function setupGeoNumber() {
  const NUM = {
    "G-001": "BY-G001", "G-002": "BY-G002", "G-003": "BY-G003", "G-004": "BY-G004", "G-005": "BY-G005", "G-006": "BY-G006",
    "G-007": "BY-G007", "G-008": "BY-G008", "G-009": "BY-G009", "G-010": "BY-G010", "G-011": "BY-G011", "G-012": "BY-G013",
    "G-013": "BY-G014", "G-014": "AO-G001", "G-015": "AO-G002", "G-016": "SN-G001", "G-017": "SN-G002", "G-018": "SN-G003",
    "G-019": "SN-G004", "G-020": "SN-G005", "G-021": "YV-G001", "G-022": "KG-G001", "G-023": "KG-G002", "G-024": "KG-G003",
    "G-025": "SU-G001", "G-026": "SU-G002", "G-027": "SU-G003", "G-028": "TV-G004", "G-029": "AB-G001", "G-030": "AB-G002",
    "G-031": "AB-G003", "G-032": "AB-G005", "G-033": "AB-G006", "G-034": "AB-G007", "G-035": "AB-G008", "G-036": "AB-G009",
    "G-037": "AB-G010", "G-038": "MG-G001", "G-039": "MG-G002", "G-040": "MG-G003", "G-041": "MH-G001", "G-042": "KV-G001",
    "G-043": "KS-G001", "G-044": "KS-G002", "G-045": "AG-G001", "G-046": "HL-G001", "G-047": "ZL-G001",
  };
  const sh = SpreadsheetApp.getActive().getSheetByName("ジオサイト");
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], idCol = head.indexOf("ID");
  let col = head.indexOf("管理番号");
  if (col < 0) { sh.insertColumnAfter(idCol + 1); col = idCol + 1; sh.getRange(1, col + 1).setValue("管理番号"); }
  const n = sh.getLastRow() - 1, ids = sh.getRange(2, idCol + 1, n, 1).getValues();
  const cur = sh.getRange(2, col + 1, n, 1).getValues();
  const vals = ids.map((r, i) => [cur[i][0] || NUM[r[0]] || ""]);   // すでに入っている番号は上書きしない
  sh.getRange(2, col + 1, n, 1).setValues(vals);
  Logger.log("管理番号を入れた：" + vals.filter(v => v[0]).length + "件／" + n + "件。入らなかったID：" + ids.filter((r, i) => r[0] && !vals[i][0]).map(r => r[0]).join("、"));
}
