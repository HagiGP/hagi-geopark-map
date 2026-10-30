/* エリア解説ツアー：地図を動かし、指差し・囲み・溶岩流の線で示しながら、
   画面下の字幕（ファミコンRPG風のメッセージ窓）で大地と人のつながりを語る。
   台本は areas.geojson の各エリアの "tour"（場面の配列）、図形は data/tour_<エリアid>.geojson。
   場面のキー：
     text  字幕（改行で行を分ける）
     fit   地図に収めるもの（サイト名 or 図形id の配列）。省略時は前の場面の表示のまま
     shape 塗って示す図形id の配列（溶岩の範囲など）。shapeOpacity で塗りの濃さを場面ごとに上書き
     line  流れを描く線の図形id（アニメーションで描く）。配列で複数本も可。配列の配列なら組ごとに順番に描く
     ring  丸で囲むサイト名の配列
     blink 点滅させるサイト名の配列（大地の成り立ちの最後：そのステージのジオサイトを地図で光らせる）
     point 指差す（▼）サイト名（points＝何か所も指差す [[緯度,経度], …]）
     label 地名ラベル [{ "text":"須佐湾", "at":[緯度,経度] }]（"align":"right"＝at が名札の右端、"left"＝左端）
     followLine true なら、line の組ごとに地図がその組の範囲へ移って描く（長い流れを寄りぎみに見せる）。mfollowLine はスマホのときだけ
     mfit スマホ（縦長の狭い画面）のときに寄せる範囲（無ければ fit）
     noPan true なら、収まらなくてもスライドしない（全体が入る倍率のまま）
     keepInside true なら、陰影図の外をできるだけ出さない。photoAt：PCの写真の窓の隅（"tl" "bl" など）
     padL：PCで地図の左をこの幅(px)空け、見せたい所を右寄りに置く（陰影図の無い東側を画面の外へ）
     syncLines true なら、同じ組の矢印を同じ速さ（同時に着く）で描く
     photo 写真（サイト名 or 画像パス。false で出さない。省略時は point のサイトの写真）
     flyDur 地図の移動にかける秒数（既定1秒。遠くへ移る場面をゆっくりに）
     figure 図の画像パス。地図は動かさず、画面の真ん中に大きく出す（付加体のでき方など、地図で見せる必要のない場面）
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
  // 最後に、その地域の大地とつながる文化サイトをまとめて点滅させる場面を足す（つながりのデータがあれば。js/links.js）
  const fin = typeof areaLinkScene === "function" ? areaLinkScene(a) : null;
  loadTourShapes(id).then(shapes=> beginTour(fin ? { ...a, tour: a.tour.concat([fin]) } : a, shapes));
}
// 陰影図（GEOPARK_BOUNDS）の外が画面に出ないよう、ズームの下限と中心を調整する（homeView と同じ考え方）
// hideBottom：画面の下のこの高さ(px)は字幕の窓に隠れて見えないので、陰影図の外になってもよい（スマホ：窓が横幅いっぱい）
function keepInsideTiles(center, zoom, keepZoom, hideBottom = 0){
  const z = keepZoom ? zoom : Math.max(zoom, map.getBoundsZoom(GEOPARK_BOUNDS, true) + 0.05);
  const half = map.getSize().divideBy(2), PAD = 2;
  const nw = map.project(GEOPARK_BOUNDS.getNorthWest(), z), se = map.project(GEOPARK_BOUNDS.getSouthEast(), z);
  const c = map.project(center, z);
  const cl = (v, lo, hi)=> lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
  c.x = cl(c.x, nw.x + half.x + PAD, se.x - half.x - PAD);
  c.y = cl(c.y, nw.y + half.y + PAD, se.y - half.y - PAD + hideBottom);
  return [map.unproject(c, z), z];
}
// 萩ジオパーク全体の概要の解説（data/tour_overview.geojson に図形と場面をまとめてある）
function startOverviewTour(){
  fetch(`data/tour_overview.geojson${DATAV}`).then(r=> r.json()).then(gj=>{
    const m = {}; (gj.features || []).forEach(f=> m[f.properties.id] = f);
    beginTour({ name: gj.name || "萩ジオパークの概要", tour: gj.tour || [] }, m);
    if (tour) tour.keepInside = true;   // 概要の解説は、陰影図の外を出さない
  }).catch(e=> console.error("overview tour load failed", e));
}
// 点滅の色：解説の色が無ければ（地域の解説の最後）、その見どころの印の色
const blinkColor = n=> SITE_CATS[allMarkers.find(x=> x.name === n)?.cat]?.fill || "#ffd84a";
// 大地の成り立ちの解説（4本：南の海／大陸のマグマ／日本海のマグマ／萩・阿武のマグマ）。場面と図形は data/tour_stages.geojson
let stageData = null;
function loadStages(){
  return stageData ? Promise.resolve(stageData) : fetch(`data/tour_stages.geojson${DATAV}`).then(r=> r.json()).then(gj=>{
    const m = {}; (gj.features || []).forEach(f=> m[f.properties.id] = f);
    return stageData = { tours: gj.tours || [], shapes: m };
  });
}
function startStageTour(id){
  loadStages().then(d=>{
    const t = d.tours.find(x=> x.id === id); if (!t) return;
    beginTour({ name: t.name, tour: t.tour }, d.shapes);
    if (tour) tour.color = t.color;   // 点滅の色
  }).catch(e=> console.error("stage tour load failed", e));
}
// 解説を始める。a＝{ name（字幕の窓の見出し）, tour（場面の配列） }、shapes＝{ 図形id: GeoJSON feature }
function beginTour(a, shapes){
  loadPixelFont();
  {
    if (tour) endTour();
    tour = { area:a, shapes, scenes:a.tour, i:0, layer:L.layerGroup().addTo(map), keep:{}, keepLayer:L.layerGroup().addTo(map),
             prevTab: openTab,   // 解説の前に開いていたタブ（終わったら戻す）
             limits: { minZoom: map.getMinZoom(), maxBounds: map.options.maxBounds } };   // ふだんの最小倍率・表示範囲（地理院地図の場面のあと戻す）
    map.closePopup();
    document.body.classList.add("touring");
    refresh();   // 広域表示を解除（解説中は詳細表示のまま）
    closeTab({ pan:false });   // 解説で地図を動かすので、パネルを閉じるときのずらしはしない
    map.invalidateSize();   // メニューの帯を隠して地図を全面に
    buildTourBox();
    // 写真を先読み（表示が速くなり、写真のある場面は地図をその分ずらして収められる）
    tour.photoOk = {}; tour.photoSize = {};
    tour.scenes.forEach((sc,k)=>{ const ph = scenePhoto(sc); if (!ph) return;
      const im = new Image(); im.onload = ()=>{ if (tour){ tour.photoOk[k] = true; tour.photoSize[k] = [im.naturalWidth, im.naturalHeight]; } }; im.src = ph.src; });
    setTimeout(()=> showScene(0), 240);
  }
}

function endTour(){
  if (!tour) return;
  stopTyping(); document.body.classList.remove("tour-norange");
  tour.layer.remove(); tour.keepLayer.remove();
  Object.values(tour.keep).forEach(g=> g._dead = true);
  document.getElementById("tourBox")?.remove();
  hidePhoto(); document.getElementById("tourFigure")?.remove();
  map.setMinZoom(tour.limits.minZoom); map.setMaxBounds(tour.limits.maxBounds);
  tourGSI = false;
  document.body.classList.remove("touring");
  refresh();
  map.invalidateSize();
  if (tour.prevTab) showTab(tour.prevTab);
  tour = null;
}

function buildTourBox(){
  document.getElementById("tourBox")?.remove();
  const box = document.createElement("div"); box.id = "tourBox";
  box.innerHTML =
    `<div class="tb-head"><span class="tb-title"></span><span class="tb-count"></span>`+
    `<button class="tb-sound" aria-label="文字の音"></button>`+
    `<button class="tb-close" aria-label="解説を終わる">✕</button></div>`+
    `<div class="tb-text" aria-live="polite"></div>`+
    `<div class="tb-nav"><button class="tb-prev">◀ もどる</button><span class="tb-next">▼</span></div>`;
  document.body.appendChild(box);
  box.querySelector(".tb-title").textContent = tour.area.name;
  box.querySelector(".tb-close").onclick = e=>{ e.stopPropagation(); endTour(); };
  const sb = box.querySelector(".tb-sound"), showSound = ()=>{ sb.textContent = soundOn() ? "🔊" : "🔇"; sb.title = soundOn() ? "文字の音：あり" : "文字の音：なし"; };
  showSound();
  sb.onclick = e=>{ e.stopPropagation(); setSound(!soundOn()); showSound(); if (soundOn()) blip(true); };
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

// 全体が入る倍率がこれより低い（引きすぎ）ときだけ、ここまで寄せてスライドする。スマホは画面が小さく、同じ倍率でも見える範囲が狭いので低め
const panComfortZoom = ()=> isMobile() ? 10.4 : 11;
const PAN_MAX_ZOOM = 1;   // そのとき、全体が入る倍率から最大どれだけ寄せるか
const MOB_PHOTO_TOP = 52 + 8, MOB_PHOTO_FRAME = 46;   // スマホの写真の窓（上部）：ヘッダー＋余白の下に、写真＋枠・見出し（CSSと合わせる）
const MOB_MAP_MIN = 300;   // スマホで写真を出しても、地図にこれだけの高さは残す
// スマホの写真の高さ：画面が低い端末では写真を縮め、それでも地図が狭くなるなら写真を出さない（0）
function mobPhotoImgH(){
  const box = document.getElementById("tourBox"), room = innerHeight - MOB_PHOTO_TOP - MOB_PHOTO_FRAME - 12 - ((box ? box.offsetHeight : 160) + 36);
  const h = Math.min(150, room - MOB_MAP_MIN);
  return h >= 70 ? Math.round(h) : 0;
}
const labelsOf = sc=> (isMobile() && sc.mlabel) || sc.label || [];   // 名札（スマホは mlabel があればそちら：寄せた範囲の中に置き直したもの）
const follows = sc=> sc.followLine || (isMobile() && sc.mfollowLine);   // カメラが矢印を追う場面か

function showScene(i){
  const sc = tour.scenes[i]; tour.i = i;
  document.body.classList.toggle("tour-norange", !!sc.noRange);   // noRange：範囲の線を出さない場面
  if (tourGSI !== !!sc.gsi){ tourGSI = !!sc.gsi; refresh(); }   // gsi:true の場面は陰影・植生を出さず地理院地図だけ
  // 地理院地図の場面は、日本海全体なども見せられるよう、ふだんの最小倍率・表示範囲の制限をゆるめる
  if (sc.gsi){ map.setMaxBounds(null); map.setMinZoom(5); }
  else if (tour.limits){ map.setMinZoom(tour.limits.minZoom); map.setMaxBounds(tour.limits.maxBounds); }
  const box = document.getElementById("tourBox");
  box.querySelector(".tb-count").textContent = `${i+1}／${tour.scenes.length}`;
  box.querySelector(".tb-prev").style.visibility = i ? "visible" : "hidden";
  box.classList.toggle("last", i === tour.scenes.length-1);
  tour.layer.clearLayers(); tour._drawn = -1;
  // 次の場面にも出る図形・矢印は消さずに持ち越す（例：火山を出したまま湖を塗る）
  const next = new Set([...(sc.shape||[]).map(id=> shapeKey(sc, id)), ...[].concat(sc.line||[]).flat().map(id=> "l:"+id)]);
  // 次の場面に出ない図形・矢印は、新しい図形を描くのと同時に消す（地図の移動中は前の場面のまま）
  const leaving = Object.keys(tour.keep).filter(k=> !next.has(k));
  const dropLeaving = ()=> leaving.forEach(k=>{ const g = tour.keep[k]; if (!g) return; g._dead = true; g.remove(); delete tour.keep[k]; });

  // 地図の表示：画面から字幕の窓・写真の窓を除いた「見せる範囲」の真ん中に、目的の場所を置く。
  // 全体を入れると引きすぎる場面は、少し寄せて、端から端へゆっくりスライドする（寄ったまま全体を見せる）
  const mob = isMobile(), fit = (mob && sc.mfit) || sc.fit;
  tour.pan = null; tour.photoPos = "";
  if (fit && fit.length){
    const b = L.latLngBounds([]);
    fit.forEach(n=>{ const t = tourTarget(n); if (t) b.extend(t); });
    if (!follows(sc) && !(mob && sc.mfit)) labelsOf(sc).filter(lb=> !lb.nofit).forEach(lb=> b.extend(lb.at));   // 名札も画面に入れる（矢印を追う場面・スマホ用の範囲・nofit の名札は除く）
    if (b.isValid()){
      const hasPhoto = tour.photoOk[i] && (!mob || mobPhotoImgH() > 0), size = map.getSize();
      // 「見せる範囲」＝画面から、字幕の窓（下）・写真の窓・名札が切れないぶん（左右）を除いた所
      const padB = box.offsetHeight + (mob ? 36 : 44);   // 字幕の窓＋名札・矢じりが窓にかからないぶん
      const base = { pos:"", t: mob ? 64 : 80, l: mob ? 44 : (sc.padL || 50), r: mob ? 44 : 40, b: padB };
      let cands = [base], corners = null;
      if (hasPhoto && mob) cands = [{ ...base, pos:"top", t: MOB_PHOTO_TOP + mobPhotoImgH() + MOB_PHOTO_FRAME + 12 }];   // スマホ：写真は上部
      else if (hasPhoto){
        // PCの写真の窓は四隅のどこかに置ける。地図は写真をよけてずらさず、字幕の窓の上の範囲の真ん中に合わせ、
        // 写真は見せたい場所と重ならない隅（どこも重なるなら、重なりのいちばん小さい隅）へ
        const ph = photoHeight(sc, i), pw = photoWidth(sc), side = Math.max(PC_PHOTO.m(), (innerWidth - box.offsetWidth) / 2), m = PC_PHOTO.m(), top = PC_PHOTO.top();
        const lowTop = size.y - (box.offsetHeight + 30) - ph;   // 下の写真の窓の上端
        corners = {   // 写真の窓を置ける四隅（画面上の四角。placePhoto の置き方と合わせる）
          br: [size.x - side - pw, lowTop, size.x - side, lowTop + ph],
          bl: [side, lowTop, side + pw, lowTop + ph],
          tr: [size.x - m - pw, top, size.x - m, top + ph],
          tl: [m, top, m + pw, top + ph],
        };
        // 地図はそのまま写真の窓を重ねる案と、写真の窓の列を地図からよける案（四隅それぞれ）を比べ、
        // 見せたい所が写真に隠れず、いちばん大きく見せられるものを選ぶ
        const col = p=> ({ ...base, pos:p, ...(p[1] === "l" ? { l: (p[0] === "b" ? side : m) + pw + 30 } : { r: (p[0] === "b" ? side : m) + pw + 30 }) });
        cands = [{ ...base, pos:"auto" }, ...["tl", "tr", "bl", "br"].map(col)];
        if (sc.photoAt) cands = [col(sc.photoAt)];   // photoAt：写真の窓をこの隅に置き、地図はその横（列）を除いた範囲に合わせる
      }
      const p0 = map.project(b.getNorthWest(), 0), p1 = map.project(b.getSouthEast(), 0);
      // 写真の窓と重ねたくないもの＝この場面で実際に描くもの（指差し・図形・矢印・丸・名札）。無ければ範囲全体
      const focus = L.latLngBounds([]);
      [].concat(sc.point ? [sc.point] : [], sc.points || [], sc.shape || [], [].concat(sc.line || []).flat(), sc.ring || [], labelsOf(sc).filter(lb=> !lb.nofit).map(lb=> lb.at))
        .forEach(n=>{ const t = tourTarget(n); if (t) focus.extend(t); });
      if (!focus.isValid()) focus.extend(b);
      // ある見せる範囲 a で、どの倍率・中心にするか（スライドするなら行き先も）と、その良さ
      const inside = (tour.keepInside || sc.keepInside) && !sc.gsi;   // 陰影図の外を出さない（概要の解説、keepInside の場面）
      const plan = (a, bump = 0)=>{
        const aw = Math.max(size.x - a.l - a.r, 80), ah = Math.max(size.y - a.t - a.b, 80);
        const zW = Math.log2(aw / Math.max(p1.x - p0.x, 1e-6)), zH = Math.log2(ah / Math.max(p1.y - p0.y, 1e-6));
        const zFit = Math.min(zW, zH, 14);
        // ふだんは全体が入る倍率。全体を入れると引きすぎる（panComfortZoom 未満）場面だけ、少し寄せてスライドする
        let z = zFit;
        if (!follows(sc) && !sc.gsi && !sc.noPan && zFit < panComfortZoom() - 0.25) z = Math.min(panComfortZoom(), zFit + PAN_MAX_ZOOM);
        z = Math.min(14, z + bump);
        if (inside) z = Math.max(z, map.getBoundsZoom(GEOPARK_BOUNDS, true) + 0.05);   // 陰影図の外を出さない倍率まで
        const off = L.point((a.l + size.x - a.r) / 2 - size.x / 2, (a.t + size.y - a.b) / 2 - size.y / 2);   // 見せる範囲の中心のずれ
        const nw = map.project(b.getNorthWest(), z), se = map.project(b.getSouthEast(), z), mid = nw.add(se).divideBy(2);
        const at = p=> map.unproject(p.subtract(off), z);   // 地図上の点 p を「見せる範囲」の真ん中に置くときの中心
        const overX = (se.x - nw.x) - aw, overY = (se.y - nw.y) - ah;
        let from = mid, to = null;
        if (!follows(sc) && !sc.noPan && (overX > 8 || overY > 8)){   // 収まらない向き（斜めなら両方）に、端から端へ（noPan の場面はスライドしない）
          // 矢印のある場面は、矢印の出発点の側から始める（矢印の流れと同じ向きに動く）。無ければ西→東・北→南
          const l0 = [].concat(sc.line || []).flat()[0], g = l0 && tour.shapes[l0]?.geometry;
          const c = g && (g.type === "LineString" ? g.coordinates[0] : g.type === "MultiLineString" ? g.coordinates[0][0] : null);
          const anc = c ? map.project([c[1], c[0]], z) : null;
          const ends = (lo, hi, v)=> v != null && Math.abs(v - lo) > Math.abs(v - hi) ? [hi, lo] : [lo, hi];
          const [fx, tx] = overX > 8 ? ends(nw.x + aw / 2, se.x - aw / 2, anc?.x) : [mid.x, mid.x];
          let [fy, ty] = overY > 8 ? ends(nw.y + ah / 2, se.y - ah / 2, anc?.y) : [mid.y, mid.y];
          if (!anc && overX > 8 && overY > 8){   // 斜め：見せたい地点が右上がりに並ぶなら南西→北東、右下がりなら北西→南東
            const pts = fit.concat(labelsOf(sc).map(lb=> lb.at)).map(n=> tourTarget(n)).filter(Boolean)
              .map(x=> map.project(x.getCenter ? x.getCenter() : x, z));
            const mx = pts.reduce((s, q)=> s + q.x, 0) / pts.length, my = pts.reduce((s, q)=> s + q.y, 0) / pts.length;
            if (pts.reduce((s, q)=> s + (q.x - mx) * (q.y - my), 0) < 0) [fy, ty] = [ty, fy];   // 右上がり：南から始める
          }
          from = L.point(fx, fy); to = L.point(tx, ty);
        }
        // スライドが小さすぎる（はみ出しがわずか）なら、スライドせずに真ん中に合わせる（はみ出しを両側に振り分ける）
        if (to && map.project(at(from), z).distanceTo(map.project(at(to), z)) <= 60){ from = mid; to = null; }
        let c0 = at(from), c1 = to ? at(to) : null;
        const hide = mob ? box.offsetHeight + 4 : 0;   // スマホは字幕の窓の裏（横幅いっぱい）なら陰影図の外でも見えない
        if (inside){ c0 = keepInsideTiles(c0, z, true, hide)[0]; if (c1) c1 = keepInsideTiles(c1, z, true, hide)[0]; }
        // 良さ：陰影図の端で中心を寄せられず、見せたい場所が真ん中からずれるほど減点。大きく見せられるほど加点
        const d = (c, p)=> map.project(c, z).distanceTo(map.project(at(p), z));
        const shift = d(c0, from) + (c1 ? d(c1, to) : 0);   // スライドの始まり・終わりそれぞれで、端に止められた分
        // 見せたい範囲が画面のどこに来るか（スライドするなら始まりと終わりを合わせた範囲）
        const fn = map.project(focus.getNorthWest(), z), fs = map.project(focus.getSouthEast(), z);
        const scr = c=>{ const o = map.project(c, z).subtract(size.divideBy(2)); return [fn.x - o.x - 24, fn.y - o.y - 24, fs.x - o.x + 24, fs.y - o.y + 24]; };
        const r0 = scr(c0), r1 = c1 ? scr(c1) : r0;
        const rect = [Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), Math.max(r0[2], r1[2]), Math.max(r0[3], r1[3])];
        let pos = a.pos, score = zFit * 120 - shift;
        if (corners){
          const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2, M = 10;
          const over = q=> Math.max(0, Math.min(q[2] + M, rect[2]) - Math.max(q[0] - M, rect[0])) * Math.max(0, Math.min(q[3] + M, rect[3]) - Math.max(q[1] - M, rect[1]));
          const far = q=> Math.hypot((q[0] + q[2]) / 2 - cx, (q[1] + q[3]) / 2 - cy);
          // auto：見せたい範囲との重なりがいちばん小さい隅（同じなら、いちばん離れた隅）
          if (pos === "auto") pos = Object.entries(corners).sort(([, p], [, q])=> over(p) - over(q) || far(q) - far(p))[0][0];
          const ov = over(corners[pos]);
          if (ov > 0) score -= 300 + ov / 40;   // 見せたい所が写真に隠れる案は大きく減点
        }
        return { a: { ...a, pos }, aw, ah, z, c0, c1, shift, score };
      };
      let P = cands.map(a=> plan(a)).sort((x, y)=> y.score - x.score)[0];
      // 陰影図の端に近くて真ん中に置けないときは、少し寄せると置けることがある（寄せた分は必要ならスライド）
      if (P.shift > 150 && !follows(sc) && !sc.gsi && !sc.noPan){
        const Q = [0.5, 1, 1.5].map(k=> plan(P.a, k)).sort((x, y)=> x.shift - y.shift)[0];
        if (Q.shift < P.shift * 0.6) P = Q;
      }
      const { z, c0, c1, a:A } = P;
      tour.photoPos = A.pos;
      tour.target = [b, { paddingTopLeft:[A.l, A.t], paddingBottomRight:[A.r, A.b], maxZoom:14 }];
      const dist = c1 ? map.project(c0, z).distanceTo(map.project(c1, z)) : 0;
      if (dist > 60) tour.pan = { to:c1, z, dist };   // ごく小さな動きはスライドしない
      tour.view = [c0, z];
      map.flyTo(c0, z, { duration: sc.flyDur || 1.0 });   // flyDur：遠くへ移る場面は、ゆっくり（秒）
    }
  }
  else { tour.target = null; tour.view = null; }
  // 次の場面も同じ写真なら、消さずに出したままにする（出たり消えたりをくり返さない）
  const cur = document.getElementById("tourPhoto"), nextPh = scenePhoto(sc);
  if (!(cur && nextPh && cur.dataset.src === nextPh.src && !(mob && !mobPhotoImgH()))) hidePhoto();
  showFigure(sc);
  const t0 = Date.now();
  const draw = ()=>{
    if (!tour || tour.i !== i) return;
    // 移動・ズームの途中なら止まってから描く。2.5秒たっても終わらなければ打ち切って描く
    if (map._animatingZoom || map._flyToFrame){
      if (Date.now() - t0 < Math.max(2500, (sc.flyDur || 0) * 1000 + 600)){ setTimeout(draw, 150); return; }
      map.stop();   // 飛行が終わらない（端末が重い・画面が裏にある等）→ 目的の表示へ一気に移す
      if (tour.view) map.setView(tour.view[0], tour.view[1], { animate:false });
    }
    if (tour._drawn === i) return;   // moveend と保険のタイマーの二重実行を防ぐ
    dropLeaving(); drawSceneMarks(sc); showPhoto(sc, i);
    tour._drawn = i;
    if (tour.pan) setTimeout(()=>{   // 図形・名札が出てから、スライド（約150px/秒、2〜6秒）
      if (!tour || tour.i !== i || !tour.pan) return;
      map.panTo(tour.pan.to, { animate:true, duration: Math.min(6, Math.max(2, tour.pan.dist / 150)), easeLinearity:1 });
    }, 1200);
  };
  map.once("moveend", draw); setTimeout(draw, 1150);   // 移動後に描く（移動しない場面の保険）
  typeText(sc.text || "");
}

// ---- 写真の窓 ----
// "photo"：サイト名（img/sites/<名前>.jpg）か画像のパス。false で出さない。
// 省略時は指差し(point)のサイトに写真があれば自動で出す。写真が無ければ何も出さない
function scenePhoto(sc){
  if (sc.photo === false) return null;
  const p = sc.photo || (typeof sc.point === "string" ? sc.point : null); if (!p) return null;
  const isPath = /[\/.]/.test(p) && /\.(jpe?g|png|webp|svg)(\?.*)?$/i.test(p);   // 末尾の ?p=… （写真の版）も許す
  return { src: isPath ? p : photoSrc(p), caption: sc.photoCaption || (isPath ? "" : p), diagram: /^img\/tour\//.test(p), focus: sc.photoFocus || "" };   // img/tour/ の図（模式図）は切り取らず全体を見せる
}
// PCの写真の窓：画面の大きさに合わせて大きく（幅は画面の約3分の1、300〜760px。写真の高さは画面の半分まで）。端からの余白も画面に合わせる
const clampN = (v, lo, hi)=> Math.min(hi, Math.max(lo, v));
const PC_PHOTO = { w: ()=> Math.round(clampN(innerWidth * 0.33, 300, 760)), maxH: ()=> Math.round(clampN(innerHeight * 0.5, 220, 560)),
                   m: ()=> Math.round(clampN(innerWidth * 0.02, 12, 36)), top: ()=> 58 + Math.round(clampN(innerWidth * 0.02, 12, 36)) };
const photoWidth = sc=> scenePhoto(sc)?.diagram ? Math.min(900, Math.round(PC_PHOTO.w() * 1.2)) : PC_PHOTO.w();   // 模式図は少し大きめ
// PCの写真の窓の高さ（枠の内側の幅に縮めた写真。写真は PC_PHOTO.maxH まで、模式図は全体＋見出しの行）
function photoHeight(sc, i){
  const ph = scenePhoto(sc), [w, h] = tour.photoSize[i] || [4, 3], inner = photoWidth(sc) - 16;
  const imgH = ph?.diagram ? inner * h / w : Math.min(PC_PHOTO.maxH(), inner * h / w);
  return imgH + 14 + (ph?.caption ? 24 : 0);
}
function hidePhoto(){ document.querySelectorAll("#tourPhoto").forEach(el=> el.remove()); }
// figure：地図で見せる必要のない場面の図（模式図）を、画面の真ん中に大きく出す（地図は動かさず、うすく暗くする）
function showFigure(sc){
  document.getElementById("tourFigure")?.remove();
  if (!sc || !sc.figure || !tour) return;
  const w = document.createElement("div"); w.id = "tourFigure";
  const fb = document.getElementById("tourBox").offsetHeight + 30;   // 字幕の窓の上の空きに収める
  w.style.bottom = fb + "px";
  w.innerHTML = `<figure><img alt=""></figure>`;
  const img = w.querySelector("img"); img.src = sc.figure;
  img.style.maxHeight = Math.max(160, innerHeight - 64 - fb - 40) + "px";
  document.body.appendChild(w);
}
// PC：場面ごとに選んだ隅（showScene の見せる範囲の選び方と合わせる）。下の隅は字幕の窓の上、上の隅はヘッダーの下
function placePhoto(w){
  const pos = tour.photoPos || "br", boxEl = document.getElementById("tourBox"), m = PC_PHOTO.m();
  const side = Math.max(m, (innerWidth - boxEl.offsetWidth) / 2);
  w.style.top = w.style.bottom = w.style.left = w.style.right = "";
  w.style.width = (w.classList.contains("diagram") ? Math.min(900, Math.round(PC_PHOTO.w() * 1.2)) : PC_PHOTO.w()) + "px";
  const img = w.querySelector("img"); if (img && !w.classList.contains("diagram")) img.style.maxHeight = PC_PHOTO.maxH() + "px";
  if (pos[0] === "b") w.style.bottom = (boxEl.offsetHeight + 30) + "px"; else w.style.top = PC_PHOTO.top() + "px";
  if (pos[1] === "l"){ w.style.left = (pos[0] === "b" ? side : m) + "px"; w.style.right = "auto"; }
  else w.style.right = (pos[0] === "b" ? side : m) + "px";
}
function showPhoto(sc, i){
  const ph = scenePhoto(sc); if (!ph) return;
  if (isMobile() && !mobPhotoImgH()) return;   // 画面の低いスマホ：地図を優先して写真は出さない
  const cur = document.getElementById("tourPhoto");
  if (cur && cur.dataset.src === ph.src){   // 前の場面と同じ写真：出したまま（見出しと、PCは置く隅だけ合わせる）
    const fc = cur.querySelector("figcaption"); if (fc && ph.caption) fc.textContent = ph.caption;
    if (!isMobile()) placePhoto(cur);
    return;
  }
  const img = new Image();
  img.onload = ()=>{
    if (!tour || tour.i !== i) return;
    hidePhoto();
    const w = document.createElement("figure"); w.id = "tourPhoto"; if (ph.diagram) w.className = "diagram";
    w.innerHTML = `<img alt="">`+(ph.caption ? `<figcaption></figcaption>` : "");
    w.querySelector("img").src = ph.src; w.dataset.src = ph.src;
    if (ph.focus) w.querySelector("img").style.objectPosition = ph.focus;   // photoFocus：横長の窓で切れる写真の見せる位置
    if (ph.caption) w.querySelector("figcaption").textContent = ph.caption;
    if (isMobile()){ w.classList.add("top"); w.style.setProperty("--mph", mobPhotoImgH() + "px"); }   // スマホ：上部に写真（タップで大きく）。地図は下の残りで、必要ならスライドして見せる
    else placePhoto(w);
    w.onclick = e=>{ e.stopPropagation(); w.classList.toggle("big"); };   // タップで拡大／戻す
    L.DomEvent.disableClickPropagation(w);
    document.body.appendChild(w);
  };
  img.src = ph.src;   // 読めなければ（写真未登録）何も出さない
}

function drawSceneMarks(sc){
  // shapeSteps：矢印を描き終えてから、組ごとに順に出す図形（例：[["火山"],["湖"]]＝川の矢印→火山→湖）。
  //   名札も step:番号 で同じ組と一緒に出せる。"-id" と書くと、その矢印・図形をそこで消す（例："-下流"＝せき止められた先の川）
  // hideAfterLine：矢印の組（1から数える）を描き終えたところで消す図形・矢印（例：{"1": ["湖"]}＝水が抜けて湖が消える）
  const steps = (sc.shapeSteps || []).map(g=> [].concat(g)), later = new Set(steps.flat());
  (sc.shape||[]).filter(id=> !later.has(id)).forEach(id=> addTourShape(sc, id));
  // 線は配列の配列で「組」に分けると、組ごとに順番に描く（例：[["本流"],["支流A","支流B"]]）
  const sceneNo = tour.i;
  const delay = drawSceneLines(sc, (gi, at)=>{
    const ids = (sc.hideAfterLine || {})[gi + 1]; if (!ids) return;
    setTimeout(()=>{ if (tour && tour.i === sceneNo) ids.forEach(id=> fadeTourItem(sc, id)); }, at + 300);
  });
  steps.forEach((g, k)=> setTimeout(()=>{
    if (!tour || tour.i !== sceneNo) return;
    g.forEach(id=>{
      if (id.startsWith("-")) fadeTourItem(sc, id.slice(1));   // "-id"：消す
      else if (id.startsWith("=")){   // "=id"：矢印を描き終えた形で一瞬で出す（長い矢印の一部だけを残すときなど）
        const lid = id.slice(1); if (!tour.shapes[lid] || tour.keep["l:" + lid]) return;
        drawArrowLine(lid, 0, tour.keep["l:" + lid] = L.layerGroup().addTo(tour.keepLayer), true);
      }
      else addTourShape(sc, id);
    });
    labelsOf(sc).filter(lb=> lb.step === k + 1).forEach(addTourLabel);
  }, delay + 500 + k * 1500));
  const RING = isMobile() ? 30 : 56;   // 丸の大きさ（CSS の .tour-ring と合わせる。スマホは小さく）
  // 見どころを示すときは、ふだんの地図と同じ印（色の丸）と名前で出す（解説のあと、地図で「さっきの場所」を探してタップしやすいように）。
  // サイト名でなく座標のときは、120m以内の見どころがあればその印。無ければ、これまでどおり丸・点滅・指差し
  const named = new Set(labelsOf(sc).map(lb=> lb.text)), boxes = [];
  const siteOf = n=>{
    if (!Array.isArray(n)) return allMarkers.find(x=> x.name === n) || null;
    const ll = L.latLng(n[0], n[1]); let best = null, bd = 120;
    allMarkers.forEach(o=>{ if (!SITE_CATS[o.cat] || o.cat === "山名" || o.cat === "公共施設") return; const d = ll.distanceTo(o.marker.getLatLng()); if (d < bd){ bd = d; best = o; } });
    return best;
  };
  tour.siteMarks = [];
  const siteMark = (o, delay = 0, opt = {})=>{
    const ll = o.marker.getLatLng(); tour.siteMarks.push(ll);
    const icon = o.def && SITE_CATS[o.cat] ? markerIcon(o.cat, o.rank) : o.marker.options.icon;
    L.marker(ll, { interactive:false, pane:"tourPane", keyboard:false, icon:L.divIcon({ ...icon.options,
      html:`<div class="tour-site" style="animation-delay:${delay}s">${icon.options.html}</div>` }) }).addTo(tour.layer);
    if (named.has(o.name)) return; named.add(o.name);
    // 名前：丸の右（ふだんの地図と同じ）。先に置いた名前と重なるなら左、それも重なるなら下へずらす
    // 印と名前は、ふだんの地図より大きく（SITE_SCALE 倍・名前は16px）
    const px = map.latLngToContainerPoint(ll), r = (o.def?.msize || 3) * PX_MM / 2 * SITE_SCALE + 4, w = 16 * [...o.name].length + 6, h = 21;
    const fits = b=> !boxes.some(q=> b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
    let side = "r", dy = 0, b = [px.x + r, px.y - h / 2, px.x + r + w, px.y + h / 2];
    if (!fits(b)){ const bl = [px.x - r - w, px.y - h / 2, px.x - r, px.y + h / 2]; if (fits(bl)){ side = "l"; b = bl; } }
    while (!fits(b) && dy < 80){ dy += h; b = [b[0], b[1] + h, b[2], b[3] + h]; }
    if (!fits(b) && opt.crowd) return;   // たくさん出す場面（allSites）で置き場所が無い名前は、印だけ
    boxes.push(b);
    const key = isGeoSmall(o) ? "geosm" : (o.def?.key || "geo");
    L.marker(ll, { interactive:false, pane:"tourPane", keyboard:false, icon:L.divIcon({ className:"", iconSize:null, iconAnchor:[0,0],
      html:`<div class="poi-label tour-site-label lbl-${key}" style="transform:translate(${side === "r" ? r + "px" : `calc(-100% - ${r}px)`},calc(-50% + ${dy}px));animation-delay:${delay}s"><span class="ln">${esc(o.name)}</span></div>` }) }).addTo(tour.layer);
  };
  // 見どころでない場所の名前（丸・指差しの下）
  const placeName = (n, dy, delay = 0)=>{
    if (Array.isArray(n) || named.has(n)) return; named.add(n);
    const ll = allMarkers.find(x=> x.name === n)?.marker.getLatLng(); if (!ll) return;
    if (labelsOf(sc).some(lb=> ll.distanceTo(lb.at) < 400)) return;
    L.marker(ll, { interactive:false, pane:"tourPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:null, iconAnchor:[0,0],
        html:`<div class="tour-site-name" style="transform:translate(-50%,${dy}px);animation-delay:${delay}s">${esc(n)}</div>` }) }).addTo(tour.layer);
  };
  (sc.ring||[]).forEach(n=>{   // サイト名 or [緯度,経度]
    const o = siteOf(n); if (o) return siteMark(o);
    const ll = Array.isArray(n) ? L.latLng(n[0], n[1]) : null; if (!ll) return;
    L.marker(ll, { interactive:false, pane:"tourPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:[RING,RING], iconAnchor:[RING/2,RING/2], html:`<div class="tour-ring"></div>` }) }).addTo(tour.layer);
  });
  // allSites：その種類の見どころをすべて、印と名前で（例："ジオサイト"）。名前は置ける所だけ（ランクの高い順に）
  if (sc.allSites) allMarkers.filter(o=> o.cat === sc.allSites && map.getBounds().pad(0.2).contains(o.marker.getLatLng()))
    .sort((a, b)=> labelPrio(b) - labelPrio(a)).forEach((o, k)=> siteMark(o, (k * 0.02).toFixed(2), { crowd:true }));
  // 点滅（解説の最後など）：見どころは、ふだんの印と名前がひとつずつ現れる。見どころでない所は黄色い丸
  (sc.blink||[]).forEach((n, k)=>{
    const d = (k * 0.15).toFixed(2), o = siteOf(n); if (o) return siteMark(o, d);
    const ll = Array.isArray(n) ? L.latLng(n[0], n[1]) : null; if (!ll) return;
    L.marker(ll, { interactive:false, pane:"tourPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:[RING,RING], iconAnchor:[RING/2,RING/2], html:`<div class="tour-ring blink" style="animation-delay:${d}s,${d}s"></div>` }) }).addTo(tour.layer);
  });
  // point＝1か所（サイト名 or [緯度,経度]）、points＝何か所も。見どころはふだんの印と名前、そうでない所は指差し
  [].concat(sc.point ? [sc.point] : [], sc.points || []).forEach(p=>{
    const o = siteOf(p); if (o) return siteMark(o);
    const ll = Array.isArray(p) ? L.latLng(p[0], p[1]) : null; if (!ll) return;
    L.marker(ll, { interactive:false, pane:"tourPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:[36,36], iconAnchor:[18,46], html:`<div class="tour-point">${POINTER_SVG}</div>` }) }).addTo(tour.layer);
    placeName(p, 4);
  });
  labelsOf(sc).filter(lb=> !lb.step).forEach(addTourLabel);   // 地名ラベル（例：{"text":"須佐湾","at":[34.628,131.594]}）
}
const SITE_SCALE = 1.5;   // 解説で示す見どころの印の大きさ（ふだんの地図の何倍か。CSS の .tour-site と合わせる）
const ALIGN = { right:"translate(-100%,-50%)", left:"translate(0,-50%)" };   // 既定は at が名札の真ん中
function addTourLabel(lb){
  if ((tour.siteMarks || []).some(ll=> ll.distanceTo(lb.at) < 250)) return;   // 見どころの印と名前を出した所には、名札を重ねない
  L.marker(lb.at, { interactive:false, pane:"tourPane", keyboard:false,
    icon:L.divIcon({ className:"", iconSize:null, iconAnchor:[0,0],
      html:`<div class="tour-label"${ALIGN[lb.align] ? ` style="transform:${ALIGN[lb.align]}"` : ""}>${esc(lb.text)}</div>` }) }).addTo(tour.layer);
}
function addTourShape(sc, id){
  const f = tour.shapes[id]; if (!f) return;
  const key = shapeKey(sc, id); if (tour.keep[key]) return;
  const grp = tour.keep[key] = L.layerGroup().addTo(tour.keepLayer);
  const color = f.properties.color || "#d9481c";   // 既定は溶岩の赤橙
  const pr = f.properties, outline = pr.outline !== false;   // 図形ごとに濃さ・枠線を変えられる
  L.geoJSON(f, { interactive:false, pane:"tourShapePane", renderer:tourRenderer,
    style:{ color, weight: outline ? (pr.weight || 3) : 0, dashArray: pr.dash === false ? null : "8 6", fillColor:color, fillOpacity: sc.shapeOpacity ?? pr.fillOpacity ?? .28,
            className: outline ? "tour-shape" : "" } }).addTo(grp);
}
// 解説の図形・矢印を、ふっと消す（湖の水が抜けた、川がせき止められた、など）
function fadeTourItem(sc, id){
  const key = tour.keep["l:" + id] ? "l:" + id : shapeKey(sc, id), grp = tour.keep[key]; if (!grp) return;
  const els = [];
  const collect = l=>{ if (l.eachLayer) l.eachLayer(collect); const el = l.getElement?.(); if (el) els.push(el); };
  collect(grp);
  els.forEach(el=>{ el.style.transition = "opacity 1.4s"; el.style.opacity = "0"; });
  delete tour.keep[key];
  setTimeout(()=>{ grp._dead = true; grp.remove(); }, 1500);
}
// 矢印を組ごとに順に描く。描き終わるまでの時間(ms)を返す。onGroup(組の番号, その組を描き終える時刻) を組ごとに呼ぶ
function drawSceneLines(sc, onGroup){
  const groups = [].concat(sc.line || []).some(Array.isArray)
    ? sc.line.map(g=> [].concat(g)) : [[].concat(sc.line || [])];
  let delay = 0;
  groups.forEach((g, gi)=>{
    let dur = 0;
    if (follows(sc) && gi > 0){   // カメラが矢印を追う：次の組の範囲（＋名札）へ移ってから描く
      const b = L.latLngBounds([]);
      g.forEach(id=>{ const t = tourTarget(id); if (t) b.extend(t); });
      labelsOf(sc).forEach(lb=>{ if (b.pad(0.3).contains(lb.at)) b.extend(lb.at); });
      const sceneNo = tour.i;
      const opts = { ...(tour.target?.[1] || {}) };   // 見せる範囲（padL の場面は左を空けて右寄りに）
      setTimeout(()=>{
        if (!tour || tour.i !== sceneNo || !b.isValid()) return;
        let { center, zoom } = map._getBoundsCenterZoom(b, opts);
        if (sc.keepInside) center = keepInsideTiles(center, zoom, true)[0];   // 陰影図の外を出さない
        map.flyTo(center, zoom, { duration:1.2 });
      }, delay);
      setTimeout(()=>{   // 移動が終わっていなければ（端末が重い等）目的の範囲へ一気に移す
        if (tour && tour.i === sceneNo && (map._flyToFrame || map._animatingZoom)){ map.stop(); map.fitBounds(b, { ...opts, animate:false }); }
      }, delay + 1350);
      delay += 1400;
    }
    g.filter(id=> tour.shapes[id] && !tour.keep["l:"+id]).forEach(id=>{
      const grp = tour.keep["l:"+id] = L.layerGroup().addTo(tour.keepLayer);
      dur = Math.max(dur, drawArrowLine(id, delay, grp, false, sc.syncLines && g.length > 1 ? 3200 : 0));
    });
    delay += dur;
    onGroup?.(gi, delay);
  });
  return delay;
}

const shapeKey = (sc, id)=> `s:${id}:${sc.shapeOpacity ?? ""}`;   // 濃さが変わる場面では描き直す

// 線を始点から描き、先端の矢じりを一緒に進める。delay ms 後に描き始め、描き終わるまでの時間(ms)を返す
function drawArrowLine(id, delay, grp, instant, fixedD){
  const lc = tour.shapes[id].properties.color || "#b3200f";   // 線の色（既定は赤。川は青など）
  const ln = L.geoJSON(tour.shapes[id], { interactive:false, pane:"tourShapePane", renderer:tourRenderer,
    style:{ color:lc, weight:6, opacity:.95, lineCap:"round", className:"tour-line" } }).addTo(grp);
  let total = 0;
  ln.eachLayer(l=>{
    const p = l.getElement(); if (!p) return;
    const along = lineSampler(l.getLatLngs());
    const short = along.px < 260;   // 短い矢印（季節風など）は小さめ・途中の矢じりなし
    p.style.strokeDasharray = 1e6; p.style.strokeDashoffset = 1e6;   // 描き始めるまで隠す
    const D = instant ? 1 : fixedD || (short ? 1400 : 3200), sceneNo = tour.i; total = Math.max(total, D);
    const ease = t=> t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
    setTimeout(()=>{
      if (!tour || grp._dead) return;
      const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len;   // 描き始める時点の長さ
      const head = arrowMarker(along(0), short ? 34 : 44, lc).addTo(grp), t0 = performance.now();
      const finish = ()=>{
        if (!tour || grp._dead || head._done) return; head._done = true;
        // 描き終えたら破線指定を外す（途中でズームされて長さが変わっても、確実に全体が見えるように）
        p.style.strokeDasharray = ""; p.style.strokeDashoffset = "";
        setArrow(head, along(1));
        if (!short) [.25,.5,.75].forEach(f=> arrowMarker(along(f), 30, lc).addTo(grp));   // 途中にも向きを示す矢じり
      };
      const step = now=>{
        if (!tour || grp._dead || head._done) return;
        const e = ease(Math.min(1, (now - t0) / D));
        p.style.strokeDashoffset = len * (1 - e);
        setArrow(head, along(e));
        if (e < 1) requestAnimationFrame(step); else finish();
      };
      requestAnimationFrame(step);
      setTimeout(finish, D + 300);   // 画面が裏にある等で描画が止まっても最後は必ず完成形に
    }, delay);
  });
  return total;
}

// 線上の位置（0〜1）→ { latlng, deg（進行方向。画面上の角度） }
function lineSampler(lls){
  lls = lls.flat ? lls.flat(Infinity) : lls;
  const z = map.getZoom(), pts = lls.map(ll=> map.project(ll, z));
  const cum = [0]; for (let k=1; k<pts.length; k++) cum.push(cum[k-1] + pts[k].distanceTo(pts[k-1]));
  const total = cum[cum.length-1] || 1;
  const fn = f=>{
    const d = Math.max(0, Math.min(1, f)) * total;
    let k = 1; while (k < pts.length-1 && cum[k] < d) k++;
    const a = pts[k-1], b = pts[k], seg = (cum[k]-cum[k-1]) || 1, r = (d - cum[k-1]) / seg;
    const pt = L.point(a.x + (b.x-a.x)*r, a.y + (b.y-a.y)*r);
    return { latlng: map.unproject(pt, z), deg: Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI };
  };
  fn.px = total; return fn;
}
// 矢じり（右向きの三角を進行方向へ回す。白縁で地図の上でも見える）
function arrowMarker(pos, size, color = "#b3200f"){
  const m = L.marker(pos.latlng, { interactive:false, pane:"tourPane", keyboard:false,
    icon: L.divIcon({ className:"", iconSize:[size,size], iconAnchor:[size/2,size/2],
      html:`<div class="tour-arrow" style="transform:rotate(${pos.deg}deg)"><svg viewBox="0 0 20 20" width="${size}" height="${size}">`+
           `<path d="M3 3 L18 10 L3 17 L7 10 Z" fill="${color}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg></div>` }) });
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
// ---- 文字送りの音（ピロピロ）：音声ファイルは使わず、その場で短い電子音を作る。最初は音なし（字幕の窓の🔇で切り替え、端末に覚える） ----
let tourAudio = null;
function soundOn(){ try { return localStorage.getItem("hagiTourSound") === "1"; } catch(e){ return false; } }
function setSound(on){ try { localStorage.setItem("hagiTourSound", on ? "1" : "0"); } catch(e){} }
// 短い電子音を1つ鳴らす（f＝高さHz、at＝何秒後、len＝長さ秒）
function tone(f, at = 0, len = 0.045, vol = 0.14){
  if (!tourAudio) tourAudio = new (window.AudioContext || window.webkitAudioContext)();
  if (tourAudio.state === "suspended") tourAudio.resume();
  const ctx = tourAudio, t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "square"; o.frequency.value = f;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + len + 0.01);
}
function blip(force){   // 文字送りの音（少しずつ高さを変えて、機械的になりすぎないように）
  if (!force && !soundOn()) return;
  try { tone(440 + Math.random() * 80); } catch(e){}
}
function typeText(text){
  stopTyping();
  const el = document.querySelector("#tourBox .tb-text"); tour.fullText = text;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches){ el.textContent = text; return; }
  el.textContent = ""; let n = 0;
  document.getElementById("tourBox").classList.add("typing");
  tour.typing = setInterval(()=>{
    n++; el.textContent = text.slice(0, n);
    if (n % 2 && !/\s/.test(text[n - 1])) blip();   // 2文字に1回、ピッと鳴らす（音ありのときだけ）
    if (n >= text.length) finishTyping();
  }, 45);
}

// 図形（溶岩の範囲・流れの線）は背景の上・サイトの下、指差し・囲みはサイトの上
map.createPane("tourShapePane"); map.getPane("tourShapePane").style.zIndex = 420;
// 解説の図形・矢印は画面の外まで広めに描いておく（ゆっくりスライドする途中で、図形が欠けて見えないように）
const tourRenderer = L.svg({ pane:"tourShapePane", padding:1.2 });
map.createPane("tourPane"); map.getPane("tourPane").style.zIndex = 690;
["tourShapePane","tourPane"].forEach(n=> map.getPane(n).style.pointerEvents = "none");
