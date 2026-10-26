/* 大地と文化・生態サイトのつながり
   正本＝スプレッドシートの「つながり」シート（データベースのページと同じ Apps Script から読む。前回分は端末に残して、すぐ使う）。
   「大地」の欄はジオサイトのIDか地質区分（「、」で複数）。地質区分なら、その地質区分のジオサイトすべてとつながる。
   地図では、サイトを選んだときに関連するサイトをささやかに点滅させ、地域の解説の最後には、その地域のつながりをまとめて点滅させる */
const LINKS = { links:[], sites:{} };   // links: [{ earth:[ID or 地質区分], to:ID }]、sites: ID → { name, kind, group }
(function loadLinks(){
  try { const c = JSON.parse(localStorage.getItem("hagiLinksCache")); if (c) Object.assign(LINKS, c); } catch(e){}
  setTimeout(()=>{   // 地図の読み込みを邪魔しないよう、少し待ってから
    fetch(PATROL_URL + "?action=data").then(r=> r.json()).then(r=>{
      if (!r.ok) return;
      const sites = {}, groups = (r.sheets["地質区分"] || []).map(g=> g["地質区分"]);
      ["ジオサイト", "文化サイト", "生態サイト"].forEach(k=> (r.sheets[k] || []).forEach(x=> sites[x.ID] = { name:x["名前"], kind:k, group:x["地質区分"] || "", num:x["管理番号"] || "" }));
      const links = (r.sheets["つながり"] || []).map(l=> ({ earth:String(l["大地"] || "").split(/[、，,]/).map(s=> s.trim()).filter(Boolean), to:l["相手"] }));
      // 管理番号の頭の記号（BY、AO…）＝つながる地質体（花こう岩は MG・MH。OT は複数の地質体なので「つながり」シートだけ）。データベースのページと同じ
      const ALIAS = { MG:"CG", MH:"CH" };
      Object.entries(sites).forEach(([id, s])=>{
        const c = s.num.split("-")[0]; if (s.kind === "ジオサイト" || !c || c === "OT") return;
        const g = groups.find(x=> x.startsWith((ALIAS[c] || c) + "_")); if (!g) return;
        const own = links.filter(l=> l.to === id);
        if (!own.some(l=> l.earth.some(t=> t === g || sites[t]?.group === g))) links.push({ earth:[g], to:id });
      });
      Object.assign(LINKS, { links, sites });
      try { localStorage.setItem("hagiLinksCache", JSON.stringify({ links, sites })); } catch(e){}
    }).catch(()=>{});
  }, 2500);
})();

const geoIdsOf = t=> Object.keys(LINKS.sites).filter(g=> LINKS.sites[g].kind === "ジオサイト" && (g === t || LINKS.sites[g].group === t));
const siteIdOf = name=> Object.keys(LINKS.sites).find(id=> LINKS.sites[id].name === name);
// あるサイトと関連するサイトの名前：ジオサイトなら同じ地質区分のジオサイトと、つながる文化・生態サイト。文化・生態サイトなら、つながるジオサイト
function relatedSites(name){
  const id = siteIdOf(name); if (!id) return [];
  const me = LINKS.sites[id], out = new Set();
  if (me.kind === "ジオサイト"){
    if (me.group) geoIdsOf(me.group).forEach(g=> out.add(LINKS.sites[g].name));
    LINKS.links.forEach(l=>{ if (l.earth.some(t=> t === id || t === me.group)) out.add(LINKS.sites[l.to]?.name); });
  }
  else LINKS.links.filter(l=> l.to === id).forEach(l=> l.earth.forEach(t=> geoIdsOf(t).forEach(g=> out.add(LINKS.sites[g].name))));
  out.delete(name); out.delete(undefined);
  return [...out];
}
// つながりのあるサイトの名前すべて（地域の解説の最後に使う）
function linkedSiteNames(){
  const out = new Set();
  LINKS.links.forEach(l=>{ out.add(LINKS.sites[l.to]?.name); l.earth.forEach(t=> geoIdsOf(t).forEach(g=> out.add(LINKS.sites[g].name))); });
  out.delete(undefined);
  return out;
}

// ---- サイトを選んだとき：関連するサイトをささやかに点滅（選ぶのをやめたら消す） ----
const relLayer = L.layerGroup();
function showRelated(o){
  relLayer.clearLayers();
  relatedSites(o.name).forEach((n, k)=>{
    const x = allMarkers.find(m=> m.name === n); if (!x) return;
    L.marker(x.marker.getLatLng(), { interactive:false, keyboard:false, pane:"pane-labels",
      icon:L.divIcon({ className:"", iconSize:[30,30], iconAnchor:[15,15],
        html:`<div class="rel-ring" style="--rc:${SITE_CATS[x.cat]?.fill || "#c30d23"};animation-delay:${(k % 6) * 0.2}s"></div>` }) }).addTo(relLayer);
  });
  relLayer.addTo(map);
}
selRing.on("remove", ()=> relLayer.remove());   // 選んだ印の丸が消えるとき（パネルを閉じた・別のタブ）に一緒に消す

// ---- 地域の解説の最後：その地域の大地と、つながる文化サイトをまとめて点滅させる場面 ----
function areaLinkScene(a){
  const linked = linkedSiteNames(); if (!linked.size) return null;
  const inArea = o=> a.bounds?.contains(o.marker.getLatLng()) || o.area === a.id;
  const names = allMarkers.filter(o=> (o.cat === "ジオサイト" || o.cat === "文化サイト") && linked.has(o.name) && inArea(o)).map(o=> o.name);
  if (names.length < 2) return null;
  return { text:"この地域の大地と、その大地とつながる人の暮らしの場所です。\n気になるところを、地図で選んでみよう！", fit:names, blink:names, noPan:true, photo:false };
}
