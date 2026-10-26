#!/usr/bin/env python3
"""ゲームの 3D の絵から、アイコン・LINE の紹介画像(ogp.jpg)・はじめの画面の写真(shots/)を作る(まとめ役)。

  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/make_art.py            → _check/art/ に下書き(見てから --write で本物に書く)
  python3 tools/make_art.py --write

絵文字の画像は使わない(Apple の絵文字の絵を公開リポジトリに入れないため)。字は RocknRoll One(OFL)。
Mac の画面はつけない(headless)。音も出さない。
"""
import argparse, functools, http.server, socketserver, threading, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FONT = os.path.expanduser("~/.cache/line-play-game/RocknRollOne-Regular.ttf")

# 主人公の少し 横うしろから、倒れてくる波と主人公が いっしょに入る角度(t 秒のところで撮る)
HIDE_UI = "var st=document.createElement('style');st.textContent='body>*:not(#view){display:none!important}';document.head.appendChild(st);1"


def cam_js(dx, dy, dz, lx, ly, lz):
    # 毎コマ 主人公の位置から カメラを決める
    return ("window.__artCam=setInterval(function(){var s=DOMINO.Game.sim;if(!s)return;var p=s.p;"
            f"window.__camOverride=[p.x+({dx}),{dy},p.z+({dz}),p.x+({lx}),{ly},p.z+({lz})];}},8);1")


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def shoot(page, url, size, t, cam=None, hide=True, before=None):
    page.set_viewport_size({"width": size[0], "height": size[1]})
    page.goto(url)
    page.wait_for_function("window.DOMINO && DOMINO.Game && DOMINO.Game.renderKind==='3d'", timeout=15000)
    if before: page.evaluate(before)
    if hide: page.evaluate(HIDE_UI)
    if cam: page.evaluate(cam_js(*cam))
    page.wait_for_function(f"DOMINO.Game.sim && DOMINO.Game.sim.t > {t}", timeout=60000)
    page.evaluate("DOMINO.Game.slowmo(0.0001, 99); 1")      # その場で止める
    page.wait_for_timeout(300)
    return page.screenshot(type="png")


def draw_icon(N, scale=1.0):
    import math
    im = Image.new("RGB", (N, N))
    top, bot = (124, 205, 255), (255, 214, 236)
    px = im.load()
    for y in range(N):
        t = y / (N - 1); c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(N): px[x, y] = c
    d = ImageDraw.Draw(im, "RGBA")
    S = N * scale; ox = (N - S) / 2
    ground = ox + S * 0.80
    d.rectangle((0, ground, N, N), fill=(143, 209, 106))
    d.rectangle((0, ground, N, ground + S * 0.02), fill=(124, 195, 90))
    cols = [(255, 90, 138), (255, 159, 64), (255, 210, 63), (90, 205, 120), (64, 170, 255), (150, 110, 255)]
    W, H = S * 0.13, S * 0.42
    angs = [72, 62, 46, 24, 6, 0]      # 左ほど 倒れている
    for k in range(6):
        cx = ox + S * (0.12 + k * 0.145)
        a = math.radians(angs[k])
        # 右下の角を軸に 右へ倒れる長方形(角を丸めた形を 点でつくる)
        pts = []
        for (u, v) in [(0, 0), (W, 0), (W, H), (0, H)]:
            x = cx + (u - W) * math.cos(a) + v * math.sin(a)
            y = ground - (v * math.cos(a) - (u - W) * math.sin(a))
            pts.append((x, y))
        sh = [(x + S * 0.012, y + S * 0.012) for x, y in pts]
        d.polygon(sh, fill=(27, 20, 48, 70))
        d.polygon(pts, fill=cols[k], outline=(27, 20, 48), width=max(2, int(S * 0.012)))
        # まん中の線と 目(白い点)
        def at(u, v): return (cx + (u - W) * math.cos(a) + v * math.sin(a), ground - (v * math.cos(a) - (u - W) * math.sin(a)))
        d.line([at(W * 0.12, H / 2), at(W * 0.88, H / 2)], fill=(255, 255, 255), width=max(2, int(S * 0.01)))
        r = S * 0.018
        for (u, v) in [(0.5, 0.25), (0.28, 0.72), (0.72, 0.72), (0.28, 0.88), (0.72, 0.88)][: (k % 3) + 2]:
            x, y = at(W * u, H * v); d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    out = ROOT / "_check" / "art"; out.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright
    import io
    handler = functools.partial(Q, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}/index.html"
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path=CHROME, headless=True, args=["--mute-audio", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"])
            ctx = br.new_context(device_scale_factor=2)
            page = ctx.new_page()
            seen = "try{var d=JSON.parse(localStorage.getItem('domino-save-v1')||'{}');d.seenTips={1:true,2:true};localStorage.setItem('domino-save-v1',JSON.stringify(d))}catch(e){};1"
            page.goto(base + "?x=0#noinstall"); page.evaluate(seen)
            imgs = {}
            # 1) LINE の紹介(横長): 横うしろから、虹色の列と 倒れる波と 主人公
            imgs["ogp"] = shoot(page, base + "?x=1#play=2&go&auto&noinstall", (600, 315), 7.5, cam=(4.5, 6.5, -9.0, -0.8, 0.3, -2.5))
            # 2) アイコン(正方形): 列のアップ
            imgs["icon"] = shoot(page, base + "?x=2#play=1&go&auto&noinstall", (256, 256), 6.0, cam=(-2.0, 2.0, -3.4, 0.2, 0.5, -0.6))
            # 3) 写真(縦長)いつものカメラで 何面か
            for k, (st, t) in enumerate([(1, 6.5), (24, 7.0), (37, 6.0), (61, 7.5)]):
                imgs[f"shot{k + 1}"] = shoot(page, base + f"?x={10 + k}#play={st}&go&auto&noinstall", (360, 640), t, hide=False)
            br.close()
        srv.shutdown()

    for k, v in imgs.items():
        Image.open(io.BytesIO(v)).save(out / f"raw-{k}.png")

    font = lambda n: ImageFont.truetype(FONT, n)
    # LINE の紹介画像 1200x630: 左に字、右は ゲームの絵
    g = Image.open(io.BytesIO(imgs["ogp"])).convert("RGB").resize((1200, 630), Image.LANCZOS)
    d = ImageDraw.Draw(g, "RGBA")
    d.rounded_rectangle((34, 40, 640, 300), 34, fill=(255, 255, 255, 225))
    def txt(xy, s, n, col, stroke=0):
        d.text(xy, s, font=font(n), fill=col, stroke_width=stroke, stroke_fill=(27, 20, 48))
    txt((70, 62), "ドミノ ラッシュ", 92, (255, 90, 138), 4)
    txt((74, 182), "走ると ドミノが ならぶ。", 40, (27, 20, 48))
    txt((74, 236), "倒れる波から にげきれ!", 40, (27, 20, 48))
    d.rounded_rectangle((34, 520, 520, 600), 28, fill=(255, 210, 63, 240))
    txt((62, 532), "全100ステージ・無料", 44, (27, 20, 48))
    g.save(out / "ogp.jpg", quality=86)

    # アイコン: 絵で描く(虹色のドミノが 左から順に倒れていく)。写真より 小さくても分かる
    ic = draw_icon(1024).resize((512, 512), Image.LANCZOS)
    ic.save(out / "icon-512.png")
    ic.resize((192, 192), Image.LANCZOS).save(out / "icon-192.png")
    ic.resize((180, 180), Image.LANCZOS).save(out / "apple-touch-icon.png")
    # maskable: 外側が切られるので 絵を 80% に縮めて まわりを背景の色で
    m = draw_icon(1024, scale=0.8).resize((512, 512), Image.LANCZOS)
    m.save(out / "maskable-512.png")
    for k in range(4):
        s = Image.open(io.BytesIO(imgs[f"shot{k + 1}"])).convert("RGB").resize((360, 640), Image.LANCZOS)
        s.save(out / f"shot{k + 1}.jpg", quality=80)
    print("下書き:", out)

    if a.write:
        import shutil
        for f in ["ogp.jpg", "icon-512.png", "icon-192.png", "apple-touch-icon.png", "maskable-512.png"]:
            shutil.copy(out / f, ROOT / f)
        (ROOT / "shots").mkdir(exist_ok=True)
        for k in range(4):
            shutil.copy(out / f"shot{k + 1}.jpg", ROOT / "shots" / f"{k + 1}.jpg")
        print("書いた: アイコン4種・ogp.jpg・shots/1〜4.jpg")


if __name__ == "__main__":
    main()
