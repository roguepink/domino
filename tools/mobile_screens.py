#!/usr/bin/env python3
"""小さい iPhone(320x568)などで、いろいろな画面を撮り、文字の切れ・はみ出しを数字でも調べる(チェック役: スマホ確認)。

  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/mobile_screens.py [--size 320x568] [--out _check/mscr]

  撮る画面: ステージ前(1面・31面・91面)/ 負けた結果 / ポーズ / ステージ選び / きせかえ / せってい / クリアの結果
  数字: 画面の中で「中身が入りきらず かくれている」箱(scrollHeight > clientHeight)と、横にはみ出した文字
"""
import argparse, functools, http.server, json, socketserver, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

MEASURE = """() => {
  const out = [];
  document.querySelectorAll('#ui .scr.on *, #ui .scr.on').forEach(e => {
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4)
      out.push('かくれている: ' + (e.id || e.className) + ' ' + e.clientHeight + '/' + e.scrollHeight + 'px');
    if (e.children.length === 0 && e.textContent.trim() && (r.right > innerWidth + 1 || r.left < -1))
      out.push('横にはみ出し: ' + e.textContent.trim().slice(0, 20));
  });
  return out;
}"""


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="320x568")
    ap.add_argument("--out", default="_check/mscr")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    w, h = (int(x) for x in a.size.split("x"))
    handler = functools.partial(NoCache, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path=CHROME, headless=True, args=["--mute-audio", "--use-angle=metal", "--enable-gpu"])
            ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, has_touch=True, is_mobile=True, user_agent=IOS_UA)
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            n = [0]

            def shot(name, js=None, wait=900):
                n[0] += 1
                if js:
                    page.evaluate(js)
                page.wait_for_timeout(wait)
                page.screenshot(path=f"{out}-{n[0]:02d}-{name}.png")
                print(f"{n[0]:02d} {name}:", page.evaluate(MEASURE))

            page.goto(f"http://127.0.0.1:{port}/index.html?s=1#noinstall")
            page.wait_for_timeout(2000)
            for sid in (1, 31, 91):
                shot(f"ステージ前{sid}", f"DOMINO.Game.play({sid})")
            shot("負けた結果", "DOMINO.Game.retry()", 9000)
            shot("ポーズ", "DOMINO.Game.retry(); setTimeout(() => DOMINO.Game.pause(), 500)")
            shot("メニュー", "DOMINO.Game.toMenu()")
            for act in ("stages", "skins", "settings"):
                shot(act, f"(() => {{ DOMINO.Game.toMenu(); const b = document.querySelector('[data-act=\"{act}\"]'); if (b) b.click(); return !!b; }})()")
            print("ボタンの名前:", page.evaluate("[...new Set([...document.querySelectorAll('[data-act]')].map(b => b.dataset.act))]"))
            br.close()
        srv.shutdown()
    print("エラー:", errs[:5])


if __name__ == "__main__":
    main()
