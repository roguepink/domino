#!/usr/bin/env python3
"""スマホのつもりで重さを測る(チェック役: スマホ確認)。画面なし・音なし。

  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/mobile_perf.py --stage 100 --cpu 4 --secs 30 [--2d] [--size 390x844] [--out _check/mperf]

  - CPU を N 倍おそくする(CDP Emulation.setCPUThrottlingRate)。スマホの JS の速さに近づける
  - 1秒ごとに fps(window.__stats.fps)・3D の画質の段(__r3d.q)・ドミノの数を記録
  - 1コマの重さ = requestAnimationFrame の中で使った時間(ms)。平均・95%・いちばん重い
"""
import argparse, functools, http.server, json, socketserver, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

HOOK = """
(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__ft = [];
  window.requestAnimationFrame = (cb) => raf((t) => {
    const a = performance.now();
    try { cb(t); } finally { const d = performance.now() - a; if (window.__ft.length < 20000) window.__ft.push(d); }
  });
})();
"""


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, default=100)
    ap.add_argument("--cpu", type=float, default=4)
    ap.add_argument("--secs", type=int, default=30)
    ap.add_argument("--size", default="390x844")
    ap.add_argument("--dpr", type=float, default=3)
    ap.add_argument("--2d", dest="two", action="store_true")
    ap.add_argument("--out", default="_check/mperf")
    ap.add_argument("--soft", action="store_true", help="GPU を使わない(SwiftShader)= 絵を描く力が弱いスマホのつもり")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(NoCache, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        w, h = (int(x) for x in a.size.split("x"))
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path=CHROME, headless=True,
                                   args=["--mute-audio"] + (["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] if a.soft else ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]))
            ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=a.dpr, has_touch=True, is_mobile=True)
            ctx.add_init_script(HOOK)
            page = ctx.new_page()
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            hsh = f"play={a.stage}&go&auto&noinstall" + ("&2d" if a.two else "")
            page.goto(f"http://127.0.0.1:{port}/index.html?p=1#{hsh}")
            page.wait_for_timeout(2500)
            page.evaluate("window.__ft.length = 0")
            rows = []
            for i in range(a.secs):
                page.wait_for_timeout(1000)
                r = page.evaluate("""() => ({ s: window.__stats || {}, q: window.__r3d ? window.__r3d.q : null,
                    pr: window.__r3d ? window.__r3d.pr : null, calls: window.__r3d ? window.__r3d.calls : null,
                    tris: window.__r3d ? window.__r3d.tris : null })""")
                rows.append(r)
                if i in (a.secs // 3, a.secs * 2 // 3):
                    page.screenshot(path=f"{out}-{i}.png")
            ft = sorted(page.evaluate("window.__ft"))
            br.close()
        srv.shutdown()
    fps = [r["s"].get("fps", 0) for r in rows if r["s"].get("state") == "play"]
    print(f"stage {a.stage}  cpu x{a.cpu}  {'2D' if a.two else '3D'}  size {a.size}@{a.dpr}")
    print("fps 1秒ごと:", [r["s"].get("fps") for r in rows])
    print("画質の段 q:", [r["q"] for r in rows])
    print("最後:", json.dumps(rows[-1], ensure_ascii=False))
    if fps:
        print(f"プレイ中 fps 平均 {sum(fps)/len(fps):.1f}  最低 {min(fps)}")
    if ft:
        n = len(ft)
        print(f"1コマの重さ(ms) 平均 {sum(ft)/n:.1f}  95% {ft[int(n*0.95)]:.1f}  最大 {ft[-1]:.1f}  コマ数 {n}")
    print("エラー:", len(errs), errs[:5])


if __name__ == "__main__":
    main()
