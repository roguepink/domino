#!/usr/bin/env python3
"""スマホのふり(タッチ)で、操作が効くかを確かめる(チェック役: スマホ確認)。画面なし・音なし。

  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/mobile_touch.py [--out _check/mtouch]

  機種: iPhone SE(320x568)/ 大きい iPhone(430x932)/ 横向き(844x390)/ LINE の中(390x844 + UA に Line/)
  1. 左がわを 右へ 90px なぞる → DOMINO.Game.sim.p.x が 右(+)へ動くか
  2. 左がわを 左へ なぞる → 左(-)へ動くか
  3. 右がわを タップ → ジャンプするか(p.y が上がるか)
  4. 2本指: 左で なぞりながら 右でタップ → 両方 効くか
  5. 画面のいちばん下(LINE の案内がある所)で なぞる → 効くか
  6. プレイ中に 画面の向きを変える → 絵の大きさが ついてくるか
  タッチは CDP の Input.dispatchTouchEvent(本物の指と同じ流れ: touch → pointer)。
"""
import argparse, functools, http.server, json, socketserver, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
LINE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0"

TRACK = """
(() => { const G = DOMINO.Game; if (!window.__noRetry) G.retry(); const s = G.sim; window.__trk = { x0: s.p.x, xmin: s.p.x, xmax: s.p.x, ymax: s.p.y, y0: s.p.y };
  clearInterval(window.__trkI);
  window.__trkI = setInterval(() => { const p = DOMINO.Game.sim.p, t = window.__trk;
    t.xmin = Math.min(t.xmin, p.x); t.xmax = Math.max(t.xmax, p.x); t.ymax = Math.max(t.ymax, p.y); t.x = p.x; t.state = DOMINO.Game.state; t.sim = DOMINO.Game.sim.state; }, 10);
  return s.p.x; })()
"""


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def touch(cdp, kind, pts):
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, x, y in pts]})


def swipe(page, cdp, x0, y, dx, steps=10, hold_ms=30):
    touch(cdp, "touchStart", [(1, x0, y)])
    for k in range(1, steps + 1):
        page.wait_for_timeout(hold_ms)
        touch(cdp, "touchMove", [(1, x0 + dx * k / steps, y)])
    page.wait_for_timeout(250)
    touch(cdp, "touchEnd", [])


def run_device(p, port, name, w, h, ua, out, results):
    br = p.chromium.launch(executable_path=CHROME, headless=True, args=["--mute-audio", "--use-angle=metal", "--enable-gpu"])
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, has_touch=True, is_mobile=True, user_agent=ua)
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"http://127.0.0.1:{port}/index.html?m={name}#play=1&go&noinstall")
    page.wait_for_timeout(2500)
    r = {"name": name}

    def ev(js):
        page.evaluate(js); page.wait_for_timeout(700); page.evaluate("window.__trk.x0 = DOMINO.Game.sim.p.x; window.__trk.xmin = window.__trk.xmax = window.__trk.x0; window.__trk.y0 = window.__trk.ymax = DOMINO.Game.sim.p.y")

    def tr():
        return page.evaluate("window.__trk")

    # 1. 右へ
    ev(TRACK)
    swipe(page, cdp, w * 0.25, h * 0.72, 90)
    t = tr(); r["右へなぞる"] = round(t["xmax"] - t["x0"], 2)
    # 2. 左へ
    ev(TRACK)
    swipe(page, cdp, w * 0.35, h * 0.72, -90)
    t = tr(); r["左へなぞる"] = round(t["xmin"] - t["x0"], 2)
    # 3. 右タップ
    ev(TRACK)
    touch(cdp, "touchStart", [(2, w * 0.8, h * 0.7)]); page.wait_for_timeout(60); touch(cdp, "touchEnd", [])
    page.wait_for_timeout(500)
    t = tr(); r["右タップでジャンプ(高さ)"] = round(t["ymax"] - t["y0"], 2)
    # 4. 2本指
    ev(TRACK)
    x0, y = w * 0.2, h * 0.75
    touch(cdp, "touchStart", [(1, x0, y)])
    for k in range(1, 6):
        page.wait_for_timeout(30); touch(cdp, "touchMove", [(1, x0 + 12 * k, y)])
    touch(cdp, "touchStart", [(1, x0 + 60, y), (2, w * 0.8, h * 0.6)])
    for k in range(6, 11):
        page.wait_for_timeout(30); touch(cdp, "touchMove", [(1, x0 + 12 * k, y), (2, w * 0.8, h * 0.6)])
    touch(cdp, "touchEnd", [(1, x0 + 120, y)])  # 右の指をはなす
    page.wait_for_timeout(400)
    touch(cdp, "touchEnd", [])
    t = tr(); r["2本指(左右, 高さ)"] = (round(t["xmax"] - t["x0"], 2), round(t["ymax"] - t["y0"], 2))
    # 5. いちばん下
    ev(TRACK)
    swipe(page, cdp, w * 0.2, h - 30, 90)
    r["いちばん下の上にあるもの"] = page.evaluate(f"(() => {{ const e = document.elementFromPoint({w*0.2}, {h-30}); return e ? (e.id || e.className || e.tagName) : null }})()")
    t = tr(); r["いちばん下でなぞる"] = round(t["xmax"] - t["x0"], 2)
    r["状態"] = (t.get("state"), t.get("sim"))
    page.screenshot(path=f"{out}-{name}-a.png")
    # 6. 向きを変える
    page.set_viewport_size({"width": h, "height": w})
    page.wait_for_timeout(800)
    cv = page.evaluate("""(() => { const c = document.querySelector('#view canvas'); return c ? [c.clientWidth, c.clientHeight, c.width, c.height] : null })()""")
    r["向きを変えたあとの絵"] = cv
    page.screenshot(path=f"{out}-{name}-b.png")
    page.set_viewport_size({"width": w, "height": h})
    page.wait_for_timeout(500)
    r["もどしたあと"] = page.evaluate("""(() => { const c = document.querySelector('#view canvas'); return c ? [c.clientWidth, c.clientHeight] : null })()""")
    r["エラー"] = errs[:3]
    results.append(r)
    br.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_check/mtouch")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(NoCache, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    res = []
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        with sync_playwright() as p:
            for name, w, h, ua in [("SE", 320, 568, IOS_UA), ("ProMax", 430, 932, IOS_UA), ("yoko", 844, 390, IOS_UA), ("LINE", 390, 844, LINE_UA)]:
                run_device(p, port, name, w, h, ua, out, res)
        srv.shutdown()
    for r in res:
        print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
