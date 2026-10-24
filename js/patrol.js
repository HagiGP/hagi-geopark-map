/* 萩ジオパーク マップ — パトロール（運営モードのみ）
   ジオサイト・解説板の状態を現地で記録し（Googleスプレッドシートの「点検ログ」へ）、
   問題あり・点検切れを地図の印と「パトロール」タブで知らせる。
   記録は電波が無くても端末に貯めておき、つながったら送る。合言葉は端末に保存（初回だけ入力） */
const PATROL_URL = "https://script.google.com/macros/s/AKfycbxwAS_jguWMoqiSA_GM46Rjr3kffVqNstRD0Rd4MBJM7L_fS4PGsxtcsPgVsaYdnOPG/exec";
const PT_CATS = { "ジオサイト":"ジオサイト", "解説板":"解説板" };   // 地図の種類 → スプレッドシートのシート名
const LS = { key:"hagiPatrolKey", who:"hagiPatrolRecorder", queue:"hagiPatrolQueue", data:"hagiPatrolSites", status:"hagiPatrolStatus" };
const ls = {
  get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } },
  del(k){ try { localStorage.removeItem(k); } catch(e){} },
};
const pt = { rows:{}, status: ls.get(LS.status, null), byMarker:new Map(), layer:null, ready:false };

if (staff) initPatrol();

function initPatrol(){
  // パトロールのタブとメニューのボタン（運営モードのときだけ）
  TAB_TITLES.patrol = "パトロール";
  const btn = document.createElement("button");
  btn.className = "dock-btn"; btn.dataset.tab = "patrol"; btn.setAttribute("aria-controls", "panel");
  btn.innerHTML = `<span>パト</span><span>ロール</span><i class="pt-count" hidden></i>`;
  btn.onclick = ()=> openTab === "patrol" ? closeTab() : showTab("patrol");
  document.getElementById("dock").appendChild(btn);
  const sec = document.createElement("section"); sec.className = "tab"; sec.dataset.tab = "patrol";
  sec.innerHTML = `<div id="patrolBox"><p class="loading">読み込み中…</p></div>`;
  document.querySelector("#panel .panel-body").appendChild(sec);

  // 印（問題あり・点検切れ）は見どころの印より手前
  map.createPane("pane-patrol"); map.getPane("pane-patrol").style.zIndex = 690;
  pt.layer = L.layerGroup().addTo(map);
  map.on("moveend zoomend", syncBadges);

  // 詳細を開いたら、点検の欄を足す（map.js の openSite のあとに）
  const baseOpenSite = openSite;
  openSite = function(o, opts){ baseOpenSite(o, opts); decorateSite(o); };

  window.addEventListener("online", ()=>{ flushQueue(); loadStatus(); });
  // 地図の印が出そろってから、スプレッドシートのIDと結びつける
  const wait = setInterval(()=>{ if (allMarkers.length){ clearInterval(wait); start(); } }, 300);
}

async function start(){
  const cached = ls.get(LS.data, null);
  if (cached) bindIds(cached);
  try {
    const r = await fetch(PATROL_URL + "?action=data").then(r=> r.json());
    if (r.ok){ ls.set(LS.data, r.sheets); bindIds(r.sheets); }
  } catch(e){ /* 電波が無ければ前回の分で */ }
  pt.ready = true;
  render();
  await flushQueue();
  loadStatus();
}

// 地図の印（名前）→ スプレッドシートの行（ID）。同じ名前が2つある解説板は近い方
function bindIds(sheets){
  pt.byMarker.clear(); pt.rows = {};
  Object.entries(PT_CATS).forEach(([cat, sheet])=>{
    const rows = sheets[sheet] || [];
    rows.forEach(r=> pt.rows[r.ID] = { ...r, sheet });
    allMarkers.filter(o=> o.cat === cat).forEach(o=>{
      const ll = o.marker.getLatLng();
      const d = r=> ll.distanceTo([r["緯度"], r["経度"]]);
      const same = rows.filter(r=> r["名前"] === o.name);
      const hit = (same.length ? same : rows.filter(r=> d(r) < 50)).sort((a, b)=> d(a) - d(b))[0];
      if (hit) pt.byMarker.set(o, hit.ID);
    });
  });
}

async function loadStatus(){
  const key = ls.get(LS.key, "");
  if (!key){ render(); return; }
  try {
    const r = await fetch(PATROL_URL + "?action=status&key=" + encodeURIComponent(key)).then(r=> r.json());
    if (r.ok){ pt.status = { ...r, fetched: Date.now() }; ls.set(LS.status, pt.status); }
    else if (/合言葉/.test(r.error || "")){ ls.del(LS.key); toast("合言葉が違います。もう一度入れてください"); }
  } catch(e){ /* 電波が無ければ前回の分で */ }
  render();
}

// ---- 状態の判定 ----
const parseTime = s=> s ? new Date(String(s).replace(" ", "T") + (String(s).length <= 16 ? ":00" : "") + "+09:00") : null;
const fmtDay = d=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function logsOf(id){
  const sent = (pt.status?.logs || []).filter(l=> l["対象ID"] === id)
    .map(l=> ({ time:parseTime(l["日時"]), who:l["記録者"], state:l["状態"], text:l["内容"], photo:l["写真"] }));
  const queued = ls.get(LS.queue, []).filter(q=> q.id === id)
    .map(q=> ({ time:new Date(q.time), who:q.recorder, state:q.state, text:q.content, photo:q.photo ? "（写真あり）" : "", pending:true }));
  return sent.concat(queued).sort((a, b)=> b.time - a.time);
}
function intervalMonths(id){
  const r = pt.rows[id]; if (!r) return 12;
  const iv = pt.status?.intervals || [];
  const hit = r.sheet === "解説板" ? iv.find(x=> x["対象"] === "解説板") : iv.find(x=> x["対象"] === "ジオサイト" && x["ランク"] === r["ランク"]);
  return hit ? Number(hit["月"]) : 12;
}
// 点検の数え始めの日。まだ記録の無いサイトは、この日に点検したものとして期限を数える（パトロールを始めた日）
const PATROL_START = new Date("2026-10-24T00:00:00+09:00");
function stateOf(id){
  const logs = logsOf(id), last = logs[0] || null;
  const due = new Date(last ? last.time : PATROL_START);
  due.setMonth(due.getMonth() + intervalMonths(id));
  const over = Math.floor((Date.now() - due) / 864e5);
  return { last, logs, problem: last?.state === "問題あり", overdue: over > 0, overDays: over };
}

// ---- 地図の印 ----
function syncBadges(){
  if (!pt.layer) return;
  pt.layer.clearLayers();
  if (!pt.status || wideMode || document.body.classList.contains("touring")) return;
  pt.byMarker.forEach((id, o)=>{
    const s = stateOf(id);
    if (!s.problem && !s.overdue) return;
    const cls = s.problem ? "pt-bad" : "pt-old";
    const m = L.marker(o.marker.getLatLng(), { pane:"pane-patrol", keyboard:false, title:o.name,
      icon: L.divIcon({ className:"", iconSize:[18,18], iconAnchor:[-1,19], html:`<div class="pt-badge ${cls}">${s.problem ? "!" : "⏱"}</div>` }) });
    m.on("click", ()=> openSite(o));
    pt.layer.addLayer(m);
  });
}

// ---- パトロールのタブ ----
function render(){
  syncBadges();
  const box = document.getElementById("patrolBox"); if (!box) return;
  const key = ls.get(LS.key, ""), queue = ls.get(LS.queue, []);
  let h = "";
  if (!key){
    h += `<div class="pt-keybox"><p>点検の状態を読み込むには、事務局の合言葉を入れてください（この端末に保存されます）。</p>`+
         `<input type="password" class="pt-key" placeholder="合言葉" autocomplete="off"><button class="pt-keysave">保存</button></div>`;
  }
  const items = [...pt.byMarker.entries()].map(([o, id])=> ({ o, id, s: stateOf(id) }));
  const bad = items.filter(x=> x.s.problem).sort((a, b)=> b.s.last.time - a.s.last.time);
  const old = items.filter(x=> !x.s.problem && x.s.overdue)
    .sort((a, b)=> b.s.overDays - a.s.overDays || a.o.name.localeCompare(b.o.name, "ja"));
  const info = pt.status ? `${fmtDay(new Date(pt.status.fetched))} ${new Date(pt.status.fetched).toTimeString().slice(0,5)} に取得` : "まだ読み込んでいません";
  h += `<div class="pt-sync"><span>${esc(info)}${queue.length ? `・<b>未送信 ${queue.length}件</b>` : ""}</span><button class="pt-reload">↻ 更新</button></div>`;
  if (pt.status){
    h += `<div class="pt-head pt-head-bad">問題あり（${bad.length}）</div>`;
    h += bad.length ? `<ul class="pt-list">${bad.map(x=> ptItem(x)).join("")}</ul>` : `<p class="pt-none">ありません</p>`;
    h += `<div class="pt-head pt-head-old">点検切れ（${old.length}）</div>`;
    h += old.length ? `<ul class="pt-list">${old.map(x=> ptItem(x)).join("")}</ul>` : `<p class="pt-none">ありません</p>`;
    h += `<p class="pt-note">点検の間隔：スプレッドシートの「一覧」シートで変えられます。印：<span class="pt-badge pt-bad sm">!</span> 問題あり <span class="pt-badge pt-old sm">⏱</span> 点検切れ</p>`;
  }
  box.innerHTML = h;
  box.querySelector(".pt-reload").onclick = async ()=>{ await flushQueue(); loadStatus(); };
  const ks = box.querySelector(".pt-keysave");
  if (ks) ks.onclick = ()=>{ const v = box.querySelector(".pt-key").value.trim(); if (!v) return; ls.set(LS.key, v); loadStatus(); flushQueue(); };
  box.querySelectorAll(".pt-item").forEach(li=>{
    const o = items.find(x=> x.id === li.dataset.id)?.o;
    if (o) li.onclick = ()=> flyToSite(o);
  });
  // メニューのボタンに件数（問題あり＋点検切れ）
  const cnt = document.querySelector('.dock-btn[data-tab="patrol"] .pt-count');
  if (cnt){ const n = pt.status ? bad.length + old.length : 0; cnt.hidden = !n; cnt.textContent = n > 99 ? "99+" : n; cnt.classList.toggle("bad", bad.length > 0); }
}
function ptItem({ o, id, s }){
  let sub;
  if (s.problem) sub = `${fmtDay(s.last.time)} ${esc(s.last.who || "")}：${esc((s.last.text || "").split("\n")[0] || "（内容なし）")}`;
  else sub = `${s.overDays}日超過（${s.last ? "最終 " + fmtDay(s.last.time) : "未点検"}）`;
  const dot = `<span class="poi-dot" style="background:${SITE_CATS[o.cat].fill}"></span>`;
  return `<li class="pt-item" data-id="${esc(id)}">${dot}<span class="pt-name">${esc(o.name)}<small>${sub}${s.last?.pending ? "・未送信" : ""}</small></span></li>`;
}

// ---- 詳細の点検の欄 ----
function decorateSite(o){
  const id = pt.byMarker.get(o); if (!id) return;
  const box = document.getElementById("siteDetail");
  const s = stateOf(id);
  let h = `<div class="pt-site"><div class="pt-site-head">点検<span class="pt-id">${esc(id)}・間隔${intervalMonths(id)}か月</span></div>`;
  if (!pt.status && !ls.get(LS.queue, []).some(q=> q.id === id)) h += `<p class="pt-none">状態はまだ読み込んでいません（パトロールのタブで合言葉を入れてください）</p>`;
  else if (!s.last) h += `<p class="pt-none">まだ記録がありません</p>`;
  else h += `<ul class="pt-log">${s.logs.slice(0, 5).map(l=>
      `<li class="${l.state === "問題あり" ? "bad" : "ok"}"><b>${fmtDay(l.time)}</b> ${esc(l.who || "")} <span class="pt-state">${esc(l.state)}</span>${l.pending ? `<span class="pt-pend">未送信</span>` : ""}`+
      (l.text ? `<div class="pt-text">${esc(l.text)}</div>` : "")+
      (l.photo && /^https?:/.test(l.photo) ? `<a href="${esc(l.photo)}" target="_blank" rel="noopener">📷 写真</a>` : "")+`</li>`).join("")}</ul>`;
  h += `<button class="pt-record">状態を記録する</button></div>`;
  box.insertAdjacentHTML("beforeend", h);
  box.querySelector(".pt-record").onclick = ()=> recordForm(o, id);
}

// ---- 記録の入力 ----
function recordForm(o, id){
  const old = document.querySelector(".qr-modal"); if (old) old.remove();
  const who = ls.get(LS.who, ""), key = ls.get(LS.key, "");
  const names = [...new Set([...(pt.status?.recorders || []), who].filter(Boolean))];
  const m = document.createElement("div"); m.className = "qr-modal";
  m.innerHTML =
    `<div class="qr-card pt-form">`+
    `<button class="qr-close" aria-label="閉じる">×</button>`+
    `<div class="qr-ttl">状態を記録（${esc(id)}）</div><div class="qr-name">${esc(o.name)}</div>`+
    (key ? "" : `<label class="pt-f">合言葉<input type="password" class="pt-key" autocomplete="off"></label>`)+
    `<label class="pt-f">記録者<input class="pt-who" list="ptWhoList" value="${esc(who)}" placeholder="名前"><datalist id="ptWhoList">${names.map(n=> `<option value="${esc(n)}">`).join("")}</datalist></label>`+
    `<div class="pt-states"><button data-v="問題なし" class="ok">問題なし</button><button data-v="問題あり" class="bad">問題あり</button></div>`+
    `<div class="pt-more" hidden>`+
      `<label class="pt-f">内容<textarea class="pt-text-in" rows="4" placeholder="どんな問題か（落石・倒木・看板の破損など）"></textarea></label>`+
      `<label class="ph-drop pt-photo"><span>写真を添える（任意）</span><input type="file" accept="image/*" hidden></label>`+
    `</div>`+
    `<div class="qr-actions"><button class="ph-save" disabled>記録する</button></div>`+
    `</div>`;
  document.body.appendChild(m);
  const close = ()=> m.remove();
  m.querySelector(".qr-close").onclick = close;
  m.addEventListener("click", e=>{ if (e.target === m) close(); });
  let state = "", photo = "";
  const save = m.querySelector(".ph-save"), more = m.querySelector(".pt-more");
  m.querySelectorAll(".pt-states button").forEach(b=> b.onclick = ()=>{
    state = b.dataset.v;
    m.querySelectorAll(".pt-states button").forEach(x=> x.classList.toggle("on", x === b));
    more.hidden = state !== "問題あり"; save.disabled = false;
  });
  const drop = m.querySelector(".pt-photo"), input = drop.querySelector("input");
  input.addEventListener("change", ()=>{
    const f = input.files[0]; if (!f) return;
    resizePhoto(f, 1280, blob=>{   // 長辺1280px程度に縮めてから送る（1枚200KB前後）
      const fr = new FileReader();
      fr.onload = ()=>{ photo = fr.result; drop.style.backgroundImage = `url(${photo})`; drop.classList.add("has-img"); };
      fr.readAsDataURL(blob);
    });
  });
  save.onclick = async ()=>{
    const k = m.querySelector(".pt-key"); if (k){ if (!k.value.trim()){ toast("合言葉を入れてください"); return; } ls.set(LS.key, k.value.trim()); }
    const name = m.querySelector(".pt-who").value.trim(); if (!name){ toast("記録者を入れてください"); return; }
    const content = state === "問題あり" ? m.querySelector(".pt-text-in").value.trim() : "";
    if (state === "問題あり" && !content){ toast("問題の内容を書いてください"); return; }
    ls.set(LS.who, name);
    const q = ls.get(LS.queue, []);
    q.push({ id, recorder:name, state, content, photo: state === "問題あり" ? photo : "", time: new Date().toISOString(),
             uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) });
    if (!ls.set(LS.queue, q)){ q[q.length - 1].photo = ""; ls.set(LS.queue, q); toast("端末の容量が足りないため、写真は保存できませんでした"); }
    close();
    openSite(o, { pan:false });   // 未送信の記録として、すぐ詳細に出す
    const r = await flushQueue();
    if (r === "ok") toast("記録しました");
    else if (r === "offline") toast("電波がつながったら送ります（端末に保存しました）");   // 合言葉違い・送信エラーは flushQueue が知らせる
    loadStatus();
  };
}

// 貯めておいた記録を順に送る。結果："ok"（全部送れた）／"offline"（つながらない）／"key"（合言葉違い）／"error"
let flushing = false;
async function flushQueue(){
  if (flushing) return "offline";
  const key = ls.get(LS.key, ""); let q = ls.get(LS.queue, []);
  if (!q.length) return "ok";
  if (!key){ render(); return "key"; }
  if (!navigator.onLine){ render(); return "offline"; }
  flushing = true;
  let res = "ok";
  try {
    for (const item of q.slice()){
      let r;
      try {
        r = await fetch(PATROL_URL, { method:"POST", body: JSON.stringify({ ...item, key }) }).then(r=> r.json());
      } catch(e){ res = "offline"; break; }   // つながらない → 次の機会に
      if (r.ok){ q = q.filter(x=> x.uid !== item.uid); ls.set(LS.queue, q); }
      else if (/合言葉/.test(r.error || "")){ ls.del(LS.key); toast("合言葉が違います。パトロールのタブで入れ直してください（記録は端末に残っています）"); res = "key"; break; }
      else { toast("送れませんでした：" + (r.error || "")); res = "error"; break; }
    }
  } finally { flushing = false; }
  render();
  return res;
}
