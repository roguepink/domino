#!/usr/bin/env python3
"""ゲームを Mac の Chrome(画面なし・音なし)で開いて、自動で遊ばせ、写真とエラーと数字(fps など)を集める。

  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/playtest.py [--hash "play&auto"] [--secs 20] [--shots 4] [--size 844x390] [--out _check/pt] [--eval "JS式"]

  - 写真は <out>-1.png, -2.png ... (Git に入れない _check/ の下)
  - 終わりに window.__stats(fps・ゾンビの数・倒した数・点数)と、コンソールのエラーを表示
  - --eval で、終わる前に好きな JS を実行して結果を表示(例: "__game.Weapons.select(5)")
  - --before で、始めてすぐに JS を実行(例: ボスを出す・武器を選ぶ)
  ※ 音は出ない(--mute-audio)。Mac の画面もつけない(headless)。
"""
import argparse, functools, http.server, json, socketserver, sys, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hash", default="play&auto")
    ap.add_argument("--secs", type=float, default=20)
    ap.add_argument("--shots", type=int, default=3)
    ap.add_argument("--size", default="844x390")
    ap.add_argument("--out", default="_check/pt")
    ap.add_argument("--eval", default="")
    ap.add_argument("--before", default="")
    ap.add_argument("--mobile", action="store_true", help="スマホのふり(タッチ・UA)")
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
                                   args=["--mute-audio", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
            ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if a.mobile else 1,
                                 has_touch=a.mobile, is_mobile=a.mobile)
            page = ctx.new_page()
            errors = []
            page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
            url = f"http://127.0.0.1:{port}/index.html?t=1#{a.hash}"
            page.goto(url)
            page.wait_for_timeout(1500)
            if a.before:
                print("before:", page.evaluate(a.before))
            n = max(1, a.shots)
            for i in range(n):
                page.wait_for_timeout(int(a.secs * 1000 / n))
                png = f"{out}-{i + 1}.png"
                page.screenshot(path=png)
                st = page.evaluate("window.__stats ? JSON.stringify(window.__stats) : 'no stats'")
                print(f"shot {png}  {st}")
            if a.eval:
                print("eval:", page.evaluate(a.eval))
            br.close()
        srv.shutdown()
    print("errors/warnings:", len(errors))
    for e in errors[:40]:
        print("  ", e[:400])


if __name__ == "__main__":
    main()
