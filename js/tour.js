/* エリア解説ツアー：地図を動かし、指差し・囲み・溶岩流の線で示しながら、
   画面下の字幕（ファミコンRPG風のメッセージ窓）で大地と人のつながりを語る。
   台本は areas.geojson の各エリアの "tour"（場面の配列）、図形は data/tour_<エリアid>.geojson。
   場面のキー：
     text  字幕（改行で行を分ける）
     fit   地図に収めるもの（サイト名 or 図形id の配列）。省略時は前の場面の表示のまま
     shape 塗って示す図形id の配列（溶岩の範囲など）
     line  流れを描く線の図形id（アニメーションで描く）
     ring  丸で囲むサイト名の配列
     point 指差す（▼）サイト名
     label 地名ラベル [{ "text":"須佐湾", "at":[緯度,経度] }]
     photo 写真（サイト名 or 画像パス。false で出さない。省略時は point のサイトの写真）
   fit・ring などの名前の代わりに [緯度,経度] も使える
   操作：窓をタップ／→・Space・Enter・PageDown＝次へ、←・PageUp＝戻る、Esc＝終わる（講演のプレゼンリモコン対応） */

const tourShapes = {};            // エリアid → { 図形id: Leaflet用GeoJSON feature }
let tour = null;                  // 実行中のツアー { area, scenes, i, layer, typing }

function loadTourShapes(id){
  if (tourShapes[id]) return Promise.resolve(tourShapes[id]);
  return fetch(`data/tour_${id}.geojson${DATAV}`).then(r=> r.ok ? r.json() : {features:[]})
    .catch(()=>({features:[]}))
    .then(gj=>{ const m = {}; (gj.features||[]).forEach(f=> m[f.properties.id] = f); return tourShapes[id] = m; });
}

// ドット絵フォント（初回のみ読み込み）
function loadPixelFont(){
  if (document.getElementById("pixelFont")) return;
  const l = document.createElement("link"); l.id = "pixelFont"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=DotGothic16&display=swap";
  document.head.appendChild(l);
}
loadPixelFont();   // 「解説を見る」ボタンにも使うので最初に読む

function startTour(id){
  const a = areaById[id]; if (!a || !(a.tour||[]).length) return;
  loadPixelFont();
  loadTourShapes(id).then(shapes=>{
    if (tour) endTour();
    tour = { area:a, shapes, scenes:a.tour, i:0, layer:L.layerGroup().addTo(map),
             sbWasHidden: document.body.classList.contains("sb-hidden") };
    map.closePopup();
    document.body.classList.add("touring");
    if (!isMobile() && !tour.sbWasHidden){ document.body.classList.add("sb-hidden"); }
    sidebar.classList.remove("open");
    setTimeout(()=> map.invalidateSize(), 220);
    buildTourBox();
    // 写真を先読み（表示が速くなり、写真のある場面は地図をその分ずらして収められる）
    tour.photoOk = {};
    tour.scenes.forEach((sc,k)=>{ const ph = scenePhoto(sc); if (!ph) return;
      const im = new Image(); im.onload = ()=>{ if (tour) tour.photoOk[k] = true; }; im.src = ph.src; });
    setTimeout(()=> showScene(0), 240);
  });
}

function endTour(){
  if (!tour) return;
  stopTyping();
  tour.layer.remove();
  document.getElementById("tourBox")?.remove();
  hidePhoto();
  document.body.classList.remove("touring");
  if (!isMobile() && !tour.sbWasHidden){ document.body.classList.remove("sb-hidden"); setTimeout(()=> map.invalidateSize(), 220); }
  tour = null;
}

function buildTourBox(){
  document.getElementById("tourBox")?.remove();
  const box = document.createElement("div"); box.id = "tourBox";
  box.innerHTML =
    `<div class="tb-head"><span class="tb-title"></span><span class="tb-count"></span>`+
    `<button class="tb-close" aria-label="解説を終わる">✕</button></div>`+
    `<div class="tb-text" aria-live="polite"></div>`+
    `<div class="tb-nav"><button class="tb-prev">◀ もどる</button><span class="tb-next">▼</span></div>`;
  document.body.appendChild(box);
  box.querySelector(".tb-title").textContent = tour.area.name;
  box.querySelector(".tb-close").onclick = e=>{ e.stopPropagation(); endTour(); };
  box.querySelector(".tb-prev").onclick = e=>{ e.stopPropagation(); prevScene(); };
  box.onclick = ()=> nextScene();
  L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
}

function nextScene(){
  if (!tour) return;
  if (tour.typing){ finishTyping(); return; }   // 文字送り中は全文を出すだけ
  if (tour.i < tour.scenes.length-1) showScene(tour.i+1);
  else endTour();
}
function prevScene(){ if (tour && tour.i > 0) showScene(tour.i-1); }

document.addEventListener("keydown", e=>{
  if (!tour) return;
  if (["ArrowRight"," ","Enter","PageDown"].includes(e.key)){ e.preventDefault(); nextScene(); }
  else if (["ArrowLeft","PageUp","Backspace"].includes(e.key)){ e.preventDefault(); prevScene(); }
  else if (e.key === "Escape"){ endTour(); }
});

// 名前（サイト名 or 図形id）→ 位置・範囲
function tourTarget(name){
  if (Array.isArray(name)) return L.latLng(name[0], name[1]);   // [緯度, 経度] の直接指定
  const f = tour.shapes[name];
  if (f) return L.geoJSON(f).getBounds();
  const o = allMarkers.find(x=> x.name === name);
  if (o) return o.marker.getLatLng();
  console.warn("解説：見つからない名前", name);
  return null;
}

function showScene(i){
  const sc = tour.scenes[i]; tour.i = i;
  const box = document.getElementById("tourBox");
  box.querySelector(".tb-count").textContent = `${i+1}／${tour.scenes.length}`;
  box.querySelector(".tb-prev").style.visibility = i ? "visible" : "hidden";
  box.classList.toggle("last", i === tour.scenes.length-1);
  tour.layer.clearLayers(); tour._drawn = -1;

  // 地図の表示（字幕の窓の高さぶん下を空ける）
  if (sc.fit && sc.fit.length){
    const b = L.latLngBounds([]);
    sc.fit.forEach(n=>{ const t = tourTarget(n); if (t) b.extend(t); });
    if (b.isValid()){
      const padB = box.offsetHeight + 60;   // 字幕の窓＋名札・矢じりが窓に隠れないぶん
      // 写真の窓のぶんも空ける（PC＝右下、スマホ＝字幕の上）
      const padR = tour.photoOk[i] && !isMobile() ? 340 : 40;
      const padB2 = tour.photoOk[i] && isMobile() ? padB + 170 : padB;
      tour.target = [b, { paddingTopLeft:[50,80], paddingBottomRight:[padR,padB2], maxZoom:14 }];
      map.flyToBounds(b, { ...tour.target[1], duration:1.0 });
    }
  }
  else tour.target = null;
  hidePhoto();
  const t0 = Date.now();
  const draw = ()=>{
    if (!tour || tour.i !== i) return;
    // 移動・ズームの途中なら止まってから描く。2.5秒たっても終わらなければ打ち切って描く
    if (map._animatingZoom || map._flyToFrame){
      if (Date.now() - t0 < 2500){ setTimeout(draw, 150); return; }
      map.stop();   // 飛行が終わらない（端末が重い・画面が裏にある等）→ 目的の表示へ一気に移す
      if (tour.target) map.fitBounds(tour.target[0], { ...tour.target[1], animate:false });
    }
    if (tour._drawn === i) return;   // moveend と保険のタイマーの二重実行を防ぐ
    drawSceneMarks(sc); showPhoto(sc, i);
    tour._drawn = i;
  };
  map.once("moveend", draw); setTimeout(draw, 1150);   // 移動後に描く（移動しない場面の保険）
  typeText(sc.text || "");
}

// ---- 写真の窓 ----
// "photo"：サイト名（img/sites/<名前>.jpg）か画像のパス。false で出さない。
// 省略時は指差し(point)のサイトに写真があれば自動で出す。写真が無ければ何も出さない
function scenePhoto(sc){
  if (sc.photo === false) return null;
  const p = sc.photo || sc.point; if (!p) return null;
  const isPath = /[\/.]/.test(p) && /\.(jpe?g|png|webp)$/i.test(p);
  return { src: isPath ? p : photoSrc(p), caption: sc.photoCaption || (isPath ? "" : p) };
}
function hidePhoto(){ document.querySelectorAll("#tourPhoto").forEach(el=> el.remove()); }
function showPhoto(sc, i){
  const ph = scenePhoto(sc); if (!ph) return;
  const img = new Image();
  img.onload = ()=>{
    if (!tour || tour.i !== i) return;
    hidePhoto();
    const w = document.createElement("figure"); w.id = "tourPhoto";
    w.innerHTML = `<img alt="">`+(ph.caption ? `<figcaption></figcaption>` : "");
    w.querySelector("img").src = ph.src;
    if (ph.caption) w.querySelector("figcaption").textContent = ph.caption;
    w.style.bottom = (document.getElementById("tourBox").offsetHeight + 30) + "px";
    w.onclick = e=>{ e.stopPropagation(); w.classList.toggle("big"); };   // タップで拡大／戻す
    L.DomEvent.disableClickPropagation(w);
    document.body.appendChild(w);
  };
  img.src = ph.src;   // 読めなければ（写真未登録）何も出さない
}

function drawSceneMarks(sc){
  (sc.shape||[]).forEach(id=>{
    const f = tour.shapes[id]; if (!f) return;
    const color = f.properties.color || "#d9481c";   // 既定は溶岩の赤橙
    const pr = f.properties, outline = pr.outline !== false;   // 図形ごとに濃さ・枠線を変えられる
    L.geoJSON(f, { interactive:false, pane:"tourShapePane",
      style:{ color, weight: outline ? 3 : 0, dashArray:"8 6", fillColor:color, fillOpacity: pr.fillOpacity ?? .28,
              className: outline ? "tour-shape" : "" } }).addTo(tour.layer);
  });
  if (sc.line && tour.shapes[sc.line]){
    const ln = L.geoJSON(tour.shapes[sc.line], { interactive:false, pane:"tourShapePane",
      style:{ color:"#b3200f", weight:6, opacity:.95, lineCap:"round", className:"tour-line" } }).addTo(tour.layer);
    ln.eachLayer(l=>{   // 線を始点から描き、先端の矢じりを一緒に進める
      const p = l.getElement(); if (!p) return;
      const along = lineSampler(l.getLatLngs());
      const head = arrowMarker(along(0), 44).addTo(tour.layer);
      const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
      const D = 3200, t0 = performance.now(), sceneNo = tour.i;
      const ease = t=> t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
      const finish = ()=>{
        if (!tour || tour.i !== sceneNo || head._done) return; head._done = true;
        // 描き終えたら破線指定を外す（途中でズームされて長さが変わっても、確実に全体が見えるように）
        p.style.strokeDasharray = ""; p.style.strokeDashoffset = "";
        setArrow(head, along(1));
        [.25,.5,.75].forEach(f=> arrowMarker(along(f), 30).addTo(tour.layer));   // 途中にも向きを示す矢じり
      };
      const step = now=>{
        if (!tour || tour.i !== sceneNo || head._done) return;
        const e = ease(Math.min(1, (now - t0) / D));
        p.style.strokeDashoffset = len * (1 - e);
        setArrow(head, along(e));
        if (e < 1) requestAnimationFrame(step); else finish();
      };
      requestAnimationFrame(step);
      setTimeout(finish, D + 300);   // 画面が裏にある等で描画が止まっても最後は必ず完成形に
    });
  }
  (sc.ring||[]).forEach(n=>{   // サイト名 or [緯度,経度]
    const ll = Array.isArray(n) ? L.latLng(n[0], n[1]) : allMarkers.find(x=> x.name === n)?.marker.getLatLng();
    if (!ll) return;
    L.marker(ll, { interactive:false, pane:"tourPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:[56,56], iconAnchor:[28,28], html:`<div class="tour-ring"></div>` }) }).addTo(tour.layer);
  });
  (sc.label||[]).forEach(lb=>{   // 地名ラベル（例：{"text":"須佐湾","at":[34.628,131.594]}）
    L.marker(lb.at, { interactive:false, pane:"tourPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:null, iconAnchor:[0,0], html:`<div class="tour-label">${esc(lb.text)}</div>` }) }).addTo(tour.layer);
  });
  if (sc.point){
    const o = allMarkers.find(x=> x.name === sc.point);
    if (o) L.marker(o.marker.getLatLng(), { interactive:false, pane:"tourPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:[36,36], iconAnchor:[18,46], html:`<div class="tour-point">${POINTER_SVG}</div>` }) }).addTo(tour.layer);
  }
}

// 線上の位置（0〜1）→ { latlng, deg（進行方向。画面上の角度） }
function lineSampler(lls){
  lls = lls.flat ? lls.flat(Infinity) : lls;
  const z = map.getZoom(), pts = lls.map(ll=> map.project(ll, z));
  const cum = [0]; for (let k=1; k<pts.length; k++) cum.push(cum[k-1] + pts[k].distanceTo(pts[k-1]));
  const total = cum[cum.length-1] || 1;
  return f=>{
    const d = Math.max(0, Math.min(1, f)) * total;
    let k = 1; while (k < pts.length-1 && cum[k] < d) k++;
    const a = pts[k-1], b = pts[k], seg = (cum[k]-cum[k-1]) || 1, r = (d - cum[k-1]) / seg;
    const pt = L.point(a.x + (b.x-a.x)*r, a.y + (b.y-a.y)*r);
    return { latlng: map.unproject(pt, z), deg: Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI };
  };
}
// 矢じり（右向きの三角を進行方向へ回す。白縁で地図の上でも見える）
function arrowMarker(pos, size){
  const m = L.marker(pos.latlng, { interactive:false, pane:"tourPane", keyboard:false,
    icon: L.divIcon({ className:"", iconSize:[size,size], iconAnchor:[size/2,size/2],
      html:`<div class="tour-arrow" style="transform:rotate(${pos.deg}deg)"><svg viewBox="0 0 20 20" width="${size}" height="${size}">`+
           `<path d="M3 3 L18 10 L3 17 L7 10 Z" fill="#b3200f" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg></div>` }) });
  return m;
}
function setArrow(m, pos){
  m.setLatLng(pos.latlng);
  const el = m.getElement()?.querySelector(".tour-arrow"); if (el) el.style.transform = `rotate(${pos.deg}deg)`;
}

// ドット絵の▼カーソル（8×8マスを拡大。にじまないよう crispEdges）
const POINTER_SVG = (()=>{
  const rows = ["11111111","12222221","12222221","01222210","00122100","00122100","00011000","00011000"];
  let r = "";
  rows.forEach((row,y)=> [...row].forEach((c,x)=>{
    if (c !== "0") r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c==="1"?"#000":"#fff"}"/>`;
  }));
  return `<svg viewBox="0 0 8 8" width="36" height="36" shape-rendering="crispEdges">${r}</svg>`;
})();

// 文字送り（1文字ずつ）。タップで全文。動きを減らす設定なら最初から全文
function stopTyping(){ if (tour && tour.typing){ clearInterval(tour.typing); tour.typing = null; } }
function finishTyping(){
  stopTyping();
  const el = document.querySelector("#tourBox .tb-text"); if (el) el.textContent = tour.fullText;
  document.getElementById("tourBox")?.classList.remove("typing");
}
function typeText(text){
  stopTyping();
  const el = document.querySelector("#tourBox .tb-text"); tour.fullText = text;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches){ el.textContent = text; return; }
  el.textContent = ""; let n = 0;
  document.getElementById("tourBox").classList.add("typing");
  tour.typing = setInterval(()=>{
    n++; el.textContent = text.slice(0, n);
    if (n >= text.length) finishTyping();
  }, 45);
}

// 図形（溶岩の範囲・流れの線）は背景の上・サイトの下、指差し・囲みはサイトの上
map.createPane("tourShapePane"); map.getPane("tourShapePane").style.zIndex = 420;
map.createPane("tourPane"); map.getPane("tourPane").style.zIndex = 690;
["tourShapePane","tourPane"].forEach(n=> map.getPane(n).style.pointerEvents = "none");
