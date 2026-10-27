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
    const n = [...(it.seal || "")].length, two = n > 1;   // 2字以上は縦書きの判子（字数に合わせて縦に長く）
    const h = two ? 14 + n * 16 : 34;
    const m = L.marker(it.at, { pane:"foodPinPane", keyboard:false, title: it.title,
      icon: L.divIcon({ className:"", iconSize: two ? [30,h] : [34,34],
        // offset＝同じ場所の判子を画面上で左右にずらして並べる（px）
        iconAnchor: [(two ? 15 : 17) - (it.offset?.[0] || 0), h / 2 - (it.offset?.[1] || 0)],
        html:`<div class="food-pin${two ? " two" : ""}" style="--fc:${FOOD_TYPES[it.type] || "#666"};${two ? `height:${h}px` : ""}"><span>${esc(it.seal || it.icon)}</span></div>` }) });
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
  intro.textContent = "萩の食べものと、それを育てた大地のつながりを紹介しています。地図の印や名前をタップしてみてください。";
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
      // 写真（img/food/）。2枚以上は横にスライドして見る
      const ph = (it.photos || []).map(f=> `<img src="img/food/${encodeURIComponent(f)}${PHOTOV}" alt="" loading="lazy" onerror="this.remove()">`).join("");
      body.innerHTML = (ph ? `<div class="food-photos${it.photos.length > 1 ? " multi" : ""}">${ph}</div>` +
                              (it.photos.length > 1 ? `<div class="food-photos-hint">写真 ${it.photos.length}枚（横にスライド）</div>` : "") : "") +
                       `<p>${esc(it.text)}</p>`;
      // 食の解説（字幕で地図を動かしながら）。スマホの低いパネルでもすぐ見えるよう、開いた中のいちばん上に
      const b = document.createElement("button"); b.className = "tour-start";
      b.innerHTML = `<span class="ts-icon">▶</span>地図で解説を見る`;
      b.onclick = e=>{ e.stopPropagation(); startFoodTour(it.id); };
      body.prepend(b);
      card.append(head, body); sec.appendChild(card);
    });
  });
}

// 産品を開く：一覧で開き、地図がその産地へ寄って、育てた大地を示す
function openFood(id){
  const it = FOOD.find(x=> x.id === id); if (!it) return;
  foodOpenId = id;
  document.querySelectorAll(".food-item").forEach(el=> el.classList.toggle("open", el.dataset.id === id));
  // 開いた品の見出しと解説ボタンを、パネルのいちばん上に（スマホの低いパネルでも見える）
  const card = document.querySelector(`.food-item[data-id="${id}"]`), pb = document.querySelector("#panel .panel-body");
  if (card && pb) pb.scrollTo({ top: pb.scrollTop + card.getBoundingClientRect().top - pb.getBoundingClientRect().top - 6, behavior:"smooth" });
  document.querySelectorAll(".food-pin").forEach(el=> el.classList.remove("on"));
  it.pin?.getElement()?.querySelector(".food-pin")?.classList.add("on");
  foodMarks.clearLayers();
  const b = L.latLngBounds([it.at]);
  (it.shape || []).forEach(sid=>{
    const f = foodShapes[sid]; if (!f) return;
    const c = f.properties.keepColor ? f.properties.color : "#ffc800";   // ふだんは黄色。keepColor の図形（高山＝紫）はその色のまま
    const lyr = L.geoJSON(f, { interactive:false, pane:"foodShapePane",
      style:{ color:c, weight:3, dashArray:"8 6", fillColor:c, fillOpacity:.38, className:"tour-shape" } }).addTo(foodMarks);
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
  lowerPanel();   // スマホ：パネルを低くたたんで地図を見せる
  const [l, bot] = openTab ? panelCover() : [0, 0];
  flyToFit(b.pad(0.15), { maxZoom:13.5, paddingTopLeft:[l + 30, 40], paddingBottomRight:[30, bot + 30] });
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
      // スマホでは全部が入らなくてもよい（陰影図・植生が出る倍率までにとどめる）
      flyToFit(L.latLngBounds(FOOD.map(it=> it.at)), { paddingTopLeft:[l + 30, 40], paddingBottomRight:[40, bot + 30] });
    }
  } else {
    if (!wideMode) foodHidePanes().forEach(p=>{ const pn = map.getPane(p); if (pn) pn.style.display = ""; });
    foodPins.remove(); closeFood();
  }
}
map.on("moveend", ()=>{   // 広域表示の切り替えなどで見どころが戻っても、食と大地の間は隠したまま
  if (foodMode) foodHidePanes().forEach(p=>{ const pn = map.getPane(p); if (pn) pn.style.display = "none"; });
});

// 1場面目以外に写真を出す場面：[場面の番号（0始まり）, 写真のファイル名, 写真の説明]
// 場面ごとの写真（できるだけ毎場面に出す）。"p:ファイル" ＝産品の写真（img/food）、それ以外＝見どころの写真（img/sites のサイト名）。
// [写真, 見出し] の配列で、場面の順。null は写真なし。書いていない場面と締めの場面は、産品の写真（あれば）
const SCENE_PHOTOS = {
  natsumikan: [["p:natsumikan-2.jpg"], ["堀内伝統的建造物群保存地区", "武家屋敷の残る堀内"], ["菊ヶ浜", "城下町の北の砂浜（菊ヶ浜）"], ["p:natsumikan.jpg", "萩の夏みかん"], ["p:natsumikan.jpg", "萩の夏みかん"]],
  aji:     [["p:aji.jpg"], ["笠山山頂展望台「鳶ノ巣」", "笠山山頂から見た萩の島々（これも阿武火山群の火山）"], ["笠山山頂火口", "阿武火山群の笠山の山頂火口"], null],
  wakame:  [["p:wakame.jpg"], ["笠山山頂火口", "笠山の山頂火口"], ["笠山縄状溶岩", "笠山の溶岩の磯"]],
  kamaboko:[["p:kamaboko.jpg"], ["菊ヶ浜", "川が運んだ砂の浜（菊ヶ浜）"], ["p:kamaboko.jpg"]],
  sazae:   [["p:sazae.jpg"], ["p:sazae-3.jpg", "海士の素潜り漁"], ["笠山アア溶岩", "笠山の溶岩の磯"], ["p:sazae-2.jpg", "ウニ"]],
  tamanegi:[["p:tamanegi.jpg"], ["阿字雄の滝", "溶岩の柱状節理を流れ落ちる阿字雄の滝"], ["三明戸湧水", "溶岩台地の麓に湧く三明戸湧水"], null, ["p:tamanegi.jpg"]],
  ika:     [["p:ika.jpg"], ["高山展望台", "高山の山頂から見た須佐の海"], ["高山磁石石", "高山のはんれい岩（高山磁石石）"],
            null, null, ["久原波止場", "須佐湾の久原波止場"], ["p:ika.jpg"]],
  iriko:   [["p:iriko.jpg"], null, ["高山磁石石", "高山のはんれい岩（高山磁石石）"], null],
  mukaku:  [["p:mukaku.jpg"], ["無角和牛宇久放牧場", "田んぼに放牧された無角和牛（宇久放牧場）"], ["西台放牧場", "西台の放牧場"],
            ["伊良尾山山頂", "伊良尾山の山頂から見た溶岩台地"], ["p:mukaku.jpg"]],
  soba:    [["p:soba.jpg"], ["イラオ火山灰露頭", "伊良尾山の噴火で降り積もった火山灰の地層"], ["龍鱗郷", "伊良尾山の溶岩が柱状に割れた龍鱗郷"], ["龍の鱗", "ソバ畑の下の溶岩の断面（龍のうろこ）"]],
  sake:    [["p:sake.jpg"], ["伏馬山スコリア丘", "伏馬山"], ["p:sake.jpg"], ["p:sake.jpg"], ["p:sake.jpg"]],
  daikon:  [["p:daikon.jpg"], ["千石台安山岩", "千石台の溶岩"], ["p:daikon.jpg"]],
  ringo:   [["p:ringo.jpg"], ["p:ringo.jpg"], ["船平山展望台", "かつて湖の底だった徳佐盆地（船平山展望台から）"], ["野坂山", "川をせき止めた火山（野坂山）"],
            ["丁字川出合淵", "湖の水が抜けていった出口（丁字川出合淵）"], ["p:ringo.jpg"]],
  kome:    [["p:kome.jpg"], null, ["野坂山", "川をせき止めた火山（野坂山）"], ["丁字川出合淵", "湖の水が抜けていった出口（丁字川出合淵）"],
            ["船平山展望台", "湖の跡の徳佐盆地（船平山展望台から）"]],
  tofu:    [["佐々並市伝統的建造物群保存地区", "佐々並の町並み"], ["淵ヶ平", "佐々並カルデラの噴火で積もった凝灰岩（淵ヶ平）"],
            ["台山展望所", "カルデラの中央にある宿場町・佐々並（台山展望所から）"], null, ["佐々並市伝統的建造物群保存地区", "佐々並の町並み"]],
};
// ---- 食の解説：解説文を1文ずつ場面にして、「産品 → なぜ → 大地」の順に地図を動かす ----
// 1場面目＝産地に寄って指差し／2場面目以降＝育てた大地を示す（最後の場面で名札も）
function startFoodTour(id){
  const it = FOOD.find(x=> x.id === id); if (!it) return;
  const land = (it.shape || []).concat(it.ring || []);
  if (it.scenes){   // 場面を書いてある品：字幕と地図の動き（矢印・名札など）はデータのとおり
    // 写真：できるだけ毎場面に出す（SCENE_PHOTOS。書いていない場面は産品の写真）
    const fp = f=> `img/food/${encodeURIComponent(f)}${PHOTOV}`;
    const own = (it.photos || [])[0];
    const pick = k=>{
      const e = (SCENE_PHOTOS[it.id] || [])[k];
      if (e === null) return { photo:false };
      if (e) return e[0].startsWith("p:") ? { photo: fp(e[0].slice(2)), photoCaption: e[1] || it.title } : { photo: e[0], photoCaption: e[1] || e[0] };
      return own ? { photo: fp(own), photoCaption: it.title } : { photo:false };
    };
    const out = it.scenes.map((sc, k)=> ({ ...sc, ...pick(k) }));
    // nopoint＝とれる範囲が広い・店がいくつもある品は、締めでも指差ししない
    if (it.close) out.push({ text: it.close, fit:[it.at].concat(land), shape: it.shape || [], ring: it.ring || [], point: it.nopoint ? null : it.at, label: it.label || [],
                             ...(own ? { photo: fp(own), photoCaption: it.title } : pick(0)) });   // 産品の写真が無ければ1場面目と同じ写真
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
