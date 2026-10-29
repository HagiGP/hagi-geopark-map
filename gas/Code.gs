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
  if (["問題なし", "問題あり", "対応中", "対応済み"].indexOf(d.state) < 0) return json({ ok: false, error: "状態は「問題なし」「問題あり」「対応中」「対応済み」のどれか" });
  const name = siteName(d.id);
  if (!name) return json({ ok: false, error: "対象IDが見つかりません：" + d.id });

  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = logSheet();
    if (d.uid && recentUids(sh).indexOf(String(d.uid)) >= 0) return json({ ok: true, duplicate: true });   // 電波が悪くて同じ記録を2度送ったとき
    let photoUrl = "";
    if (d.photo && d.state !== "問題なし") {   // 問題・対応の写真
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
function siteName(id) {   // 点検の対象：ジオサイトか解説板
  const r = readSheet("ジオサイト").concat(readSheet("解説板")).find(x => x["ID"] === id); return r ? r["名前"] : "";
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

// ---- IDを管理番号にそろえる（1回だけ。エディタで「migrateIds」を選んで「実行」） ----
// 管理番号の頭の記号＝つながる地質体（例：BY-G001＝阿武火山岩（後期）のジオサイト、BY-C017＝同じ地質体とつながる文化サイト、OT＝複数の地質体）。
// ジオサイト・文化サイト・生態サイトの「ID」を管理番号に置き換え、「管理番号」の列は消す。点検ログの「対象ID」、つながりの「大地」「相手」、
// 文化サイトの「関連ジオサイト」も新しいIDに書き換える。ジオサイトには文化サイトと同じ「駐車場」「現地解説」の列を足す（現地解説は下書き、駐車場は空欄）
const GEO_NUM = {
  "G-001": "BY-G001", "G-002": "BY-G002", "G-003": "BY-G003", "G-004": "BY-G004", "G-005": "BY-G005", "G-006": "BY-G006",
  "G-007": "BY-G007", "G-008": "BY-G008", "G-009": "BY-G009", "G-010": "BY-G010", "G-011": "BY-G011", "G-012": "BY-G013",
  "G-013": "BY-G014", "G-014": "AO-G001", "G-015": "AO-G002", "G-016": "SN-G001", "G-017": "SN-G002", "G-018": "SN-G003",
  "G-019": "SN-G004", "G-020": "SN-G005", "G-021": "YV-G001", "G-022": "KG-G001", "G-023": "KG-G002", "G-024": "KG-G003",
  "G-025": "SU-G001", "G-026": "SU-G002", "G-027": "SU-G003", "G-028": "TV-G004", "G-029": "AB-G001", "G-030": "AB-G002",
  "G-031": "AB-G003", "G-032": "AB-G005", "G-033": "AB-G006", "G-034": "AB-G007", "G-035": "AB-G008", "G-036": "AB-G009",
  "G-037": "AB-G010", "G-038": "MG-G001", "G-039": "MG-G002", "G-040": "MG-G003", "G-041": "MH-G001", "G-042": "KV-G001",
  "G-043": "KS-G001", "G-044": "KS-G002", "G-045": "AG-G001", "G-046": "HL-G001", "G-047": "ZL-G001",
};
const CULT_NUM = {   // 2018年のサイト一覧・写真のファイル名から。番号の無かった7件（OT-C015・AB-C002〜C004・BY-C019・AO-C003・SN-C005）は新しく付けた番号
  "C-001": "OT-C013", "C-002": "OT-C011", "C-003": "OT-C007", "C-004": "OT-C002", "C-005": "OT-C003", "C-006": "OT-C005",
  "C-007": "OT-C008", "C-008": "OT-C015", "C-009": "BY-C017", "C-010": "BY-C018", "C-011": "BY-C002", "C-012": "BY-C001",
  "C-013": "BY-C009", "C-014": "BY-C007", "C-015": "BY-C008", "C-016": "OT-C014", "C-017": "AB-C002", "C-018": "MG-C002",
  "C-019": "KG-C004", "C-020": "BY-C005", "C-021": "BY-C016", "C-022": "BY-C006", "C-023": "BY-C019", "C-024": "BY-C015",
  "C-026": "OT-C012", "C-027": "OT-C010", "C-028": "NS-C001", "C-029": "AO-C001", "C-030": "AO-C002", "C-031": "AO-C003",
  "C-032": "AB-C003", "C-033": "AB-C001", "C-034": "AB-C004", "C-035": "HL-B002", "C-038": "MG-C003", "C-039": "SN-C004",
  "C-040": "SN-C003", "C-041": "SN-C005", "C-042": "SN-C001",
};
const GEO_KAISETSU = {   // 現地解説（解説板）の有無の下書き：近く（300m以内）に解説板があるか、2018年の一覧で解説板あり
  "BY-G001": "Y", "BY-G002": "Y", "BY-G003": "Y", "BY-G004": "Y", "BY-G005": "Y", "BY-G006": "Y", "BY-G007": "Y", "BY-G008": "Y",
  "BY-G009": "Y", "BY-G010": "N", "BY-G011": "N", "BY-G013": "N", "BY-G014": "N", "AO-G001": "N", "AO-G002": "Y", "SN-G001": "N",
  "SN-G002": "N", "SN-G003": "N", "SN-G004": "N", "SN-G005": "N", "YV-G001": "N", "KG-G001": "Y", "KG-G002": "Y", "KG-G003": "N",
  "SU-G001": "Y", "SU-G002": "Y", "SU-G003": "N", "TV-G004": "N", "AB-G001": "N", "AB-G002": "N", "AB-G003": "N", "AB-G005": "N",
  "AB-G006": "N", "AB-G007": "N", "AB-G008": "N", "AB-G009": "N", "AB-G010": "N", "MG-G001": "N", "MG-G002": "N", "MG-G003": "N",
  "MH-G001": "N", "KV-G001": "N", "KS-G001": "N", "KS-G002": "N", "AG-G001": "N", "HL-G001": "N", "ZL-G001": "N",
};
function migrateIds() {
  const ss = SpreadsheetApp.getActive(), map = {};
  [["ジオサイト", GEO_NUM], ["文化サイト", CULT_NUM], ["生態サイト", {}]].forEach(([name, table]) => {
    const sh = ss.getSheetByName(name), v = sh.getDataRange().getValues(), head = v[0];
    const idc = head.indexOf("ID"), nc = head.indexOf("管理番号");
    for (let r = 1; r < v.length; r++) {
      const old = v[r][idc]; if (!old) continue;
      const nu = (nc >= 0 && v[r][nc]) || table[old] || "";
      if (nu && nu !== old) { map[old] = nu; sh.getRange(r + 1, idc + 1).setValue(nu); }
    }
    if (nc >= 0) sh.deleteColumn(nc + 1);
    Logger.log(name + "：IDを管理番号にした " + Object.keys(map).filter(k => v.some(row => row[idc] === k)).length + "件");
  });
  const swap = s => String(s).split(/([、，,]\s*)/).map(t => map[t.trim()] || t).join("");   // 「、」区切りの各IDを置き換える
  [["点検ログ", ["対象ID"]], ["つながり", ["大地", "相手"]], ["文化サイト", ["関連ジオサイト"]]].forEach(([name, cols]) => {
    const sh = ss.getSheetByName(name); if (!sh || sh.getLastRow() < 2) return;
    const v = sh.getDataRange().getValues(), head = v[0];
    cols.forEach(c => {
      const j = head.indexOf(c); if (j < 0) return;
      const col = v.slice(1).map(row => [swap(row[j])]);
      sh.getRange(2, j + 1, col.length, 1).setValues(col);
    });
    Logger.log(name + "：IDを書き換えた");
  });
  // ジオサイトに「駐車場」「現地解説」（文化サイトと同じく ランク の右）
  const sh = ss.getSheetByName("ジオサイト");
  let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (head.indexOf("駐車場") < 0) {
    const rk = head.indexOf("ランク");
    sh.insertColumnsAfter(rk + 1, 2); sh.getRange(1, rk + 2, 1, 2).setValues([["駐車場", "現地解説"]]);
    const n = sh.getLastRow() - 1, ids = sh.getRange(2, head.indexOf("ID") + 1, n, 1).getValues();
    sh.getRange(2, rk + 3, n, 1).setValues(ids.map(r => [GEO_KAISETSU[r[0]] || ""]));
    const yn = SpreadsheetApp.newDataValidation().requireValueInList(["Y", "N"], true).build();
    sh.getRange(2, rk + 2, n + 200, 2).setDataValidation(yn);
    Logger.log("ジオサイトに 駐車場・現地解説 の列を足した（駐車場は空欄。Y か N を入れてください）");
  }
}

// つながりシートの見直し（2026-10-27、白井さんの確認をもとに。エディタで「updateLinks」を選んで1回「実行」）
// 相手のIDごとに「大地」「ひとこと」を書き換え、確認のメモを消す。null の行は削除する
function updateLinks() {
  const AO = "AO_青野火山岩（前期）", BY = "BY_阿武火山岩（後期）", CG = "CG_白亜紀花崗岩";
  const DELTA = "三角州に築かれた";
  const FIX = {
    "OT-C013": {},   // 萩城：そのまま
    "OT-C002": { 大地: BY + "、" + AO, ひとこと: DELTA + "港町。石材も食料も阿武火山群に支えられ、土台の三角州は青野山火山群がなければできなかったかもしれない" },
    "OT-C003": { 大地: CG + "、" + BY + "、" + AO, ひとこと: DELTA + "武家屋敷の町。上級武士の石垣は指月山の花こう岩、食料は阿武火山群に支えられ、土台の三角州は青野山火山群がなければできなかったかもしれない" },
    "OT-C005": { 大地: BY + "、" + AO, ひとこと: DELTA + "城下町。石材も食料も阿武火山群に支えられ、土台の三角州は青野山火山群がなければできなかったかもしれない" },
    "OT-C015": { 大地: "AB_阿武層群、ZL_蔵目喜石灰岩" },
    "AB-C003": null,   // 木与の棚田：つながりなし
    "OT-C012": { 大地: "ZL_蔵目喜石灰岩、" + CG + "、CH_白亜紀半深成岩、AB_阿武層群", ひとこと: "南の海のサンゴ礁の石灰岩に、白亜紀のマグマが入り込み、銅の鉱床ができた" },
    "OT-C010": { 大地: "ZL_蔵目喜石灰岩、" + CG + "、CH_白亜紀半深成岩、AB_阿武層群" },
    "BY-B005": { ひとこと: "宇生賀盆地のまわりの阿武火山群がせき止めた湖の名残の池に、ミツガシワが残る" },
    "OT-C008": { 大地: CG + "、AB_阿武層群、SN_山陰火山岩", ひとこと: "花こう岩や流紋岩が風化した粘土（大道土）や、見島の玄武岩の土を、萩焼の原料にした" },
  };
  const sh = SpreadsheetApp.getActive().getSheetByName("つながり"), v = sh.getDataRange().getValues(), head = v[0];
  const c = n => head.indexOf(n), done = [];
  for (let r = v.length - 1; r >= 1; r--) {   // 下から（行を消しても番号がずれないように）
    const id = v[r][c("相手")]; if (!(id in FIX)) continue;
    if (FIX[id] === null) { sh.deleteRow(r + 1); done.push(id + " 削除"); continue; }
    Object.entries(FIX[id]).forEach(([k, val]) => sh.getRange(r + 1, c(k) + 1).setValue(val));
    if (c("確認") >= 0) sh.getRange(r + 1, c("確認") + 1).setValue("");
    done.push(id);
  }
  Logger.log("直した行：" + done.join("、"));
}
