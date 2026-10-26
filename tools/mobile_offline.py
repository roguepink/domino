#!/usr/bin/env python3
"""電波なしで 2回目に開けるか(sw.js)を確かめる(チェック役: スマホ確認)。画面なし・音なし。

  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/mobile_offline.py [--out _check/moff]

  1回目: localhost で開く(index.html は 127.0.0.1 だと sw を登録しないので localhost を使う)→ sw が動くまで待つ
  2回目: 電波なし(context.set_offline)にして 開きなおす → 3D(three.js)まで出るか・ステージが遊べるか
  3回目: 電波なしで、?付きのアドレス(LINE で開いたときなど)でも開けるか
"""
import argparse, functools, http.server, json, socketserver, threading
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
    ap.add_argument("--out", default="_check/moff")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(NoCache, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://localhost:{port}/"
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path=CHROME, headless=True, args=["--mute-audio", "--use-angle=metal", "--enable-gpu"])
            ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
            page.goto(base)
            ok = page.evaluate("""async () => { const r = await navigator.serviceWorker.ready; await new Promise(s => setTimeout(s, 1500));
                const ks = await caches.keys(); let n = 0, list = [];
                for (const k of ks) { const c = await caches.open(k); const rq = await c.keys(); n += rq.length; list = list.concat(rq.map(x => new URL(x.url).pathname + new URL(x.url).search)); }
                return { active: !!r.active, keys: ks, count: n, files: list }; }""")
            print("1回目 sw:", json.dumps({k: ok[k] for k in ("active", "keys", "count")}, ensure_ascii=False))
            print("   覚えたファイル:", sorted(ok["files"]))
            ctx.set_offline(True)
            for i, path in enumerate(["#play=1&go&noinstall", "?a=line#play=2&go&noinstall", "?openExternalBrowser=1"]):
                errs.clear()
                try:
                    page.goto(base + path if not path.startswith("#") else base + "index.html" + path, timeout=15000)
                    page.wait_for_timeout(3500)
                    st = page.evaluate("JSON.stringify(window.__stats || null)")
                except Exception as e:
                    st = f"開けない: {e}"[:200]
                page.screenshot(path=f"{out}-{i}.png")
                print(f"電波なし {path}: {st}")
                print("   エラー:", errs[:4])
            br.close()
        srv.shutdown()


if __name__ == "__main__":
    main()
