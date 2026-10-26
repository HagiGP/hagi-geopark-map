/* 萩ジオパーク サイトデータベース
   正本＝Googleスプレッドシート（萩ジオパークのアカウント）。Apps Script が公開してよい列だけを返す。
   直すと数分で反映。電波が無いときは前回読み込んだ分を出す。
   地図の運営モードで合言葉を入れた端末では、ジオサイト・解説板の点検の状態も出す */
const DB_URL = "https://script.google.com/macros/s/AKfycbxwAS_jguWMoqiSA_GM46Rjr3kffVqNstRD0Rd4MBJM7L_fS4PGsxtcsPgVsaYdnOPG/exec";
const KINDS = [   // 種類の並び・色（地図の印と同じ色）
  { name:"ジオサイト", color:"#e31a1c" },
  { name:"文化サイト", color:"#d78800" },
  { name:"生態サイト", color:"#2e7d4f" },
  { name:"神社",       color:"#714B34" },
  { name:"展望地",     color:"#1f78b4" },
  { name:"解説板",     color:"#b5121b" },
];
const SHOW_FIELDS = ["地区", "地域紹介", "ランク", "管理番号", "保全対象", "主要", "祭神", "由緒", "例祭日", "文化財指定", "駐車場", "現地解説",
                     "関連ジオサイト", "関連サイト", "設置者・管理者", "設置年"];   // 詳細の表に出す項目（空欄は出さない）
const ls = {
  get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
};
const $ = s=> document.querySelector(s);
const esc = s=> (s == null ? "" : String(s)).replace(/[&<>"]/g, c=> ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const st = { rows:[], kind:"", view: ls.get("hagiDbView", "card"), status:null, photos:new Set(), photoV:"", groups:[], refs:[] };

// ---- 読み込み ----
(async function load(){
  // 地図の img/sites にある写真の一覧（スプレッドシートの「写真」が空でも、名前と同じ写真があれば出す）。
  // サイトの表と並行して取りに行く（このファイルの終わりまで読み込んでから＝下の関数・定数が使えるように）
  const photos = fetch("data/site_photos.json?p=6").then(r=> r.json())   // 写真を足したら一覧を作り直し、?p= を上げる（地図の PHOTOV と同じ番号）
    .then(p=>{ st.photos = new Set(p.files || []); st.photoV = p.v ? "?p=" + p.v : ""; }).catch(()=>{});
  const data = fetch(DB_URL + "?action=data").then(r=> r.json());
  await photos;
  const cached = ls.get("hagiDbCache", null);
  if (cached) setData(cached.sheets, cached.updated, true);
  try {
    const r = await data;
    if (r.ok){ ls.set("hagiDbCache", { sheets:r.sheets, updated:r.updated }); setData(r.sheets, r.updated, false); }
  } catch(e){ if (!cached) $("#list").innerHTML = `<p class="loading">読み込めませんでした。電波の状態を確かめて、もう一度開いてください。</p>`; }
  const key = ls.get("hagiPatrolKey", "");   // 地図の運営モードで入れた合言葉
  if (key){
    try {
      const r = await fetch(DB_URL + "?action=status&key=" + encodeURIComponent(key)).then(r=> r.json());
      if (r.ok){ st.status = r; $("#fPatrol").hidden = false; render(); }
    } catch(e){}
  }
})();

function setData(sheets, updated, fromCache){
  st.rows = [];
  KINDS.forEach(k=> (sheets[k.name] || []).forEach(r=> st.rows.push({ ...r, 種類:k.name })));
  st.groups = sheets["地質区分"] || []; st.refs = sheets["文献"] || [];   // ジオサイトの地質区分（年代・成り立ちのステージ）と、地質区分ごとの文献
  $("#updated").textContent = (fromCache ? "前回の読み込み・" : "") + (updated ? new Date(updated).toLocaleString("ja-JP", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }) + " 時点" : "");
  buildFilters();
  render();
  openFromHash();
}

// ---- 絞り込み ----
function uniq(a){ return [...new Set(a.filter(Boolean))]; }
function fillSelect(sel, values, label){
  const cur = sel.value;
  sel.innerHTML = `<option value="">${label}：すべて</option>` + values.map(v=> `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
}
function prots(r){ return String(r["法的保護"] || "").split(/[、，,]/).map(s=> s.trim()).filter(Boolean); }
function buildFilters(){
  const kinds = $("#kinds");
  kinds.innerHTML = [{ name:"", label:"すべて", color:"#595857" }, ...KINDS].map(k=>{
    const n = k.name ? st.rows.filter(r=> r.種類 === k.name).length : st.rows.length;
    return `<button data-k="${esc(k.name)}" style="--kc:${k.color}" class="${k.name === st.kind ? "on" : ""}">${esc(k.label || k.name)}<small>${n}</small></button>`;
  }).join("");
  kinds.querySelectorAll("button").forEach(b=> b.onclick = ()=>{ st.kind = b.dataset.k; buildFilters(); render(); });
  const base = st.kind ? st.rows.filter(r=> r.種類 === st.kind) : st.rows;
  const CHIKU = ["萩", "川上", "田万川", "むつみ", "須佐", "旭", "福栄", "阿武", "阿東"];
  fillSelect($("#fChiku"), uniq(base.map(r=> r["地区"])).sort((a, b)=> CHIKU.indexOf(a) - CHIKU.indexOf(b)), "地区");
  fillSelect($("#fArea"), uniq(base.map(r=> r["地域紹介"])), "地域紹介");
  fillSelect($("#fRank"), uniq(base.map(r=> r["ランク"])).sort(), "ランク");
  fillSelect($("#fProt"), uniq(base.flatMap(prots)).sort((a, b)=> a.localeCompare(b, "ja")), "法的保護");
  $("#fRank").hidden = !base.some(r=> r["ランク"]);
  // 地質区分：成り立ちのステージごとにまとめ、地質区分のシートの順に並べる（その中のサイトがあるものだけ）
  const geo = $("#fGeo"), cur = geo.value, used = st.groups.filter(g=> base.some(r=> r["地質区分"] === g["地質区分"]));
  const stages = uniq(used.map(g=> g["大地の成り立ちステージ"]));
  geo.innerHTML = `<option value="">地質区分：すべて</option>` + stages.map(sg=> `<optgroup label="${esc(stageLabel(sg))}">` +
    used.filter(g=> g["大地の成り立ちステージ"] === sg).map(g=> `<option value="${esc(g["地質区分"])}"${g["地質区分"] === cur ? " selected" : ""}>${esc(geoLabel(g["地質区分"]))}（${base.filter(r=> r["地質区分"] === g["地質区分"]).length}）</option>`).join("") + `</optgroup>`).join("");
  geo.hidden = !used.length;
}
const geoLabel = s=> String(s || "").replace(/^[A-Z]+_/, "");     // 「BY_阿武火山岩（後期）」→「阿武火山岩（後期）」
const stageLabel = s=> String(s || "").replace(/^\d+_/, "");     // 「04_萩・阿武のマグマの活動」→「萩・阿武のマグマの活動」
const groupOf = r=> r["地質区分"] ? st.groups.find(g=> g["地質区分"] === r["地質区分"]) : null;
["#q", "#fChiku", "#fArea", "#fRank", "#fGeo", "#fProt", "#fPatrol", "#fPhoto"].forEach(s=> $(s).addEventListener("input", render));
document.querySelectorAll("#views button").forEach(b=> b.onclick = ()=>{ st.view = b.dataset.v; ls.set("hagiDbView", st.view); render(); });

function filtered(){
  const q = $("#q").value.trim().toLowerCase(), ch = $("#fChiku").value, ar = $("#fArea").value, rk = $("#fRank").value, ge = $("#fGeo").value,
        pr = $("#fProt").value, pa = $("#fPatrol").value, ph = $("#fPhoto").checked;
  return st.rows.filter(r=>
    (!st.kind || r.種類 === st.kind) && (!ch || r["地区"] === ch) && (!ar || r["地域紹介"] === ar) && (!rk || r["ランク"] === rk) && (!ge || r["地質区分"] === ge) &&
    (!pr || prots(r).includes(pr)) && (!ph || photoFileOf(r)) &&
    (!pa || (pa === "bad" ? patrolOf(r)?.problem : patrolOf(r)?.overdue && !patrolOf(r)?.problem)) &&
    (!q || ["名前", "ふりがな", "見出し", "説明", "保全対象", "祭神", "由緒", "ID", "管理番号", "地質区分"].some(k=> String(r[k] || "").toLowerCase().includes(q))));
}

// ---- 点検の状態（運営の端末だけ） ----
const PATROL_START = new Date("2026-10-24T00:00:00+09:00");   // 点検の数え始めの日（地図の js/patrol.js と同じ）。記録の無いサイトはこの日から数える
const parseTime = s=> s ? new Date(String(s).replace(" ", "T") + ":00+09:00") : null;
const fmtDay = d=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function patrolOf(r){
  if (!st.status || !/^[GK]-/.test(r.ID)) return null;
  const logs = st.status.logs.filter(l=> l["対象ID"] === r.ID).sort((a, b)=> parseTime(b["日時"]) - parseTime(a["日時"]));
  const rank = r.種類 === "解説板" ? "A" : r["ランク"];   // 解説板はランクA扱い（地図の js/patrol.js と同じ）
  const iv = st.status.intervals.find(x=> x["対象"] === "ジオサイト" && x["ランク"] === rank);
  const last = logs[0], due = last ? parseTime(last["日時"]) : new Date(PATROL_START);
  due.setMonth(due.getMonth() + (iv ? Number(iv["月"]) : 12));
  return { logs, last, problem: last?.["状態"] === "問題あり", overdue: Date.now() > due };
}
function patrolTag(r){
  const p = patrolOf(r); if (!p) return "";
  if (p.problem) return `<span class="ptag bad">問題あり ${fmtDay(parseTime(p.last["日時"]))}</span>`;
  if (!p.last) return `<span class="ptag ${p.overdue ? "old" : "none"}">${p.overdue ? "点検切れ（未点検）" : "未点検"}</span>`;
  return `<span class="ptag ${p.overdue ? "old" : "ok"}">${p.overdue ? "点検切れ" : "問題なし"} ${fmtDay(parseTime(p.last["日時"]))}</span>`;
}

// ---- 一覧 ----
const kindOf = name=> KINDS.find(k=> k.name === name) || { color:"#888" };
// 写真：スプレッドシートの「写真」の列、空なら名前と同じ写真（生態サイトは場所が分からないよう出さない）
const sanitizeName = s=> String(s).replace(/[\\/:*?"<>|]/g, "_").trim();   // 地図（map.js）と同じ
const photoFileOf = r=> r["写真"] || (r.種類 !== "生態サイト" && st.photos.has(sanitizeName(r["名前"] || "") + ".jpg") ? sanitizeName(r["名前"]) + ".jpg" : "");
const photoUrl = r=>{ const f = photoFileOf(r); return f ? "img/sites/" + encodeURIComponent(f) + st.photoV : ""; };
function render(){
  const rows = filtered();
  $("#count").textContent = `${rows.length}件`;
  document.querySelectorAll("#views button").forEach(b=> b.classList.toggle("on", b.dataset.v === st.view));
  const list = $("#list");
  if (!rows.length){ list.innerHTML = `<p class="loading">当てはまるものがありません</p>`; return; }
  if (st.view === "table"){
    const pcol = st.status ? "<th>点検</th>" : "", gcol = rows.some(r=> r["地質区分"]);
    list.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>種類</th><th>名前</th><th>地区</th><th>ランク</th>${gcol ? "<th>地質区分</th>" : ""}<th>法的保護</th><th>見出し</th>${pcol}</tr></thead><tbody>`+
      rows.map(r=> `<tr data-id="${esc(r.ID)}"><td class="mono">${esc(r.ID)}</td><td><span class="kdot" style="background:${kindOf(r.種類).color}"></span>${esc(r.種類)}</td>`+
        `<td class="nm">${esc(r["名前"])}</td><td>${esc(r["地区"])}</td><td>${esc(r["ランク"])}</td>${gcol ? `<td>${esc(geoLabel(r["地質区分"]))}</td>` : ""}<td>${prots(r).map(esc).join("<br>")}</td>`+
        `<td class="ld">${esc(r["見出し"])}</td>${st.status ? `<td>${patrolTag(r)}</td>` : ""}</tr>`).join("")+
      `</tbody></table></div>`;
  } else {
    list.innerHTML = `<div class="cards">`+ rows.map(r=>{
      const k = kindOf(r.種類), ph = photoUrl(r);
      return `<article class="card" data-id="${esc(r.ID)}" style="--kc:${k.color}">`+
        (ph ? `<img src="${ph}" alt="" loading="lazy" onerror="this.remove()">` : `<div class="noimg">${esc(r.種類)}</div>`)+
        `<div class="cb"><div class="ck"><span>${esc(r.種類)}</span>${r["ランク"] ? `<b>${esc(r["ランク"])}</b>` : ""}${r["地区"] ? `<i>${esc(r["地区"])}</i>` : ""}</div>`+
        `<h3>${esc(r["名前"])}</h3>${r["地質区分"] ? `<div class="cg">${esc(geoLabel(r["地質区分"]))}</div>` : ""}${r["見出し"] ? `<p>${esc(r["見出し"])}</p>` : ""}`+
        `<div class="cp">${prots(r).map(s=> `<span>${esc(s)}</span>`).join("")}${patrolTag(r)}</div></div></article>`;
    }).join("") + `</div>`;
  }
  list.querySelectorAll("[data-id]").forEach(el=> el.onclick = ()=> { location.hash = el.dataset.id; });
}

// ---- 詳細（#G-001 のようにURLで開ける） ----
let miniMap = null;
window.addEventListener("hashchange", openFromHash);
$("#detail").addEventListener("click", e=>{ if (e.target.id === "detail") closeDetail(); });
$(".dt-close").onclick = closeDetail;
document.addEventListener("keydown", e=>{ if (e.key === "Escape") closeDetail(); });
function closeDetail(){ if (location.hash) history.replaceState(null, "", location.pathname + location.search); $("#detail").hidden = true; }
function openFromHash(){
  const id = decodeURIComponent(location.hash.slice(1));
  const r = st.rows.find(x=> x.ID === id);
  if (!r){ $("#detail").hidden = true; return; }
  const k = kindOf(r.種類), ph = photoUrl(r), hasLL = r["緯度"] !== "" && r["経度"] !== "" && r["緯度"] != null;
  let h = `<div class="dk" style="--kc:${k.color}"><span>${esc(r.種類)}</span><code>${esc(r.ID)}</code></div>`;
  h += `<h2>${esc(r["名前"])}</h2>`;
  if (r["ふりがな"]) h += `<div class="furi">${esc(r["ふりがな"])}</div>`;
  if (prots(r).length) h += `<div class="cp">${prots(r).map(s=> `<span>${esc(s)}</span>`).join("")}</div>`;
  if (r["見出し"]) h += `<p class="lead">${esc(r["見出し"])}</p>`;
  if (ph) h += `<img class="dphoto" src="${ph}" alt="" onerror="this.remove()">`;
  const acts = [];
  if (r["地図に出す"] === "Y" && r.種類 !== "生態サイト") acts.push(`<a href="./?site=${encodeURIComponent(r["名前"])}">🗺 地図で見る</a>`);
  if (hasLL && r.種類 !== "生態サイト"){
    const dest = (r["経路緯度"] && r["経路経度"]) ? `${r["経路緯度"]},${r["経路経度"]}` : `${r["緯度"]},${r["経度"]}`;
    acts.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener">🧭 経路</a>`);
  }
  if (acts.length) h += `<div class="acts">${acts.join("")}</div>`;
  if (r["説明"]) h += `<p class="desc">${esc(r["説明"])}</p>`;
  const rel = String(r["関連ジオサイト"] || "").split(/[、，,]/).map(s=> s.trim()).filter(Boolean);
  const fields = SHOW_FIELDS.filter(f=> r[f] !== "" && r[f] != null && f !== "関連ジオサイト");
  const g = groupOf(r), geoRows = r["地質区分"] ? [["地質区分", geoLabel(r["地質区分"])], ["年代", g?.["年代"]], ["大地の成り立ち", stageLabel(g?.["大地の成り立ちステージ"])]].filter(x=> x[1]) : [];
  const rowsF = fields.map(f=> [f, r[f]]).concat(geoRows);
  if (rowsF.length) h += `<table class="fields">${rowsF.map(([f, v])=> `<tr><th>${esc(f)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
  if (rel.length) h += `<div class="sub">関連ジオサイト</div><ul class="near">${rel.map(id=>{ const x = st.rows.find(y=> y.ID === id); return x ? nearItem(x) : `<li>${esc(id)}</li>`; }).join("")}</ul>`;
  if (r.種類 === "生態サイト") h += `<p class="note">生息地を守るため、位置は約1km単位にぼかしています${hasLL ? "" : "（このサイトは位置を出していません）"}。</p>`;
  if (hasLL) h += `<div id="miniMap"></div>`;
  // 点検（運営の端末だけ）
  const p = patrolOf(r);
  if (p){
    h += `<div class="sub">点検の記録</div>`;
    h += p.logs.length ? `<ul class="plog">${p.logs.slice(0, 10).map(l=> `<li class="${l["状態"] === "問題あり" ? "bad" : "ok"}"><b>${esc(String(l["日時"]).slice(0, 10))}</b> ${esc(l["記録者"])} <span>${esc(l["状態"])}</span>`+
      (l["内容"] ? `<div>${esc(l["内容"])}</div>` : "") + (l["写真"] ? `<a href="${esc(l["写真"])}" target="_blank" rel="noopener">📷 写真</a>` : "") + `</li>`).join("")}</ul>`
      : `<p class="note">まだ記録がありません</p>`;
  }
  // 近くのサイト（3km以内・近い順）
  if (hasLL){
    const near = st.rows.filter(x=> x !== r && x["緯度"] !== "" && x["緯度"] != null && x.種類 !== "生態サイト")
      .map(x=> ({ x, d: dist(r, x) })).filter(o=> o.d < 3000).sort((a, b)=> a.d - b.d).slice(0, 8);
    if (near.length) h += `<div class="sub">近くのサイト</div><ul class="near">${near.map(o=> nearItem(o.x, o.d)).join("")}</ul>`;
  }
  // 文献：この地質区分（地質体）に関する文献（古い順）
  const refs = r["地質区分"] ? st.refs.filter(x=> x["地質区分"] === r["地質区分"]).sort((a, b)=> (Number(a["出版年"]) || 9999) - (Number(b["出版年"]) || 9999)) : [];
  if (refs.length) h += `<div class="sub">関連する文献<small>（${esc(geoLabel(r["地質区分"]))}・${refs.length}件）</small></div><ol class="refs">${refs.map(x=>
    `<li>${esc(x["著者名"] || x["Author"])}（${esc(x["出版年"])}）${esc(x["タイトル"])}${x["雑誌・出版社名"] ? `．<i>${esc(x["雑誌・出版社名"])}</i>` : ""}</li>`).join("")}</ol>`;
  $("#detail .dt-body").innerHTML = h;
  $("#detail").hidden = false;
  $("#detail .dt-card").scrollTop = 0;
  if (hasLL) setTimeout(()=> showMini(r), 0);
}
function nearItem(x, d){
  return `<li><a href="#${esc(x.ID)}"><span class="kdot" style="background:${kindOf(x.種類).color}"></span>${esc(x["名前"])}`+
    `<small>${esc(x.種類)}${d != null ? "・" + (d < 1000 ? Math.round(d / 10) * 10 + "m" : (d / 1000).toFixed(1) + "km") : ""}</small></a></li>`;
}
function dist(a, b){
  const R = 6371000, t = Math.PI / 180, la1 = a["緯度"] * t, la2 = b["緯度"] * t;
  const x = (b["経度"] - a["経度"]) * t * Math.cos((la1 + la2) / 2), y = la2 - la1;
  return R * Math.sqrt(x * x + y * y);
}
function showMini(r){
  if (miniMap){ miniMap.remove(); miniMap = null; }
  const el = document.getElementById("miniMap"); if (!el) return;
  const eco = r.種類 === "生態サイト";
  miniMap = L.map(el, { zoomControl:true, attributionControl:true, scrollWheelZoom:false }).setView([r["緯度"], r["経度"]], eco ? 13 : 15);
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { maxZoom:18, attribution:"地理院タイル" }).addTo(miniMap);
  if (eco) L.circle([r["緯度"], r["経度"]], { radius:1000, color:kindOf(r.種類).color, weight:2, fillOpacity:.1 }).addTo(miniMap);   // ぼかした範囲
  else L.circleMarker([r["緯度"], r["経度"]], { radius:8, color:"#fff", weight:2, fillColor:kindOf(r.種類).color, fillOpacity:1 }).addTo(miniMap);
}

// ---- CSV（今の絞り込みのまま。Excelで開けるようBOM付き） ----
$("#csv").onclick = ()=>{
  const rows = filtered(); if (!rows.length) return;
  const cols = uniq(["ID", "種類", ...rows.flatMap(r=> Object.keys(r))]);
  const cell = v=> { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = "﻿" + [cols.join(","), ...rows.map(r=> cols.map(c=> cell(r[c])).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type:"text/csv" }));
  a.download = `萩ジオパーク_${st.kind || "サイト"}_${fmtDay(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
};
