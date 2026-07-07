/* 萩ジオパーク マップ — 案内地図パンフレット連動版
   構造：エリア(物語)→視点→サイト。背景は QGIS で乗算まで焼き込んだ4合成を切替。 */

// 地形（陰影＋傾斜）の被覆範囲に一致
const GEOPARK_BOUNDS = L.latLngBounds([34.16667, 131.0], [34.83333, 131.875]);
// 広域(地理院)モードで動ける範囲。z8でも画面より広いよう西日本規模に取り、
// 中心へ引き戻されないようにする（遠方の海まで飛ばない程度の枠は残す）
const WIDE_BOUNDS = L.latLngBounds([30.5, 127.0], [37.5, 135.0]);
const WIDE_Z = 10.6;                 // これ未満のズーム＝広域(地理院のみ＝赤枠表示)。全体(≈11.06)から少し引くと赤枠／重なる低倍率帯も非表示に
// 初期表示は見どころ一覧を隠す（PCのみ。スマホは下部シートで元々非表示）。
// 地図生成の前に付けることで、地図が最初から全幅で測られ、中心がずれない
if (!window.matchMedia("(max-width: 760px)").matches) document.body.classList.add("sb-hidden");
const map = L.map("map", {
  minZoom: 8, maxZoom: 16,           // z8まで引ける＝広域モード
  zoomSnap: 0,                       // 連続ズーム＝初期に地形を画面いっぱいに詰められる
  maxBounds: WIDE_BOUNDS,
  maxBoundsViscosity: 0,             // 枠は柔らかく＝広域でも自由にパンできる
  zoomControl: false,                // ＋－は右下（GPSボタンの下）に自前で置く
});
// 「全体を見る」＝見島を除く萩ジオパークの範囲を中央に。
// 縦長画面＝範囲全体を収める（引くと広域＝赤枠オーバービューになる。それでよい）。
// 横長画面＝陰影図(GEOPARK_BOUNDS)の外は見せない（寄せて中心を陰影図内へクランプ）。
const MAINLAND_BOUNDS = L.latLngBounds([34.2103, 131.2706], [34.6810, 131.7955]);
const HOME_PADDING = [16, 16];   // 範囲まわりの余白（縁が切れないよう）
function homeView(){
  const sz = map.getSize();
  const zRange = map.getBoundsZoom(MAINLAND_BOUNDS, false, L.point(HOME_PADDING[0], HOME_PADDING[1]));
  if (sz.y >= sz.x){   // 縦長＝範囲全体を中央に（広域＝赤枠オーバービューでOK）
    return { center: MAINLAND_BOUNDS.getCenter(), zoom: zRange };
  }
  // 横長＝陰影図の外を出さない。範囲全体が入るズームと外を出さない最小ズームの大きい方を採用
  const zInside = map.getBoundsZoom(GEOPARK_BOUNDS, true);
  const z = Math.max(zRange, zInside) + 0.05;   // わずかに寄せて陰影図の縁が画面外へ（丸め対策）
  const half = sz.divideBy(2);
  const PAD = 2;   // クランプの安全余白（px）＝陰影図の縁を確実に画面外へ
  const nw = map.project(GEOPARK_BOUNDS.getNorthWest(), z);
  const se = map.project(GEOPARK_BOUNDS.getSouthEast(), z);
  const c  = map.project(MAINLAND_BOUNDS.getCenter(), z);
  const cl = (v, lo, hi)=> lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));   // 陰影図内へクランプ
  c.x = cl(c.x, nw.x + half.x + PAD, se.x - half.x - PAD);
  c.y = cl(c.y, nw.y + half.y + PAD, se.y - half.y - PAD);
  return { center: map.unproject(c, z), zoom: z };
}
{ const h = homeView(); map.setView(h.center, h.zoom); }   // 初期表示

// ---- 画面外の見島の方角を、地図の縁に矢印＋「見島」で示す（タップで見島へ移動） ----
const MISHIMA = L.latLng(34.7750, 131.1455);
// 見島ポインタの表示条件：ズーム13以下（引いた状態）で、かつ「見島・相島・大島」を
// 結ぶ三角形（＝見島まわりの海域）が表示範囲に一部でも入っているときだけ出す。
const MISHIMA_MAX_ZOOM = 13;                 // 14以上は非表示
const MISHIMA_TRI = [                         // [lng, lat]
  [131.1455,   34.7750  ],   // 見島
  [131.27821,  34.508183],   // 相島
  [131.41026,  34.501022],   // 大島
];
// 三角形と現在の表示範囲（矩形）が一部でも重なっているか
function mishimaTriInView(){
  const b = map.getBounds();
  const W = b.getWest(), E = b.getEast(), S = b.getSouth(), N = b.getNorth();
  const rc = [[W,S],[E,S],[E,N],[W,N]];      // 矩形の4隅 [lng,lat]
  const cross = (o,a,c)=> (a[0]-o[0])*(c[1]-o[1]) - (a[1]-o[1])*(c[0]-o[0]);
  const inTri = p => {                        // 点が三角形内か（符号一致）
    const d1=cross(MISHIMA_TRI[0],MISHIMA_TRI[1],p), d2=cross(MISHIMA_TRI[1],MISHIMA_TRI[2],p), d3=cross(MISHIMA_TRI[2],MISHIMA_TRI[0],p);
    const neg=(d1<0)||(d2<0)||(d3<0), pos=(d1>0)||(d2>0)||(d3>0);
    return !(neg && pos);
  };
  const segInt = (a,b2,c,d)=>{                // 線分ab と cd が交差するか
    const s=(p,q,r)=> (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]);
    return ((s(c,d,a)>0)!==(s(c,d,b2)>0)) && ((s(a,b2,c)>0)!==(s(a,b2,d)>0));
  };
  for (const v of MISHIMA_TRI){ if (v[0]>=W && v[0]<=E && v[1]>=S && v[1]<=N) return true; }   // 三角形頂点が矩形内
  for (const c of rc){ if (inTri(c)) return true; }                                            // 矩形隅が三角形内
  const te=[[MISHIMA_TRI[0],MISHIMA_TRI[1]],[MISHIMA_TRI[1],MISHIMA_TRI[2]],[MISHIMA_TRI[2],MISHIMA_TRI[0]]];
  const re=[[rc[0],rc[1]],[rc[1],rc[2]],[rc[2],rc[3]],[rc[3],rc[0]]];
  for (const [a,b2] of te) for (const [c,d] of re){ if (segInt(a,b2,c,d)) return true; }        // 辺の交差
  return false;
}
(function mishimaPointer(){
  const el = document.createElement("div");
  el.id = "mishimaPointer";
  el.innerHTML =
    `<span class="mp-arrow"><svg viewBox="0 0 24 24" aria-hidden="true">`+
    `<path d="M3 12h15M12 6l7 6-7 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`+
    `<span>見島</span>`;
  el.title = "見島へ移動";
  map.getContainer().appendChild(el);
  el.addEventListener("click", ()=> map.flyTo(MISHIMA, 13, { duration:.9 }));
  function update(){
    const size = map.getSize();
    if (map.getBounds().contains(MISHIMA)){ el.style.display = "none"; return; }   // 画面内なら出さない
    if (map.getZoom() > MISHIMA_MAX_ZOOM){ el.style.display = "none"; return; }   // 14以上（寄り）は出さない
    if (!mishimaTriInView()){ el.style.display = "none"; return; }                // 見島・相島・高山の三角形が画面外なら出さない
    const p = map.latLngToContainerPoint(MISHIMA);
    const cx = size.x/2, cy = size.y/2;
    const dx = p.x - cx, dy = p.y - cy;
    if (!dx && !dy){ el.style.display = "none"; return; }
    // 中心→見島 の方向線が、余白を取った縁の矩形と交わる点に置く
    const halfW = Math.max(size.x/2 - 62, 10), halfH = Math.max(size.y/2 - 62, 10);
    const scale = Math.min(halfW/Math.max(Math.abs(dx),1e-6), halfH/Math.max(Math.abs(dy),1e-6));
    el.style.display = "flex";
    el.style.left = (cx + dx*scale) + "px";
    el.style.top  = (cy + dy*scale) + "px";
    el.querySelector(".mp-arrow").style.transform = "rotate(" + (Math.atan2(dy,dx)*180/Math.PI) + "deg)";
  }
  map.on("move zoom viewreset moveend", update);
  update();
})();

// 運営モード（B・無ランク・施設なども解禁）: URLに ?all=1 か、控えめな隠しボタンで
let staff = /[?&]all=1\b/.test(location.search);
document.body.classList.toggle("staff", staff);   // 運営モードは上部バーを墨色に

// ---- 背景の4合成（QGISで乗算適用済み） ----
const TILE = "data/tiles";
const V = "?v=5"; // タイル再生成時にbump（v5=市町名をタイルから除外）
// 合成タイル専用ペイン（地理院タイルの上・オーバーレイの下）。ジオパークの形でくり抜く
map.createPane("pane-combo");
map.getPane("pane-combo").style.zIndex = 250;
const tOpts = { minZoom:10, maxZoom:16, maxNativeZoom:14, bounds:GEOPARK_BOUNDS, tileSize:256, pane:"pane-combo",
  attribution:"陰影・傾斜・海底地形・地質・植生：萩ジオパーク推進協議会（QGIS）" };
// 陰影図の範囲（GEOPARK_BOUNDS）でクリップ。外側は地理院地図
function clipCombo(){
  const pane = map.getPane("pane-combo"); if (!pane) return;
  const nw = map.latLngToLayerPoint(GEOPARK_BOUNDS.getNorthWest());
  const se = map.latLngToLayerPoint(GEOPARK_BOUNDS.getSouthEast());
  const clip = `polygon(${nw.x}px ${nw.y}px, ${se.x}px ${nw.y}px, ${se.x}px ${se.y}px, ${nw.x}px ${se.y}px)`;
  pane.style.clipPath = clip; pane.style.webkitClipPath = clip;
}
map.on("move zoom zoomend moveend viewreset", clipCombo);
const combo = {
  both: L.tileLayer(`${TILE}/both/{z}/{x}/{y}.png${V}`, tOpts),
  veg:  L.tileLayer(`${TILE}/veg/{z}/{x}/{y}.png${V}`,  tOpts),
  geo:  L.tileLayer(`${TILE}/geo/{z}/{x}/{y}.png${V}`,  tOpts),
  none: L.tileLayer(`${TILE}/none/{z}/{x}/{y}.png${V}`, tOpts),
};
let vegOn = true, geoOn = true, activeCombo = null;
function updateBase(){
  const key = vegOn && geoOn ? "both" : vegOn ? "veg" : geoOn ? "geo" : "none";
  if (key === activeCombo) return;
  const next = combo[key];
  next.addTo(map);   // 地理院タイルの上・エリア/マーカーの下（zIndexで制御）
  Object.entries(combo).forEach(([k,l])=>{ if (k!==key && map.hasLayer(l)) map.removeLayer(l); });
  activeCombo = key;
}
updateBase();
clipCombo();   // 初期クリップ（陰影図の範囲でカット）

// ---- 地理院タイル（淡色地図）＝常に最下地。範囲外(旧・白地)や広域モードで見える ----
const gsiLayer = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
  { minZoom:5, maxZoom:18, zIndex:1, attribution:"地理院タイル（淡色地図）" }).addTo(map);
let rangeLayer = null, rangeLogo = null;   // 範囲ポリゴン・中央のロゴ（読み込み後に生成）
let wideMode = false;

// 詳細表示（マーカー・ラベル・地名・エリア名）のペイン一覧
function detailPanes(){
  return ["pane-area","pane-arealabel","pane-labels","pane-place"]
    .concat(Object.values(SITE_CATS).map(d=>"pane-cat-"+d.key))
    .concat(Object.values(REF_CATS).map(d=>"pane-cat-"+d.key));
}
function setWideMode(on){
  if (on === wideMode) return;
  wideMode = on;
  if (on){
    // 広域：地理院のみ（地理院は常時下地）。範囲の赤線＋中央ロゴを重ね、QGIS合成と見どころは外す
    if (rangeLayer) rangeLayer.addTo(map);
    if (rangeLogo) rangeLogo.addTo(map);
    if (activeCombo && combo[activeCombo]) map.removeLayer(combo[activeCombo]);
    activeCombo = null;
    map.removeLayer(siteLayer); map.removeLayer(refLayer);
    detailPanes().forEach(p=>{ const pn=map.getPane(p); if(pn) pn.style.display="none"; });
  } else {
    // 詳細：地理院の上にQGIS合成を重ねる（範囲外は地理院が見える＝白地にならない）
    if (rangeLayer) map.removeLayer(rangeLayer);
    if (rangeLogo) map.removeLayer(rangeLogo);
    detailPanes().forEach(p=>{ const pn=map.getPane(p); if(pn) pn.style.display=""; });
    siteLayer.addTo(map); refLayer.addTo(map);
    updateBase();   // QGIS合成を貼り直す
  }
}

// ---- エリア用ペイン（背景タイルの上・マーカーの下） ----
map.createPane("pane-area");  map.getPane("pane-area").style.zIndex = 360;
map.createPane("pane-arealabel"); map.getPane("pane-arealabel").style.zIndex = 640;
// ラベル層（マーカーより下＝丸が常に見える。位置は自前で衝突回避して配置）
map.createPane("pane-labels");
map.getPane("pane-labels").style.zIndex = 645;
map.getPane("pane-labels").style.pointerEvents = "none";
// 地名（市町名）層＝背景の上・他ラベルの下。タイルからは外しWebで描画（重なり回避に参加）
map.createPane("pane-place");
map.getPane("pane-place").style.zIndex = 655;   // 市町名は最前面（エリア名・サイト名ラベルより上＝必ず読める）
map.getPane("pane-place").style.pointerEvents = "none";

// カテゴリごとの描画順ペイン（QGISのレイヤ順。大きいほど手前）。
// ラベル(tooltipPane=650)より前面(660+)に置き、丸がラベルに隠れず常に見えるようにする
function catPane(def){
  const nm = "pane-cat-" + def.key;
  if (!map.getPane(nm)) { map.createPane(nm); map.getPane(nm).style.zIndex = 660 + (def.z || 0); }
  return nm;
}

// ---- helpers ----
function esc(s){ return (s==null?"":String(s)).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function rankColor(r){ return r==="AA"?"#d6453c":r==="A"?"#e8893b":r==="B"?"#4c9a6b":"#9aa0a6"; }

// 色・文字・表示ズームは QGIS(HagiGeopark_map_202606.qgz)の各レイヤ設定を反映
//   fill/outline=マーカー色, lbl=ラベル文字色, buf=ラベル縁取り色, px=ラベルサイズ, minZoom=表示開始
//   minZoom は QGIS の縮尺依存表示(minScale)を Leaflet ズームに換算した値
// 全てQGIS実測を反映：マーカー=丸(circle)。fill/outline/outmm=塗り/縁色/縁幅mm, msize=径mm,
//   lbl=ラベル名の色, desc=説明を2行目に出すか, buf/bufmm=ラベル縁取り色/幅mm, pt=名前pt, bold=太字,
//   prio=ラベル優先度, z=描画順(大=手前), minZoom=QGIS縮尺依存の表示開始(scale→zoom換算)
const SITE_CATS = {
  "ジオサイト": { file:"geosites.geojson", key:"geo",  fill:"#e31a1c", outline:"#ffffff", outmm:0.4, msize:3.0, lbl:"#333333", desc:true,  buf:"#ffffff", bufmm:1.0, pt:11, bold:true, minZoom:11.7, prio:7,  z:4, ranked:true },
  "文化サイト": { file:"cultural.geojson", key:"cul",  fill:"#d78800", outline:"#ffffff", outmm:0.4, msize:3.0, lbl:"#333333", desc:false, buf:"#ffffff", bufmm:0.8, pt:10, bold:true, minZoom:12.3, prio:2,  z:3, always:true },
  "展望地":     { file:"viewpoint.geojson",key:"view", fill:"#1f78b4", outline:"#ffffff", outmm:0.4, msize:3.0, lbl:"#1f78b4", desc:true,  buf:"#ffffff", bufmm:0.8, pt:11, bold:true, minZoom:11.0, prio:9,  z:5, ranked:true },
  "拠点施設":   { file:"hubs.geojson",     key:"hub",  fill:"#2b8525", outline:"#fff980", outmm:0.4, msize:3.0, lbl:"#2b8525", desc:true,  buf:"#fff980", bufmm:0.6, pt:11, bold:true, minZoom:11.0, prio:10, z:8, hub:true },
  // 案内地図＝床地図等の案内板。サイト種別として解説板と同等（拠点施設とは別枠）。一般は常時表示
  "案内地図": { file:"kanban.geojson",     key:"kan",  fill:"#2b8525", outline:"#ffffff", outmm:0.4, msize:2.4, lbl:"#2b8525", desc:false, buf:"#ffffff", bufmm:0.8, pt:11, bold:true,  minZoom:11.7, prio:6, z:6, always:true },
  // 解説板＝サイト種別（一般は常時表示・トグルなし。運営のみトグル）
  "解説板":   { file:"kaisetsu.geojson",   key:"kai",  fill:"#e31a1c", outline:"#fff980", outmm:0.4, msize:3.0, lbl:"#e31a1c", desc:false, buf:"#fff980", bufmm:0.8, pt:11, bold:true,  minZoom:15.6, prio:7, z:7, always:true },
  // 神社＝サイト種別。マーカー/ラベル/優先度は文化サイト同等（茶#714B34）。主要(名前あり)=一般表示／その他=運営のみ
  "神社":     { file:"shrines.geojson",    key:"shrine",fill:"#714B34", outline:"#ffffff", outmm:0.4, msize:3.0, lbl:"#714B34", desc:false, buf:"#ffffff", bufmm:0.8, pt:10, bold:true,  minZoom:13.3, prio:2, z:3 },
};
// 地図の目印＝参照表示（山名・公共施設のみ）。見た目もQGIS通り（山=小さい白丸黒縁, 公共施設=小さい濃灰丸）
const REF_CATS = {
  "山名":     { file:"yama.geojson",       key:"yama", fill:"#ffffff", outline:"#000000", outmm:0.2, msize:2.4, lbl:"#ffffff", desc:false, buf:"#000000", bufmm:0.4, pt:10, bold:true,  minZoom:11.3, prio:1, z:1, shape:"triangle" },
  "公共施設": { file:"facilities.geojson", key:"fac",  fill:"#ffffff", outline:"#595857", outmm:0.4, msize:1.4, lbl:"#ffffff", desc:false, buf:"#595857", bufmm:0.8, pt:10, bold:false, minZoom:13.3, prio:1, z:2 },
};

// 丸マーカー（QGIS: circle）。径・塗り・縁色・縁幅をmmからpx換算して反映
const PX_MM = 96/25.4;                 // 1mm→px
function dotIcon(def, aa){
  const d = def.msize * PX_MM;          // 径(px)
  const sw = def.outmm * PX_MM;         // 縁幅(px)
  const stroke = aa ? "#f4c430" : def.outline;
  const box = d + sw*2 + 2, c = box/2, r = d/2;
  const shapeSvg = def.shape === "triangle"
    ? `<polygon points="${c},${(c-r).toFixed(2)} ${(c-r*0.866).toFixed(2)},${(c+r*0.5).toFixed(2)} ${(c+r*0.866).toFixed(2)},${(c+r*0.5).toFixed(2)}" `+
      `fill="${def.fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`
    : `<circle cx="${c}" cy="${c}" r="${r}" fill="${def.fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  const html =
    `<svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" style="display:block;overflow:visible">`+
    `${shapeSvg}</svg>`;
  return L.divIcon({ className:"", html, iconSize:[box,box], iconAnchor:[c,c],
                     popupAnchor:[0,-c], tooltipAnchor:[r+3, 0] });  // ラベルは丸の右へ（Google流）
}
// C以下のジオサイト＝小さめ表示（B以上と区別）。神社・公共施設と同じ13.3で出現。
const GEO_BIG_RANKS = ["AA","A","B"];
const GEO_SMALL = { minZoom: 13.3, msize: 2.2, pt: 9 };
function isGeoSmall(o){ return o.cat === "ジオサイト" && !GEO_BIG_RANKS.includes(o.rank); }
function markerIcon(cat, rank){
  const def = SITE_CATS[cat];
  if (cat === "ジオサイト" && !GEO_BIG_RANKS.includes(rank))
    return dotIcon({ ...def, msize: GEO_SMALL.msize }, false);   // C以下＝小
  return dotIcon(def, staff && rank==="AA");
}
function refIcon(cat){ return dotIcon(REF_CATS[cat], false); }

// ラベルHTML（Googleマップ流：地図には名前だけ。説明はクリックでポップアップに）
function labelHtml(def, p){ return `<span class="ln">${esc(p.name)}</span>`; }
// 自前ラベルDOMを作成（位置は placeLabels() が衝突回避して決める）
// clickMarker を渡すと、ラベルのタップでそのマーカーのポップアップを開く
function makeLabel(def, p, clickMarker, smallGeo){
  const el = document.createElement("div");
  el.className = "poi-label lbl-" + (smallGeo ? "geosm" : def.key);
  el.innerHTML = labelHtml(def, p);
  el.style.cssText = "position:absolute;display:none;left:0;top:0;";
  if (clickMarker){
    el.style.pointerEvents = "auto";
    el.style.cursor = "pointer";
    el.addEventListener("click", e=>{ e.stopPropagation(); clickMarker.openPopup(); });
  }
  map.getPane("pane-labels").appendChild(el);
  return el;
}

// ---- ポップアップ ----
function pointPopup(o){
  const p = o.props;
  let h = "";
  if (p.name) h += `<img class="popup-photo" src="${photoSrc(p.name)}" alt="" onerror="this.style.display='none'">`;
  if (staff && p["ランク"]) h += `<span class="popup-badge" style="background:${rankColor(p["ランク"])}">${esc(p["ランク"])}</span>`;
  if (staff && p["主要"]==="Y") h += `<span class="popup-badge" style="background:#714B34">主要</span>`;
  h += `<h3>${esc(p.name)}</h3>`;
  if (p["説明"]) h += `<p class="popup-desc">${esc(p["説明"])}</p>`;
  const pics = [];
  if (p["駐車場"]==="Y")   pics.push(`<span class="picto">🅿️ 駐車場</span>`);
  if (p["現地解説"]==="Y") pics.push(`<span class="picto">🪧 現地解説</span>`);
  if (pics.length) h += `<div class="popup-picto">${pics.join("")}</div>`;
  const ll = o.marker.getLatLng();
  const route = `https://www.google.com/maps/dir/?api=1&destination=${ll.lat},${ll.lng}`;
  let actions = `<a href="${route}" target="_blank" rel="noopener">🧭 経路</a>`;
  if (staff && p.name){
    actions += `<button class="popup-qrbtn" data-name="${esc(p.name)}">🔗 QR</button>`;
    actions += `<button class="popup-photobtn" data-name="${esc(p.name)}">📷 写真</button>`;
  }
  h += `<div class="popup-actions">${actions}</div>`;
  return h;
}

// ---- 写真：命名規則で紐付け（img/sites/<サイト名>.jpg）。無ければ自動で非表示 ----
function sanitizeName(s){ return String(s).replace(/[\\/:*?"<>|]/g, "_").trim(); }
function photoFile(name){ return sanitizeName(name) + ".jpg"; }
function photoSrc(name){ return "img/sites/" + encodeURIComponent(photoFile(name)); }

// ディープリンクURL（?site=名前 / ?area=id）＝看板QRの貼り先
function siteLink(name){ return location.origin + location.pathname + "?site=" + encodeURIComponent(name); }
function areaLink(id){   return location.origin + location.pathname + "?area=" + encodeURIComponent(id); }

// 運営モード：看板用のQRコード＋リンクをモーダル表示（QR画像は保存可）
function showSiteQR(name){
  const url = siteLink(name);
  let img = "";
  try { const qr = qrcode(0, "M"); qr.addData(url); qr.make(); img = qr.createDataURL(6, 8); }
  catch(e){ img = ""; }
  const old = document.querySelector(".qr-modal"); if (old) old.remove();
  const m = document.createElement("div"); m.className = "qr-modal";
  m.innerHTML =
    `<div class="qr-card">`+
    `<button class="qr-close" aria-label="閉じる">×</button>`+
    `<div class="qr-ttl">看板用 QR・リンク</div>`+
    `<div class="qr-name">${esc(name)}</div>`+
    (img ? `<img class="qr-img" src="${img}" alt="QRコード">` : `<div class="qr-err">QR生成に失敗しました</div>`)+
    `<div class="qr-url">${esc(url)}</div>`+
    `<div class="qr-actions">`+
    `<button class="qr-copy">リンクをコピー</button>`+
    (img ? `<a class="qr-dl" href="${img}" download="QR_${esc(name)}.gif">画像を保存</a>` : ``)+
    `</div></div>`;
  document.body.appendChild(m);
  const close = ()=> m.remove();
  m.querySelector(".qr-close").onclick = close;
  m.addEventListener("click", e=>{ if (e.target === m) close(); });
  m.querySelector(".qr-copy").onclick = ()=>{
    navigator.clipboard?.writeText(url).then(()=> toast("リンクをコピーしました"), ()=> toast("コピーできませんでした"));
  };
}
// ---- 写真登録ツール（運営モード）：ドロップ→軽量化→保存 ----
function resizePhoto(file, maxW, cb){
  const img = new Image();
  img.onload = ()=>{
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
    const c = document.createElement("canvas"); c.width=w; c.height=h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    c.toBlob(b=> cb(b), "image/jpeg", 0.82);
  };
  img.onerror = ()=> toast("画像を読み込めませんでした");
  img.src = URL.createObjectURL(file);
}
let sitesDirHandle = null;
async function savePhoto(name, blob){
  const fname = photoFile(name);
  if (window.showDirectoryPicker){
    try {
      if (!sitesDirHandle){
        toast("保存先フォルダ img/sites を選んでください");
        sitesDirHandle = await window.showDirectoryPicker({ mode:"readwrite" });
      }
      const fh = await sitesDirHandle.getFileHandle(fname, { create:true });
      const w = await fh.createWritable(); await w.write(blob); await w.close();
      toast("写真を登録しました"); return;
    } catch(e){ if (e && e.name === "AbortError"){ return; } /* それ以外はダウンロードへ */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  toast("画像を保存しました。img/sites/ に置いてください");
}
function showPhotoUpload(name){
  const old = document.querySelector(".qr-modal"); if (old) old.remove();
  const m = document.createElement("div"); m.className = "qr-modal";
  m.innerHTML =
    `<div class="qr-card">`+
    `<button class="qr-close" aria-label="閉じる">×</button>`+
    `<div class="qr-ttl">写真を登録（運営）</div>`+
    `<div class="qr-name">${esc(name)}</div>`+
    `<label class="ph-drop"><span>タップで写真を選ぶ／ドロップ</span><input type="file" accept="image/*" hidden></label>`+
    `<div class="ph-note">横800pxに軽量化して保存します。ファイル名：${esc(photoFile(name))}</div>`+
    `<div class="qr-actions"><button class="ph-save" disabled>登録する</button></div>`+
    `</div>`;
  document.body.appendChild(m);
  const close = ()=> m.remove();
  m.querySelector(".qr-close").onclick = close;
  m.addEventListener("click", e=>{ if (e.target === m) close(); });
  const drop = m.querySelector(".ph-drop"), input = drop.querySelector("input"), saveBtn = m.querySelector(".ph-save");
  let blob = null;
  const handleFile = file=>{
    if (!file || !file.type.startsWith("image/")) return;
    resizePhoto(file, 800, b=>{
      blob = b; drop.style.backgroundImage = `url(${URL.createObjectURL(b)})`;
      drop.classList.add("has-img"); saveBtn.disabled = false;
    });
  };
  input.addEventListener("change", ()=> handleFile(input.files[0]));
  drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", ()=> drop.classList.remove("drag"));
  drop.addEventListener("drop", e=>{ e.preventDefault(); drop.classList.remove("drag"); handleFile(e.dataTransfer.files[0]); });
  saveBtn.onclick = async ()=>{ if (!blob) return; saveBtn.disabled = true; await savePhoto(name, blob); close(); };
}

// ポップアップ内の「QR」「写真」ボタンを配線（HTML文字列なのでopen時に付ける）
map.on("popupopen", e=>{
  const root = e.popup.getElement(); if (!root) return;
  const qb = root.querySelector(".popup-qrbtn");    if (qb) qb.onclick = ()=> showSiteQR(qb.dataset.name);
  const pb = root.querySelector(".popup-photobtn"); if (pb) pb.onclick = ()=> showPhotoUpload(pb.dataset.name);
});

// ディープリンク（?site=名前 / ?area=id）で対象を開く
function openDeepLink(){
  const params = new URLSearchParams(location.search);
  const areaId = params.get("area"), siteName = params.get("site");
  if (areaId && areaById[areaId]){ enterArea(areaId); return; }
  if (siteName){
    const o = allMarkers.find(x=> x.name === siteName);
    if (o){
      const z = Math.min(map.getMaxZoom(), Math.max(15, Math.ceil(o.def.minZoom)));
      const show = ()=>{ refresh(); if (siteLayer.hasLayer(o.marker)) o.marker.openPopup(); };
      map.once("moveend", show);       // 移動完了後に確実に開く
      map.setView(o.marker.getLatLng(), z);
      setTimeout(show, 400);           // moveendが来ない場合の保険
    } else { toast("該当の地点が見つかりませんでした"); }
  }
}

// ---- 状態 ----
const siteLayer = L.layerGroup().addTo(map);   // サイト（ピン）
const refLayer  = L.layerGroup().addTo(map);   // 地図の目印（参照）
const allMarkers = [];                 // サイト: {marker, cat, rank, area, name, props, label, viewpoint, hub}
const refMarkers = [];                 // 参照:   {marker, cat}
const catOn = { "ジオサイト":true, "文化サイト":true, "展望地":true, "拠点施設":true, "案内地図":true, "解説板":true, "神社":true };
const refOn = { "山名":true, "公共施設":true };
let AREAS = [];                        // areas.geojson features' properties + bounds
const areaById = {};
let myLatLng = null;                    // GPS現在地（取得後にセット）
let nearSort = false;                   // 一覧を現在地から近い順に
let hereMarker = null, hereCircle = null;  // 現在地の青点・精度円

// 表示ルール：どのサイトを見せるか（ランク×エリア×モード）
function siteEligible(o){
  if (o.hub || o.def.always) return true; // 拠点施設・文化サイトは常に全採用
  if (staff) return true;
  if (o.cat === "神社") return o.props["主要"] === "Y";  // 一般は主要(名前あり)のみ、運営は全部(上のstaffで解禁)
  if (o.cat === "ジオサイト") return true;   // 全ランク表示（C以下は小さく・13.3で出現）
  if (o.rank === "AA") return true;       // AAはエリア内外問わず
  if (o.rank === "A")  return !!o.area;   // Aはエリア内のみ
  return false;                           // 展望のB/無は一般モードで隠す
}

function refresh(){
  const z = map.getZoom();
  // 画像タイル（詳細）モードは「z11以上 かつ 表示中心がジオパークのタイル域内」のときだけ。
  // エリア外を拡大しているときは、倍率が上がっても地理院地図のままにする（現在地周辺の確認用）
  const overGeopark = GEOPARK_BOUNDS.contains(map.getCenter());
  setWideMode(z < WIDE_Z || !overGeopark);
  if (wideMode) return;   // 広域モードは詳細（マーカー・ラベル）を出さない
  // サイト：ランク等で「見せる対象」を絞り、QGISの表示ズーム(def.minZoom)で「出現」を制御
  allMarkers.forEach(o=>{
    const mz = isGeoSmall(o) ? GEO_SMALL.minZoom : o.def.minZoom;   // C以下ジオサイトは13.3
    const vis = catOn[o.cat] && siteEligible(o) && z >= mz;
    if (vis && !siteLayer.hasLayer(o.marker)) siteLayer.addLayer(o.marker);
    else if (!vis && siteLayer.hasLayer(o.marker)) siteLayer.removeLayer(o.marker);
  });
  // 地図の目印（参照）：トグルON かつ QGISの表示ズームに達したら出す
  refMarkers.forEach(o=>{
    const vis = refOn[o.cat] && z >= o.def.minZoom;
    if (vis && !refLayer.hasLayer(o.marker)) refLayer.addLayer(o.marker);
    else if (!vis && refLayer.hasLayer(o.marker)) refLayer.removeLayer(o.marker);
  });
  updateAreaLabels(z);
  placeLabels();
}

// ラベルの重なり回避：QGISのpriorityが高い順に置き、重なる低優先を隠す（obstacle相当）
// ラベル配置（Googleマップ流）：丸に重ならない位置を右→左→上→下→さらに遠くの順に探す。
// 優先度の高い順に確定し、丸にも既存ラベルにも重ならない位置が無ければ隠す（丸は残る）。
function placeLabels(){
  const gap = 3;
  // 表示中マーカーを集める（layerPoint座標＝ラベル層と同じ空間）
  const vis = [];
  const collect = (o, layer) => {
    if (!o.labelEl) return;
    if (!layer.hasLayer(o.marker)) { o.labelEl.style.display = "none"; return; }
    const lp = map.latLngToLayerPoint(o.marker.getLatLng());
    const rad = o.def.msize*PX_MM/2 + o.def.outmm*PX_MM;
    vis.push({ el:o.labelEl, prio:o.def.prio, x:lp.x, y:lp.y, r:rad, side:o.labelSide });
  };
  allMarkers.forEach(o => collect(o, siteLayer));
  refMarkers.forEach(o => collect(o, refLayer));
  // サイズ計測（表示にしてから一括で読む）
  vis.forEach(v => { v.el.style.display = ""; });
  vis.forEach(v => { v.w = v.el.offsetWidth; v.h = v.el.offsetHeight; });
  // 全マーカーの丸を障害物に（名前なしマーカーも含む）
  const dots = [];
  const addDot = (o, layer) => {
    if (!layer.hasLayer(o.marker)) return;
    const lp = map.latLngToLayerPoint(o.marker.getLatLng());
    dots.push({ x:lp.x, y:lp.y, r:o.def.msize*PX_MM/2 + o.def.outmm*PX_MM });
  };
  allMarkers.forEach(o => addDot(o, siteLayer));
  refMarkers.forEach(o => addDot(o, refLayer));
  const rectHitsDot = (R, own) => {
    for (const d of dots){ if (d===own) continue;
      if (d.x > R.left-d.r && d.x < R.right+d.r && d.y > R.top-d.r && d.y < R.bottom+d.r) return true; }
    return false;
  };
  const rectsOverlap = (a,b,pad) => !(a.right+pad<b.left || a.left-pad>b.right || a.bottom+pad<b.top || a.top-pad>b.bottom);
  const placed = [];
  // エリア名を固定の障害物として先に登録（サイト/参照ラベルはエリア名を避ける）
  const mapRect = map.getContainer().getBoundingClientRect();
  const toLayerRect = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    const tl = map.containerPointToLayerPoint([r.left - mapRect.left, r.top - mapRect.top]);
    return { left:tl.x, top:tl.y, right:tl.x + r.width, bottom:tl.y + r.height };
  };
  document.querySelectorAll(".area-label").forEach(el => {
    if (parseFloat(el.style.opacity || "1") < 0.1) return;   // 寄って消えているエリア名は無視
    const R = toLayerRect(el); if (R) placed.push(R);
  });
  // 地名（市町名）＝最優先。必ず表示し、障害物として登録する（他のラベルが避ける）
  document.querySelectorAll(".place-label").forEach(el => {
    el.style.display = "";
    const R = toLayerRect(el); if (R) placed.push(R);
  });
  vis.slice().sort((a,b)=> b.prio-a.prio).forEach((v,i)=>{
    const own = dots.find(d=> d.x===v.x && d.y===v.y);
    const w=v.w, h=v.h, r=v.r, cx=v.x, cy=v.y;
    // マーカーのすぐ近く（右・左・上・下・斜め）だけを候補に。どこも置けなければ非表示
    const dx = r+gap+w/2, dy = r+gap+h/2;
    const cand = v.side === "left"
      ? [ [-dx,0], [-dx,-dy], [-dx,dy], [0,-dy], [0,dy], [dx,0], [dx,-dy], [dx,dy] ]   // 左優先
      : [ [dx,0], [-dx,0], [0,-dy], [0,dy], [dx,-dy], [dx,dy], [-dx,-dy], [-dx,dy] ];
    let chosen = null;
    for (const [ox,oy] of cand){
      const R = { left:cx+ox-w/2, top:cy+oy-h/2, right:cx+ox+w/2, bottom:cy+oy+h/2 };
      if (rectHitsDot(R, own)) continue;
      let bad=false; for (const q of placed){ if (rectsOverlap(R,q,2)){ bad=true; break; } }
      if (!bad){ chosen = R; break; }
    }
    if (!chosen){ v.el.style.display = "none"; return; }
    v.el.style.left = chosen.left + "px";
    v.el.style.top  = chosen.top  + "px";
    placed.push(chosen);
  });
  map.getPane("pane-labels").style.visibility = "visible";   // 再配置し終えたら表示
}

// エリアラベルは広域で主役、寄ったら控えめに
function updateAreaLabels(z){
  document.querySelectorAll(".area-label").forEach(el=>{
    el.style.opacity = z >= 13 ? "0" : z >= 12 ? "0.55" : "1";
  });
}

// QGISのラベル設定（色・pt・太字・縁取り幅mm/色）から .lbl-<key> のCSSを生成
function injectLabelStyles(){
  const halo = (color, mm) => {
    const R = mm * PX_MM;                       // 縁取り幅(px)
    const pts = [];
    for (const rr of [R, R*0.5]) for (let a=0; a<360; a+=45){
      const x=(Math.cos(a*Math.PI/180)*rr).toFixed(1), y=(Math.sin(a*Math.PI/180)*rr).toFixed(1);
      pts.push(`${x}px ${y}px 0 ${color}`);
    }
    return pts.join(",");
  };
  let css = "";
  [...Object.values(SITE_CATS), ...Object.values(REF_CATS)].forEach(d=>{
    css += `.lbl-${d.key}{text-shadow:${halo(d.buf, d.bufmm*0.5)};}\n`+
           `.lbl-${d.key} .ln{color:${d.lbl};font-size:${(d.pt*96/72).toFixed(1)}px;font-weight:${d.bold?700:400};}\n`+
           `.lbl-${d.key} .ld{color:#333333;font-size:${(8*96/72).toFixed(1)}px;font-weight:400;}\n`;
  });
  // C以下のジオサイト＝ジオと同じ色・縁取りで文字だけ小さく（B以上と区別）
  const geo = SITE_CATS["ジオサイト"];
  css += `.lbl-geosm{text-shadow:${halo(geo.buf, geo.bufmm*0.5)};}\n`+
         `.lbl-geosm .ln{color:${geo.lbl};font-size:${(GEO_SMALL.pt*96/72).toFixed(1)}px;font-weight:${geo.bold?700:400};}\n`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
}

// ---- 読み込み ----
const DATAV = "?d=19";   // geojson更新時にbump（ブラウザキャッシュ回避）
const fetchGj = def => fetch("data/"+def.file+DATAV).then(r=>r.json());
Promise.all([
  fetch("data/areas.geojson"+DATAV).then(r=>r.json()),
  Promise.all(Object.entries(SITE_CATS).map(([name,def])=> fetchGj(def).then(gj=>({name,def,gj})))),
  Promise.all(Object.entries(REF_CATS).map(([name,def])=> fetchGj(def).then(gj=>({name,def,gj})))),
  fetch("data/places.geojson"+DATAV).then(r=>r.json()).catch(()=>({features:[]})),
  fetch("data/geopark_area.geojson"+DATAV).then(r=>r.json()).catch(()=>null),
]).then(([areaGj, sites, refs, placesGj, areaPolyGj])=>{
  injectLabelStyles();
  if (areaPolyGj) rangeLayer = L.geoJSON(areaPolyGj, { interactive:false,
    style:{ color:"#c0392b", weight:2.5, opacity:.9, fillColor:"#1b6a4b", fillOpacity:.12 } });
  // 広域モードで範囲の中央に置く萩ジオパークのロゴ（タップで範囲へズームイン）
  rangeLogo = L.marker(MAINLAND_BOUNDS.getCenter(), { interactive:true, keyboard:false, zIndexOffset:700,
    icon: L.divIcon({ className:"", iconSize:[58,58], iconAnchor:[29,29],
      html:`<img src="img/logo-badge.png" alt="萩ジオパーク" class="range-logo">` }) });
  rangeLogo.on("click", ()=> resetView());
  if (wideMode){ if (rangeLayer) rangeLayer.addTo(map); rangeLogo.addTo(map); }   // 既に広域なら即表示
  buildAreas(areaGj);
  buildPlaces(placesGj);
  sites.forEach(({name,def,gj})=> buildSiteCategory(name,def,gj));
  refs.forEach(({name,def,gj})=> buildRefCategory(name,def,gj));
  linkViewpoints();
  spreadOverlaps();
  buildControls();
  buildSidebar();
  // スマホ：表示・凡例パネルをボトムシート内へ移設（同じDOMなので配線はそのまま）
  if (window.matchMedia("(max-width: 760px)").matches){
    const panel = document.querySelector(".layers-panel");
    const host = document.getElementById("sheetExtra");
    if (panel && host){ panel.classList.remove("collapsed"); host.appendChild(panel); }
  }
  refresh();
  // ロゴ長押しで運営モードを切り替えた直後は、再読込後にトーストで状態を知らせる
  const st = sessionStorage.getItem("staffToast");
  if (st){ sessionStorage.removeItem("staffToast"); toast(st); }
  map.on("moveend", refresh);   // ズーム・パンの両方で表示とラベル重なりを更新
  // ズーム中は自前ラベルが追従しないので隠す（残像防止）。moveend後の再配置で戻す
  map.on("zoomstart", ()=> { map.getPane("pane-labels").style.visibility = "hidden"; });
  openDeepLink();               // ?site= / ?area= があれば対象を開く
}).catch(e=> console.error("load failed", e));

// 地名（市町名）ラベル＝QGISの市町村名レイヤをWeb化（タイルからは除外済み）
function buildPlaces(gj){
  (gj.features||[]).forEach(f=>{
    const c = f.geometry.coordinates;
    if (!GEOPARK_BOUNDS.contains([c[1], c[0]])) return;   // 範囲外（白地）には市町名を出さない
    L.marker([c[1], c[0]], { pane:"pane-place", interactive:false,
      icon: L.divIcon({ className:"", iconSize:[0,0], iconAnchor:[0,0],
        html:`<div class="place-label">${esc(f.properties.name)}</div>` })
    }).addTo(map);
  });
}

function buildAreas(gj){
  gj.features.forEach(f=>{
    const pr = f.properties;
    // ゾーンの枠は描かない（範囲は寄る時の目安としてのみ使用）→ boundsだけ算出
    const bounds = L.latLngBounds(f.geometry.coordinates[0].map(c=>[c[1],c[0]]));
    const rec = { ...pr, bounds };
    AREAS.push(rec); areaById[pr.id] = rec;

    // エリア名＋物語タイトルのラベル（クリックでそのエリアへ）
    const leftAnchored = pr.anchor === "left";   // 左アンカー＝labelLonから右方向に伸ばす（ズームに依らず右に固定）
    const label = L.marker([pr.labelLat, pr.labelLon], {
      pane:"pane-arealabel", interactive:true,
      icon: L.divIcon({ className:"",
        html:`<div class="area-label${leftAnchored?" area-label-l":""}" style="--ac:${pr.color}"><b>${esc(pr.name)}</b><span>${esc(pr.theme)}</span></div>`,
        iconSize:[160,0], iconAnchor: leftAnchored ? [0,10] : [80,10] })
    }).addTo(map);
    label.on("click", ()=> enterArea(pr.id));
    rec.label = label;
  });
}

const LABEL_LEFT = new Set(["イラオ火山灰層観察施設"]);   // ラベルをマーカーの左に出すサイト
function buildSiteCategory(name, def, gj){
  gj.features.forEach(f=>{
    const c = f.geometry.coordinates, p = f.properties;
    const rank = p["ランク"] || "";
    const m = L.marker([c[1], c[0]], { icon: markerIcon(name, rank), title: p.name, pane: catPane(def) });
    const o = { marker:m, cat:name, def, rank, area:p.area||null, name:p.name||"", props:p,
                hub:!!def.hub, viewpoint:null, labelSide: LABEL_LEFT.has(p.name) ? "left" : null };
    const small = name === "ジオサイト" && !GEO_BIG_RANKS.includes(rank);
    m.bindPopup(()=> pointPopup(o), { maxWidth:340, minWidth:300 });
    if (p.name) o.labelEl = makeLabel(def, p, m, small);   // ラベルタップでもポップアップ
    allMarkers.push(o);
  });
}

// 地図の目印（参照）：QGISの見た目。ポップアップは名前のみ、サイト扱いしない
function buildRefCategory(name, def, gj){
  gj.features.forEach(f=>{
    const c = f.geometry.coordinates, p = f.properties;
    const m = L.marker([c[1], c[0]], { icon: refIcon(name), title: p.name, pane: catPane(def) });
    const rec = { marker:m, cat:name, def };
    if (p.name) rec.labelEl = makeLabel(def, p);
    refMarkers.push(rec);
  });
}

// 視点アンカー（サイト名一致）にひも付け
function linkViewpoints(){
  AREAS.forEach(a=>{
    (a.viewpoints||[]).forEach(vp=>{
      const o = allMarkers.find(x=> x.name === vp.site);
      if (o){ o.viewpoint = vp; vp._marker = o.marker; }
      else console.warn("視点アンカー未発見:", a.name, vp.site);
    });
  });
}

// 完全に同一座標のマーカー（例：同じ場所に設置された複数の解説板）は
// ごくわずかに放射状へずらし、両方ともタップ・ラベル表示できるようにする
function spreadOverlaps(){
  const groups = {};
  allMarkers.forEach(o=>{
    const ll = o.marker.getLatLng();
    const k = ll.lat.toFixed(6)+","+ll.lng.toFixed(6);
    (groups[k] = groups[k] || []).push(o);
  });
  Object.values(groups).forEach(g=>{
    if (g.length < 2) return;
    const ll = g[0].marker.getLatLng();
    const R = 0.00005;                       // 約5m
    g.forEach((o,i)=>{
      const a = (2*Math.PI*i)/g.length - Math.PI/2;
      o.marker.setLatLng([ll.lat + R*Math.cos(a), ll.lng + R*Math.sin(a)]);
    });
  });
}

// エリアへ寄る＋サイドバーでそのエリアを開く
function enterArea(id){
  const a = areaById[id]; if(!a) return;
  map.flyToBounds(a.bounds.pad(0.15), { maxZoom:13, duration:.8 });
  openAreaCard(id);
  if (window.innerWidth<=760) document.getElementById("sidebar").classList.add("open");
}
function resetView(){
  // 範囲を中央に。陰影図の外は見せない（homeView がズーム・中心を決める）
  const h = homeView();
  map.flyTo(h.center, h.zoom, { duration:.8 });
  document.querySelectorAll(".area-card").forEach(el=> el.classList.remove("open"));
}

// 凡例：見どころの種類は SITE_GROUPS から生成（拠点施設に案内板を含む）
function siteLegendRows(){
  return SITE_GROUPS.map(g=>{
    const d = SITE_CATS[g.cats[0]];
    return `<div class="row"><span class="dot" style="background:${d.fill};box-shadow:0 0 0 1.5px ${d.outline||'#fff'}"></span>${esc(g.label)}</div>`;
  }).join("");
}
// 特徴的な地質の凡例（背景タイルの色・記号の意味。陰影と重なるため代表色で表示）
const GEO_LEGEND = [
  { type:"ellipse", label:"大陸のマグマの活動でできた古いカルデラ" },
  { type:"swatch", color:"#8b5fbf", label:"日本海のマグマの活動でできた火山岩や深成岩" },
  { type:"swatch", color:"#cf4436", label:"萩・阿武のマグマの活動でできた火山岩" },
];
function geoLegendRows(){
  return GEO_LEGEND.map(g=>{
    const mark = g.type==="ellipse"
      ? `<svg class="lg-mark" width="18" height="14" viewBox="0 0 18 14"><ellipse cx="9" cy="7" rx="7.5" ry="5" fill="none" stroke="#555" stroke-width="1.4" stroke-dasharray="3 2"/></svg>`
      : `<span class="dot" style="background:${g.color}"></span>`;
    return `<div class="row">${mark}<span>${esc(g.label)}</span></div>`;
  }).join("");
}

// ---- コントロール（右上：表示切替＋凡例。開閉式でスマホでも地図を隠さない） ----
function buildControls(){
  const ctrl = L.control({ position:"topright" });
  ctrl.onAdd = function(){
    const div = L.DomUtil.create("div", "layers-panel collapsed");   // 初期は凡例を畳んで非表示
    let body =
      `<div class="lp-sec">背景（大地の見方）</div>`+
      `<label><input type="checkbox" id="lp-veg" checked> 植生図</label>`+
      `<label><input type="checkbox" id="lp-geo" checked> 特徴的な地質</label>`+
      `<div class="lp-sec">地図の目印</div>`+
      Object.keys(REF_CATS).map(n=>
        `<label><input type="checkbox" class="lp-ref" data-cat="${n}" ${refOn[n]?"checked":""}> ${n}</label>`).join("");
    if (staff){
      body += `<div class="lp-sec">サイト種別（運営）</div>`+
        Object.keys(SITE_CATS).map(n=>
          `<label><input type="checkbox" class="lp-cat" data-cat="${n}" ${catOn[n]?"checked":""}> ${n}</label>`).join("");
    }
    body += `<div class="lp-sec">凡例</div>`+
      `<div class="lp-legend">`+
      `<div class="lp-hint">丸をタップすると詳細が開きます。</div>`+
      `<div class="lp-legend-sub">見どころの種類</div>${siteLegendRows()}`+
      `<div class="lp-legend-sub">特徴的な地質</div>${geoLegendRows()}`+
      `</div>`;
    div.innerHTML =
      `<div class="lp-head"><span>${staff?"表示・凡例（運営中）":"表示・凡例"}</span><span class="lp-caret">▼</span></div>`+
      `<div class="lp-body">${body}</div>`;
    div.querySelector(".lp-head").addEventListener("click", ()=> div.classList.toggle("collapsed"));
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  ctrl.addTo(map);

  document.getElementById("lp-veg").addEventListener("change", e=>{ vegOn=e.target.checked; updateBase(); });
  document.getElementById("lp-geo").addEventListener("change", e=>{ geoOn=e.target.checked; updateBase(); });
  document.querySelectorAll(".lp-cat").forEach(cb=>{
    cb.addEventListener("change", e=>{ catOn[e.target.dataset.cat]=e.target.checked; refresh(); });
  });
  document.querySelectorAll(".lp-ref").forEach(cb=>{
    cb.addEventListener("change", e=>{ refOn[e.target.dataset.cat]=e.target.checked; refresh(); });
  });

  L.control.scale({ imperial:false }).addTo(map);

  // ---- 右下：現在地ボタン ----
  const fab = L.control({ position:"bottomright" });
  fab.onAdd = function(){
    const d = L.DomUtil.create("div", "map-fab");
    d.innerHTML =
      `<button id="fab-locate" title="現在地" aria-label="現在地">`+
      `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">`+
      `<circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/>`+
      `<circle cx="12" cy="12" r="1.8" fill="currentColor"/>`+
      `<path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`+
      `</button>`;
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    return d;
  };
  // ＋－ズームを先に右下へ（右下スタックは後から追加した方が上に来る＝GPSが上・＋－が下）
  L.control.zoom({ position:"bottomright", zoomInTitle:"拡大", zoomOutTitle:"縮小" }).addTo(map);
  fab.addTo(map);
  document.getElementById("fab-locate").addEventListener("click", locateMe);
}

// ---- 現在地（GPS） ----
function fmtDist(m){
  if (m < 1000) return Math.round(m/10)*10 + "m";
  return (m/1000).toFixed(m < 10000 ? 1 : 0) + "km";
}
function showHere(ll, accuracy){
  if (!hereMarker){
    hereMarker = L.marker(ll, { interactive:false, zIndexOffset:1000,
      icon: L.divIcon({ className:"", html:'<div class="here-dot"></div>', iconSize:[18,18], iconAnchor:[9,9] }) }).addTo(map);
    hereCircle = L.circle(ll, { radius:accuracy, color:"#1a73e8", weight:1, opacity:.5,
      fillColor:"#1a73e8", fillOpacity:.12, interactive:false }).addTo(map);
  } else {
    hereMarker.setLatLng(ll); hereCircle.setLatLng(ll).setRadius(accuracy);
  }
}
function locateMe(){
  if (!navigator.geolocation){ toast("位置情報が使えません"); return; }
  const btn = document.getElementById("fab-locate");
  btn.classList.add("locating");
  navigator.geolocation.getCurrentPosition(pos=>{
    btn.classList.remove("locating");
    myLatLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    showHere(myLatLng, pos.coords.accuracy || 30);
    if (GEOPARK_BOUNDS.contains(myLatLng)){
      map.flyTo(myLatLng, 15, { duration:.8 });                    // 範囲内＝現在地へ寄る
    } else {
      const b = L.latLngBounds([MAINLAND_BOUNDS.getSouthWest(), MAINLAND_BOUNDS.getNorthEast()]).extend(myLatLng);
      map.flyToBounds(b.pad(0.12), { duration:.8 });               // 範囲外＝現在地とジオパークが両方入る
      toast("萩ジオパークの外にいます");
    }
    buildSidebar();                                                // 距離表示・近い順を反映
  }, err=>{
    btn.classList.remove("locating");
    toast("位置情報を取得できませんでした");
  }, { enableHighAccuracy:true, timeout:10000, maximumAge:30000 });
}

// ---- トースト通知（運営モード切替などの一瞬のフィードバック） ----
let _toastTimer = null;
function toast(msg){
  let el = document.querySelector(".map-toast");
  if (!el){ el = document.createElement("div"); el.className = "map-toast"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(_toastTimer); _toastTimer = setTimeout(()=> el.classList.remove("show"), 1800);
}

// ---- 運営モードの隠しトグル：ロゴ（#brand）の長押し（約0.7秒） ----
function toggleStaff(){
  staff = !staff;
  const u = new URL(location);
  if (staff) u.searchParams.set("all","1"); else u.searchParams.delete("all");
  sessionStorage.setItem("staffToast", staff ? "運営モード ON" : "運営モード OFF");
  location.assign(u.toString());   // パネル・一覧を作り直す（簡潔・確実）
}
(function bindLogoLongPress(){
  const brand = document.getElementById("brand");
  if (!brand) return;
  let timer = null;
  const start = ()=>{ clearTimeout(timer); timer = setTimeout(()=>{ timer=null; toggleStaff(); }, 3000); };
  const cancel = ()=>{ if (timer){ clearTimeout(timer); timer=null; } };
  brand.addEventListener("touchstart", start, { passive:true });
  brand.addEventListener("touchend", cancel);
  brand.addEventListener("touchmove", cancel);
  brand.addEventListener("mousedown", start);
  brand.addEventListener("mouseup", cancel);
  brand.addEventListener("mouseleave", cancel);
  brand.addEventListener("contextmenu", e=> e.preventDefault());
})();

// ---- サイドバー（エリア→分類→サイト） ----
const rankWeight = r => ({AA:0,A:1,B:2}[r] ?? 3);
// 見どころ一覧・凡例の分類の並び・見出し。1グループに複数カテゴリを含められる
// （拠点施設＝hubs＋案内板。データ上の「展望地」は「ビューポイント」と表示）
const SITE_GROUPS = [
  { label:"拠点施設",     cats:["拠点施設"] },
  { label:"ビューポイント", cats:["展望地"] },
  { label:"案内地図",     cats:["案内地図"] },
  { label:"解説板",       cats:["解説板"] },
  { label:"ジオサイト",    cats:["ジオサイト"] },
  { label:"文化サイト",    cats:["文化サイト"] },
  { label:"神社",         cats:["神社"] },
];
// 一覧の1項目（距離はGPS取得後のみ表示）
function makePoiItem(o){
  const li = document.createElement("li"); li.className="poi-item"; li.dataset.name=o.name;
  const rank = (staff && o.rank) ? `<span class="poi-rank rank-${o.rank}">${esc(o.rank)}</span>` : "";
  const dist = myLatLng ? `<span class="poi-dist">${fmtDist(myLatLng.distanceTo(o.marker.getLatLng()))}</span>` : "";
  li.innerHTML = `${rank}<span class="poi-dot" style="background:${SITE_CATS[o.cat].fill}"></span><span class="poi-name">${esc(o.name)}</span>${dist}`;
  li.onclick = ()=>{
    // そのサイトが地図に現れる倍率（QGIS縮尺依存の表示開始）まで寄せる。
    // 解説板など高倍率でしか出ないものも、タップすれば必ず表示＋ポップアップが開く
    const z = Math.min(map.getMaxZoom(), Math.max(14, Math.ceil(o.def.minZoom)));
    if (window.innerWidth<=760) document.getElementById("sidebar").classList.remove("open");
    map.flyTo(o.marker.getLatLng(), z, {duration:.7});
    map.once("moveend", ()=> o.marker.openPopup());
  };
  return li;
}
function buildSidebar(){
  const listEl = document.getElementById("poiList"); listEl.innerHTML = "";

  // 現在地取得後：近い順トグル
  if (myLatLng){
    const t = document.createElement("button");
    t.className = "near-toggle" + (nearSort ? " on" : "");
    t.textContent = nearSort ? "◂ エリア別に戻す" : "現在地から近い順に並べる";
    t.onclick = ()=>{ nearSort = !nearSort; buildSidebar(); };
    listEl.appendChild(t);
  }

  // 近い順モード：全サイトを距離順のフラットな一覧に
  if (nearSort && myLatLng){
    const items = allMarkers.filter(o=> catOn[o.cat] && siteEligible(o))
      .sort((x,y)=> myLatLng.distanceTo(x.marker.getLatLng()) - myLatLng.distanceTo(y.marker.getLatLng()));
    const ul = document.createElement("ul"); ul.className="site-list near-list";
    items.forEach(o=> ul.appendChild(makePoiItem(o)));
    listEl.appendChild(ul);
    return;
  }

  // 通常：エリア → 分類
  AREAS.forEach(a=>{
    const card = document.createElement("div"); card.className="area-card"; card.dataset.id=a.id;
    const head = document.createElement("div"); head.className="area-card-head";
    head.style.setProperty("--ac", a.color);
    head.innerHTML = `<b>${esc(a.name)}</b><span>${esc(a.theme)}</span>`;
    head.onclick = ()=> enterArea(a.id);
    card.appendChild(head);

    const body = document.createElement("div"); body.className="area-card-body";
    if (a.lead) body.innerHTML = `<p class="area-lead">${esc(a.lead)}</p>`;

    // サイト一覧を「分類ごと」に見出し付きで整理
    const inArea = allMarkers.filter(o=> o.area===a.id && siteEligible(o));
    SITE_GROUPS.forEach(g=>{
      const items = inArea.filter(o=> g.cats.includes(o.cat))
                          .sort((x,y)=> rankWeight(x.rank)-rankWeight(y.rank) || x.name.localeCompare(y.name,"ja"));
      if (!items.length) return;
      const gh = document.createElement("div"); gh.className="site-group-head";
      gh.innerHTML = `<span class="poi-dot" style="background:${SITE_CATS[g.cats[0]].fill}"></span>${esc(g.label)}`;
      body.appendChild(gh);
      const ul = document.createElement("ul"); ul.className="site-list";
      items.forEach(o=> ul.appendChild(makePoiItem(o)));
      body.appendChild(ul);
    });
    card.appendChild(body);
    listEl.appendChild(card);
  });
}
function openAreaCard(id){
  document.querySelectorAll(".area-card").forEach(el=> el.classList.toggle("open", el.dataset.id===id));
  const card = document.querySelector(`.area-card[data-id="${id}"]`);
  if (card) card.scrollIntoView({ behavior:"smooth", block:"start" });
}

// 検索（全カード横断）
document.getElementById("poiSearch").addEventListener("input", e=>{
  const q = e.target.value.trim().toLowerCase();
  if (q) document.querySelectorAll(".area-card").forEach(c=>c.classList.add("open"));
  document.querySelectorAll(".poi-item").forEach(li=>{
    li.style.display = li.dataset.name.toLowerCase().includes(q) ? "" : "none";
  });
});

// サイドバー開閉（スマホは下部シート、PCは左サイドバー）
const sidebar = document.getElementById("sidebar");
const isMobile = ()=> window.matchMedia("(max-width: 760px)").matches;
document.getElementById("sidebarToggle").onclick = ()=>{
  if (isMobile()){ sidebar.classList.toggle("open"); }
  else { document.body.classList.toggle("sb-hidden"); setTimeout(()=> map.invalidateSize(), 220); }  // PCは一覧の出し入れ
};
document.getElementById("sidebarClose").onclick = ()=> sidebar.classList.remove("open");
const sheetHandle = document.getElementById("sheetHandle");
if (sheetHandle) sheetHandle.onclick = ()=> sidebar.classList.toggle("open");
document.getElementById("resetView").onclick = resetView;   // 上部帯「全体」ボタン
map.on("click", ()=>{ if (isMobile()) sidebar.classList.remove("open"); });   // 地図タップでシートを閉じる
