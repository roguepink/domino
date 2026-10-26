#!/usr/bin/env python3
"""全部の面を ボット(js/bot.js の DOMINO.Bot.solve)に遊ばせて、表にする(ステージ設計係)。

  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/stagecheck.py                 # 全部
  python3 tools/stagecheck.py --only 31-40    # 一部だけ(1,5,9 や 1-10,21 も)
  python3 tools/stagecheck.py --rough         # 「人に近い弱いボット」(0.2秒ごと・左右3段階・先読み少し)でも遊ぶ
  python3 tools/stagecheck.py --jobs 4 --json _check/stages.json

  表の見方:
    長さ   = スタートからゴールまでの行(m)。 時間 = ゴールまでの秒
    波     = いちばん近づいた波(m)。小さいほど ハラハラ(1.6 未満 = ギリギリ)
    残り   = ドミノの残りの いちばん少なかった数。0 に近いほど 箱が大事
    金     = 取れた金のドミノ / 置いてある数。 ギリ = ギリギリの回数
    らく   = --rough のとき、弱いボットでもクリアできたか(○ ならだれでも ★1 を取りやすい)
  地図の書き方のまちがい(はばが 9 でない・金のドミノが 3 つでない・S や G がない など)も 先に知らせる。
  ※ 音は出ない(--mute-audio)。Mac の画面もつけない(headless)。
"""
import argparse, asyncio, functools, http.server, json, socketserver, sys, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCRIPTS = ["config.js", "level.js", "sim.js", "worlds.js", "stages.js", "bot.js"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def parse_only(txt):
    ids = set()
    for part in txt.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-")
            ids.update(range(int(a), int(b) + 1))
        else:
            ids.add(int(part))
    return ids


LINT_JS = r"""
() => {
  var out = [], S = DOMINO.STAGES || [], seen = {};
  S.forEach(function (s, i) {
    var w = [];
    if (seen[s.id]) w.push('番号が重なっている'); seen[s.id] = 1;
    if (s.world !== Math.ceil(s.id / 10)) w.push('world が番号と合わない');
    if (!s.name) w.push('名前がない');
    var stars = 0, S_ = 0, G_ = 0;
    s.map.forEach(function (row, r) {
      if (row.length !== DOMINO.CONFIG.COLS) w.push((s.map.length - 1 - r) + '行目(z)の はばが ' + row.length);
      for (var c = 0; c < row.length; c++) { var ch = row[c]; if (ch === '*') stars++; if (ch === 'S') S_++; if (ch === 'G') G_++; }
    });
    if (stars !== 3) w.push('金のドミノが ' + stars + ' 個');
    if (S_ !== 1) w.push('S が ' + S_ + ' 個');
    if (G_ < 1) w.push('G がない');
    (s.obj || []).forEach(function (o) {
      if (o.z == null || o.z < 0 || o.z >= s.map.length) w.push('obj ' + o.t + ' の z が地図の外');
    });
    out.push({ id: s.id, name: s.name, world: s.world, rows: s.map.length, warn: w });
  });
  return out;
}
"""


async def worker(page, queue, results, opts, rough, total, t_start):
    while True:
        try:
            sid = queue.get_nowait()
        except asyncio.QueueEmpty:
            return
        js = """([id, opts, rough]) => {
          var st = DOMINO.STAGES.filter(function (s) { return s.id === id; })[0];
          var r = DOMINO.Bot.solve(st, opts); delete r.inputs;
          if (rough) { var q = DOMINO.Bot.solve(st, { beam: 4, every: 12, steers: [-1, 0, 1], gold: 0, retry: false }); r.rough = q.clear; r.roughZ = q.z; }
          return r;
        }"""
        try:
            r = await page.evaluate(js, [sid, opts, rough])
        except Exception as e:  # noqa
            r = {"clear": False, "why": "JSエラー: " + str(e)[:200]}
        results[sid] = r
        done = len(results)
        print(f"\r  {done}/{total} 面 ({time.time() - t_start:.0f}秒)", end="", file=sys.stderr, flush=True)


def width(s):
    # 日本語(全角)は 2 文字ぶん
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in s)


def pad(s, n):
    return s + " " * max(0, n - width(s))


async def run(a):
    from playwright.async_api import async_playwright

    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}/"
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--mute-audio"])
        pages = []
        errors = []
        for j in range(a.jobs):
            ctx = await br.new_context()
            pg = await ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            # 絵も音もない 小さなページ(ファイルは作らず、その場で返す)
            tags = "".join(f'<script src="js/{s}?t={time.time()}"></script>' for s in SCRIPTS)
            html = "<!doctype html><meta charset=utf-8><body>" + tags + "</body>"
            await pg.route(base + "_stagecheck.html", lambda route, *_r, h=html: route.fulfill(status=200, content_type="text/html", body=h))
            await pg.goto(base + "_stagecheck.html")
            pages.append(pg)
        lint = await pages[0].evaluate(LINT_JS)
        ids = [x["id"] for x in lint]
        if a.only:
            want = parse_only(a.only)
            ids = [i for i in ids if i in want]
        info = {x["id"]: x for x in lint}
        bad = [x for x in lint if x["warn"] and x["id"] in ids]
        if bad:
            print("■ 地図の書き方の注意")
            for x in bad:
                print(f"  {x['id']:>3} {x['name']}: " + " / ".join(x["warn"][:6]))
        q = asyncio.Queue()
        # 長い面から先に(待ち時間を へらす)
        for i in sorted(ids, key=lambda i: -info[i]["rows"]):
            q.put_nowait(i)
        results = {}
        opts = {"beam": a.beam}
        t0 = time.time()
        await asyncio.gather(*[worker(pg, q, results, opts, a.rough, len(ids), t0) for pg in pages])
        print("", file=sys.stderr)
        await br.close()
    srv.shutdown()

    # 表
    head = ["番号", "名前", "長さ", "クリア", "時間", "波", "残り", "金", "ギリ", "調べ秒"]
    if a.rough:
        head.append("らく")
    rows = []
    cleared = 0
    for i in ids:
        r, x = results.get(i, {}), info[i]
        ok = r.get("clear")
        cleared += 1 if ok else 0
        cl = "○" if ok else "× " + str(r.get("why", "")) + f" z{r.get('z', 0)}/{r.get('goalZ', 0)}"
        row = [str(i), x["name"], str(r.get("goalZ", x["rows"])), cl, f"{r.get('time', 0):.1f}",
               f"{r.get('minDanger', 0):.1f}", str(r.get("stockMin", "")),
               f"{r.get('gold', 0)}/{r.get('goldTotal', 0)}", str(r.get("near", 0)), f"{r.get('ms', 0) / 1000:.1f}"]
        if a.rough:
            row.append("○" if r.get("rough") else f"× z{r.get('roughZ', 0)}")
        rows.append(row)
    ws = [max(width(h), *(width(r[k]) for r in rows)) if rows else width(h) for k, h in enumerate(head)]
    print("  ".join(pad(h, ws[k]) for k, h in enumerate(head)))
    last_w = None
    for i, r in zip(ids, rows):
        w = info[i]["world"]
        if last_w is not None and w != last_w:
            print("-" * (sum(ws) + 2 * len(ws)))
        last_w = w
        print("  ".join(pad(c, ws[k]) for k, c in enumerate(r)))
    print(f"\nクリア {cleared}/{len(ids)} 面")
    if a.rough:
        print(f"弱いボットでもクリア {sum(1 for i in ids if results.get(i, {}).get('rough'))}/{len(ids)} 面")
    if errors:
        print("JS のエラー:", len(errors))
        for e in errors[:10]:
            print("  ", e[:300])
    if a.json:
        out = ROOT / a.json
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({str(i): dict(results.get(i, {}), name=info[i]["name"], world=info[i]["world"]) for i in ids},
                                  ensure_ascii=False, indent=1))
    return 0 if cleared == len(ids) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--beam", type=int, default=32)
    ap.add_argument("--rough", action="store_true")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    sys.exit(asyncio.run(run(a)))


if __name__ == "__main__":
    main()
