"""スプレッドシート（正本）の内容を、地図のデータ（data/geosites.geojson・data/cultural.geojson）に写す。

使い方：python tools/sync_sheet.py        … 変わるところを表示して書き換える
        python tools/sync_sheet.py --dry  … 表示だけ（書き換えない）

・地図の点は名前で突き合わせる。名前を変えたサイトは、近い点（300m以内）で突き合わせて名前も写す。
・写す項目：名前・ランク・見出し・説明・法的保護・駐車場・現地解説（文化サイトは経路緯度・経路経度も）。位置は写さない。
・スプレッドシートで「地図に出す」が N のサイト、地図に無いサイトは、表示だけして触らない。
"""
import json, math, os, sys, urllib.request

URL = "https://script.google.com/macros/s/AKfycbxwAS_jguWMoqiSA_GM46Rjr3kffVqNstRD0Rd4MBJM7L_fS4PGsxtcsPgVsaYdnOPG/exec?action=data"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = {
    "ジオサイト": ("geosites.geojson", ["ランク", "見出し", "説明", "法的保護", "駐車場", "現地解説"]),
    "文化サイト": ("cultural.geojson", ["ランク", "見出し", "説明", "法的保護", "駐車場", "現地解説", "経路緯度", "経路経度"]),
}
dry = "--dry" in sys.argv
sheets = json.load(urllib.request.urlopen(URL))["sheets"]
changed = 0
for sheet, (fn, keys) in FIELDS.items():
    path = os.path.join(ROOT, "data", fn)
    gj = json.load(open(path, encoding="utf-8")); F = gj["features"]
    dist = lambda f, r: math.hypot((f["geometry"]["coordinates"][1] - float(r["緯度"])) * 111, (f["geometry"]["coordinates"][0] - float(r["経度"])) * 91.7)
    n = 0
    for r in sheets.get(sheet, []):
        if r.get("地図に出す") == "N" or r.get("緯度") in ("", None): continue
        f = next((x for x in F if x["properties"]["name"] == r["名前"]), None)
        if f is None:
            f = min(F, key=lambda x: dist(x, r))
            if dist(f, r) > 0.3: print(f"［地図に無い］{sheet} {r['ID']} {r['名前']}"); continue
        p = f["properties"]
        if p["name"] != r["名前"]:
            print(f"{r['ID']} 名前：{p['name']} → {r['名前']}"); p["name"] = r["名前"]; n += 1
        for k in keys:
            v = "" if r.get(k) is None else str(r.get(k))
            old = str(p.get(k, "") or "")
            try:
                if float(old) == float(v): continue   # 34.462620 と 34.46262 は同じ
            except ValueError: pass
            if old != v:
                print(f"{r['ID']} {r['名前']} {k}：{str(p.get(k, '') or '')[:30]} → {v[:30]}")
                if v: p[k] = v
                else: p.pop(k, None)
                n += 1
    print(f"{sheet}：{n}か所を変更")
    changed += n
    if n and not dry: open(path, "w", encoding="utf-8", newline="\n").write(json.dumps(gj, ensure_ascii=False) + "\n")
print("変更なし" if not changed else ("（--dry：書き換えていません）" if dry else "書き換えました。js/map.js の DATAV と index.html の ?v= を上げてください"))
