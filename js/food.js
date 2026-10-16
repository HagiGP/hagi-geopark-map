/* 食と大地：萩ジオパークの産品と、それを育てた大地のつながり。
   タブを開くと地図は「産地の印」表示に切り替わり（見どころの印は隠す）、
   項目（または地図の印）をタップすると、地図がその産地へ寄って育てた大地を示す。
   データ：data/food.json（文章・産地・示す大地）、data/food_shapes.geojson（大地の範囲） */

const FOOD_TYPES = {   // 種類の札の色
  "海":   "#1f78b4",
  "田畑": "#3f8f3a",
  "果物": "#e07b1a",
  "牛":   "#8a5a2b",
  "加工品": "#6b6b6b",
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
    const m = L.marker(it.at, { pane:"foodPinPane", keyboard:false, title: it.title,
      icon: L.divIcon({ className:"", iconSize:[34,34], iconAnchor:[17,17],
        html:`<div class="food-pin" style="--fc:${FOOD_TYPES[it.type] || "#666"}">${it.icon}</div>` }) });
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
      if (it.tour && areaById[it.tour] && (areaById[it.tour].tour || []).length){   // 地域解説の解説ツアーへ
        const b = document.createElement("button"); b.className = "tour-start";
        b.innerHTML = `<span class="ts-icon">▶</span>この大地の解説を見る`;
        b.onclick = e=>{ e.stopPropagation(); startTour(it.tour); };
        body.appendChild(b);
      }
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
