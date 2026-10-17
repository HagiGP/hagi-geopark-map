/* 食と大地：萩ジオパークの産品と、それを育てた大地のつながり。
   タブを開くと地図は「産地の印」表示に切り替わり（見どころの印は隠す）、
   項目（または地図の印）をタップすると、地図がその産地へ寄って育てた大地を示す。
   データ：data/food.json（文章・産地・示す大地）、data/food_shapes.geojson（大地の範囲） */

const FOOD_TYPES = {   // 種類の色（日本の伝統色）：海＝藍、田畑＝松葉、果物＝柿、牛＝焦茶、加工品＝墨
  "海":   "#165e83",
  "田畑": "#42602d",
  "果物": "#c9601e",
  "牛":   "#6f4b3e",
  "加工品": "#3f3f3f",
};
let FOOD = [], foodShapes = {}, foodMode = false, foodOpenId = null, foodBuilt = false;
map.createPane("foodShapePane"); map.getPane("foodShapePane").style.zIndex = 420;
map.createPane("foodPinPane");   map.getPane("foodPinPane").style.zIndex = 680;
map.getPane("foodShapePane").style.pointerEvents = "none";
const foodPins = L.layerGroup();    // 産地の印（食と大地のタブを開いている間だけ地図に出す）
const foodMarks = L.layerGroup();   // 選んだ産品の大地・丸囲み・名札

Promise.all([
  fetch("data/food.json" + DATAV).then(r=> r.json()),
  fetch("data/food_shapes.geojson" + DATAV).then(r=> r.json()),
]).then(([items, gj])=>{
  FOOD = items;
  gj.features.forEach(f=> foodShapes[f.properties.id] = f);
  if (foodMode) buildFoodTab();   // 読み込み前にタブが開かれていた場合
  FOOD.forEach(it=>{
    const two = (it.seal || "").length > 1;   // 2字は縦書きの判子
    const m = L.marker(it.at, { pane:"foodPinPane", keyboard:false, title: it.title,
      icon: L.divIcon({ className:"", iconSize: two ? [30,48] : [34,34],
        // offset＝同じ場所の判子を画面上で左右にずらして並べる（px）
        iconAnchor: [(two ? 15 : 17) - (it.offset?.[0] || 0), (two ? 24 : 17) - (it.offset?.[1] || 0)],
        html:`<div class="food-pin${two ? " two" : ""}" style="--fc:${FOOD_TYPES[it.type] || "#666"}"><span>${esc(it.seal || it.icon)}</span></div>` }) });
    m.on("click", ()=>{ if (openTab !== "food") showTab("food", { pan:false }); openFood(it.id); });
    it.pin = m; m.addTo(foodPins);
  });
}).catch(e=> console.error("food load failed", e));

// 一覧（地域ごと。種類の札＋タイトル。タップでその場に開く）
function buildFoodTab(){
  if (!FOOD.length) return;
  foodBuilt = true;
  const sec = document.querySelector('#panel .tab[data-tab="food"]'); sec.innerHTML = "";
  const intro = document.createElement("p"); intro.className = "list-intro";
  intro.textContent = "萩ジオパークの食べものと、それを育てた大地のつながりを紹介しています。地図の印や名前をタップしてみてください。";
  sec.appendChild(intro);
  [...new Set(FOOD.map(it=> it.region))].forEach(region=>{
    const h = document.createElement("div"); h.className = "food-region"; h.textContent = region;
    sec.appendChild(h);
    FOOD.filter(it=> it.region === region).forEach(it=>{
      const card = document.createElement("div"); card.className = "food-item"; card.dataset.id = it.id;
      const head = document.createElement("div"); head.className = "food-head";
      head.innerHTML = `<span class="food-type" style="--fc:${FOOD_TYPES[it.type] || "#666"}">${esc(it.type)}</span>`+
                       `<span class="food-title">${esc(it.title)}</span>`;
      head.onclick = ()=> foodOpenId === it.id ? closeFood() : openFood(it.id);
      const body = document.createElement("div"); body.className = "food-body";
      body.innerHTML = `<p>${esc(it.text)}</p>`;
      const b = document.createElement("button"); b.className = "tour-start";   // 食の解説（字幕で地図を動かしながら）
      b.innerHTML = `<span class="ts-icon">▶</span>地図で解説を見る`;
      b.onclick = e=>{ e.stopPropagation(); startFoodTour(it.id); };
      body.appendChild(b);
      card.append(head, body); sec.appendChild(card);
    });
  });
}

// 産品を開く：一覧で開き、地図がその産地へ寄って、育てた大地を示す
function openFood(id){
  const it = FOOD.find(x=> x.id === id); if (!it) return;
  foodOpenId = id;
  document.querySelectorAll(".food-item").forEach(el=> el.classList.toggle("open", el.dataset.id === id));
  document.querySelector(`.food-item[data-id="${id}"]`)?.scrollIntoView({ behavior:"smooth", block:"nearest" });
  document.querySelectorAll(".food-pin").forEach(el=> el.classList.remove("on"));
  it.pin?.getElement()?.querySelector(".food-pin")?.classList.add("on");
  foodMarks.clearLayers();
  const b = L.latLngBounds([it.at]);
  (it.shape || []).forEach(sid=>{
    const f = foodShapes[sid]; if (!f) return;
    const lyr = L.geoJSON(f, { interactive:false, pane:"foodShapePane",
      style:{ color:"#ffc800", weight:3, dashArray:"8 6", fillColor:"#ffc800", fillOpacity:.38, className:"tour-shape" } }).addTo(foodMarks);
    b.extend(lyr.getBounds());
  });
  (it.ring || []).forEach(ll=>{
    L.marker(ll, { interactive:false, pane:"foodPinPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:[56,56], iconAnchor:[28,28], html:`<div class="tour-ring"></div>` }) }).addTo(foodMarks);
    b.extend(ll);
  });
  (it.label || []).forEach(lb=>{
    L.marker(lb.at, { interactive:false, pane:"foodPinPane", keyboard:false,
      icon:L.divIcon({ className:"", iconSize:null, iconAnchor:[0,0], html:`<div class="tour-label">${esc(lb.text)}</div>` }) }).addTo(foodMarks);
    b.extend(lb.at);
  });
  foodMarks.addTo(map);
  const [l, bot] = openTab ? panelCover() : [0, 0];
  map.flyToBounds(b.pad(0.15), { maxZoom:13.5, duration:.8, paddingTopLeft:[l + 30, 40], paddingBottomRight:[30, bot + 30] });
}
function closeFood(){
  foodOpenId = null;
  document.querySelectorAll(".food-item").forEach(el=> el.classList.remove("open"));
  document.querySelectorAll(".food-pin").forEach(el=> el.classList.remove("on"));
  foodMarks.clearLayers();
}

// 食と大地のタブを開いている間は、地図を「産地の印」表示に切り替える（見どころの印・名前は隠す）
function foodHidePanes(){
  return detailPanes().filter(p=> p !== "pane-place");   // 市町名は残す
}
function setFoodMode(on){
  if (on === foodMode) return;
  foodMode = on;
  if (on){
    if (!foodBuilt) buildFoodTab();   // 地域解説のデータ（解説ツアーの有無）がそろってから作る
    foodHidePanes().forEach(p=>{ const pn = map.getPane(p); if (pn) pn.style.display = "none"; });
    foodPins.addTo(map);
    if (FOOD.length && !foodOpenId){   // 開いたときは、20か所の産地の印がすべて見えるように（パネルの分をよける）
      const [l, bot] = panelCover();
      map.flyToBounds(L.latLngBounds(FOOD.map(it=> it.at)), { duration:.8, paddingTopLeft:[l + 30, 40], paddingBottomRight:[40, bot + 30] });
    }
  } else {
    if (!wideMode) foodHidePanes().forEach(p=>{ const pn = map.getPane(p); if (pn) pn.style.display = ""; });
    foodPins.remove(); closeFood();
  }
}
map.on("moveend", ()=>{   // 広域表示の切り替えなどで見どころが戻っても、食と大地の間は隠したまま
  if (foodMode) foodHidePanes().forEach(p=>{ const pn = map.getPane(p); if (pn) pn.style.display = "none"; });
});

// ---- 食の解説：解説文を1文ずつ場面にして、「産品 → なぜ → 大地」の順に地図を動かす ----
// 1場面目＝産地に寄って指差し／2場面目以降＝育てた大地を示す（最後の場面で名札も）
function startFoodTour(id){
  const it = FOOD.find(x=> x.id === id); if (!it) return;
  const land = (it.shape || []).concat(it.ring || []);
  if (it.scenes){   // 場面を書いてある品：字幕と地図の動き（矢印・名札など）はデータのとおり
    const out = it.scenes.map(sc=> ({ ...sc }));
    if (it.close) out.push({ text: it.close, fit:[it.at].concat(land), shape: it.shape || [], ring: it.ring || [], point: it.at, label: it.label || [] });
    beginTour({ name: it.title, tour: out }, foodShapes);
    return;
  }
  const sents = it.text.match(/[^。]+。?/g).map(s=> s.trim()).filter(Boolean);
  const scenes = []; let buf = "";
  sents.forEach(s=>{   // 短すぎる文は次の文とまとめる（1場面の字幕が細切れにならないように）
    buf = buf ? buf + "\n" + s : s;
    if (buf.replace(/\n/g, "").length >= 22){ scenes.push(buf); buf = ""; }
  });
  if (buf) scenes.length ? scenes[scenes.length - 1] += "\n" + buf : scenes.push(buf);
  const out = scenes.map((text, k)=>{
    if (k === 0) return { text, fit:[it.at, [it.at[0] + 0.02, it.at[1] + 0.03], [it.at[0] - 0.02, it.at[1] - 0.03]], point: it.at };
    const last = k === scenes.length - 1;
    return { text, fit:[it.at].concat(land.length ? land : []), shape: it.shape || [], ring: it.ring || [], point: it.at,
             label: last ? (it.label || []) : [] };
  });
  if (out.length === 1) Object.assign(out[0], { shape: it.shape || [], ring: it.ring || [], label: it.label || [], fit:[it.at].concat(land) });
  // 締めの場面：大地の恵みとしてまとめ、味わう・訪れる誘いで終える（大地を出したまま）
  if (it.close) out.push({ text: it.close, fit:[it.at].concat(land), shape: it.shape || [], ring: it.ring || [], point: it.at, label: it.label || [] });
  beginTour({ name: it.title, tour: out }, foodShapes);
}
