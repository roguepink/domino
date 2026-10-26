#!/usr/bin/env python3
"""チェック役(QA)の道具: いろいろな場面を自動で作って、エラー・おかしな動き・写真を集める。
  source ~/.local/venvs/ryokoshi/bin/activate
  python3 tools/qa_flow.py <場面> [--2d] [--size 390x844] [--n 10]
  場面: flow / fails / spam / pause / save / orient / hide / mem
  ※ 音は出ない(--mute-audio)。Mac の画面もつけない(headless)。写真は _check/qa-*.png
"""
import argparse, functools, http.server, json, socketserver, sys, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

INIT_JS = r"""
(function(){
  var cnt = {buf:0, tex:0, prog:0, vao:0, fb:0, rb:0};
  function wrap(P){ if(!P) return; [['createBuffer','buf',1],['deleteBuffer','buf',-1],['createTexture','tex',1],['deleteTexture','tex',-1],
    ['createProgram','prog',1],['deleteProgram','prog',-1],['createVertexArray','vao',1],['deleteVertexArray','vao',-1],
    ['createFramebuffer','fb',1],['deleteFramebuffer','fb',-1],['createRenderbuffer','rb',1],['deleteRenderbuffer','rb',-1]].forEach(function(a){
      var f = P[a[0]]; if(!f) return;
      P[a[0]] = function(x){ if (a[2] < 0 && !x) return f.apply(this, arguments); cnt[a[1]] += a[2]; return f.apply(this, arguments); }; }); }
  try { wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch(e){}
  window.__gl = cnt;
})();
window.QA = {
  // main の 1コマと同じことを 速く くり返す(ボット か 決まった入力)
  ff: function(n, mode){
    var G = DOMINO.Game, s = G.sim, evs = [];
    for (var k = 0; k < n; k++) {
      if (G.state !== 'play' || G.sim !== s) break;
      if ((s.state === 'clear' && s.endT > 0.5) || (s.state === 'fail' && s.endT > 0.9)) break;
      var inp = mode === 'bot' ? DOMINO.Bot.input(s) : (typeof mode === 'function' ? mode(s) : (mode || {}));
      s.step(inp);
      evs.length = 0; for (var i = 0; i < s.events.length; i++) evs.push(s.events[i]);
      if (evs.length) { if (G.render) G.render.onEvents(evs, s); DOMINO.Audio.onEvents(evs, s); DOMINO.UI.onEvents(evs, s); }
    }
    return QA.st();
  },
  st: function(){ var G = DOMINO.Game, s = G.sim; var scr = (document.getElementById('ui')||{}).getAttribute ? document.getElementById('ui').getAttribute('data-scr') : '';
    return s ? {g: G.state, scr: scr, sim: s.state, why: s.failReason, t: +s.t.toFixed(2), z: +s.p.z.toFixed(1), stock: s.stock, revived: s.revived, id: G.stageId, r: G.renderKind}
             : {g: G.state, scr: scr, r: G.renderKind}; },
  click: function(act){ var b = document.querySelector('.scr.on [data-act="' + act + '"]') || document.querySelector('[data-act="' + act + '"]'); if (!b) return 'nobtn:' + act; b.click(); return 'ok'; },
  btns: function(){ return Array.prototype.map.call(document.querySelectorAll('.scr.on [data-act]'), function(b){ return b.getAttribute('data-act'); }); },
  mem: function(){ var m = performance.memory || {}; return {heapMB: +((m.usedJSHeapSize||0)/1048576).toFixed(1), nodes: document.getElementsByTagName('*').length, gl: JSON.parse(JSON.stringify(window.__gl||{})), plus: (document.getElementById('plus')||{children:[]}).children.length}; }
};
"""


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


class Run:
    def __init__(self, page, out, log):
        self.page, self.out, self.log = page, out, log
        self.n = 0

    def ev(self, js):
        return self.page.evaluate(js)

    def wait(self, ms):
        self.page.wait_for_timeout(ms)

    def shot(self, name):
        self.n += 1
        p = f"{self.out}-{name}.png"
        self.page.screenshot(path=p)
        self.log.append(f"  📷 {p}")
        return p

    def wait_for(self, js, secs=20, step=100):
        t0 = time.time()
        while time.time() - t0 < secs:
            if self.ev(js):
                return True
            self.wait(step)
        return False

    def say(self, *a):
        s = " ".join(str(x) for x in a)
        print(s, flush=True)
        self.log.append(s)


def sc_flow(R, n):
    """タイトル → あそぶ → (ボットで速くクリア)→ リプレイ → 結果 → つぎへ … を n 面"""
    R.wait_for("DOMINO.Game.renderKind && document.querySelector('.s-title.on')", 10)
    R.wait(800)
    R.say("renderer", R.ev("DOMINO.Game.renderKind"), "start mem", R.ev("QA.mem()"))
    R.say("title play:", R.ev("QA.click('play')"), R.ev("QA.st()"))
    for k in range(n):
        R.wait(600)   # ステージの前は 0.4秒 タップを受けない
        st = R.ev("QA.st()")
        if st["g"] != "intro":
            R.say("!! intro でない", st); break
        if k == 0:
            R.shot("flow-intro")
        R.ev("document.querySelector('.s-intro').click()")
        t0 = time.time()
        res = R.ev("QA.ff(60*200, 'bot')")
        R.say(f"stage {st['id']}: ff -> {res}  ({time.time()-t0:.1f}s)")
        ok = R.wait_for("DOMINO.Game.state === 'result'", 5)
        R.wait(400)
        scr = R.ev("QA.st().scr")
        if res["sim"] == "clear":
            if scr == "replay":
                if k % 3 == 0:
                    R.wait(700)
                    if k == 0: R.shot("flow-replay")
                    R.say("  replay skip:", R.ev("QA.click('skipReplay')"))
                else:
                    t1 = time.time()
                    R.wait_for("QA.st().scr === 'result'", 20)
                    R.say(f"  replay ran {time.time()-t1:.1f}s")
            R.wait_for("QA.st().scr === 'result'", 20)
            R.wait(1200)
            if k in (0, n - 1):
                R.shot(f"flow-result{st['id']}")
            R.say("  result btns", R.ev("QA.btns()"), "mem", R.ev("QA.mem()"))
            if k == 4:
                # もう1回 を 1度はさむ
                R.say("  retry:", R.ev("QA.click('retry')"), R.ev("QA.st()"))
                res2 = R.ev("QA.ff(60*200, 'bot')")
                R.say("  retry ff ->", res2)
                R.wait_for("QA.st().scr === 'result' || QA.st().scr === 'replay'", 5)
                R.wait(300)
                if R.ev("QA.st().scr") == "replay": R.ev("QA.click('skipReplay')")
                R.wait(800)
            R.say("  next:", R.ev("QA.click('next')"))
        else:
            R.say("  !! bot failed:", res, "btns", R.ev("QA.btns()"))
            R.shot(f"flow-fail{st['id']}")
            if "skip" in R.ev("QA.btns()"):
                R.ev("QA.click('skip')")
            else:
                R.ev("QA.click('retry')"); R.wait(200)
                R.ev("DOMINO.Game.state==='play' && DOMINO.Game.toMenu()")
                R.ev("DOMINO.Game.play(DOMINO.Game.stageId)")
    R.say("end mem", R.ev("QA.mem()"))


FAILS = {
    # 負け方ごとの 起こし方(stage, 入力 or 仕込み)
    "caught": (1, "s.p.stun = 99; ", None),
    "empty": (1, "s.stock = 0; ", None),
    "fall": (31, "", {}),
    "broken": (31, "s.stock = 1; ", "jump"),
}


def sc_fails(R, n):
    """負け方ごとに: 負け → お助け → 走る → また負け → もう1回 → 3回目で とばす"""
    R.wait_for("DOMINO.Game.renderKind", 10); R.wait(800)
    for why, (sid, setup, inp) in FAILS.items():
        R.ev(f"DOMINO.Save.data.fails[{sid}] = 0; DOMINO.Game.play({sid}); DOMINO.Game.go()")
        R.ev(f"(function(){{ var s = DOMINO.Game.sim; {setup} }})()")
        if inp == "jump":
            # 穴のふちで 1回 ジャンプ(ドミノが足りないので 橋ドミノが できない)
            res = R.ev("""QA.ff(60*30, function(s){ var L = s.level, T = DOMINO.Level.T;
                var ahead = L.at(s.p.x, s.p.z + 0.6) === T.HOLE && !s.p.air; return {steer: 0, jump: ahead}; })""")
        else:
            res = R.ev("QA.ff(60*40, {})")
        R.wait_for("DOMINO.Game.state==='result'", 5); R.wait(500)
        R.say(f"[{why}] 1回目 ->", res, "btns", R.ev("QA.btns()"))
        R.shot(f"fail-{why}-1")
        r = R.ev("QA.click('revive')")
        st = R.ev("QA.st()")
        R.say(f"  お助け: {r}", st)
        # お助けのあと 何もしない入力で どれだけ もつか(caught は stun をはずす)
        R.ev("(function(){ var s = DOMINO.Game.sim; s.p.stun = 0; })()")
        t0 = R.ev("DOMINO.Game.sim.t")
        res2 = R.ev("QA.ff(60*40, 'bot')")
        R.say(f"  お助けのあと(ボット) -> {res2}  もった秒 {res2['t'] - t0:.2f}")
        R.wait_for("DOMINO.Game.state==='result'", 5); R.wait(600)
        R.shot(f"fail-{why}-2")
        R.say("  2回目 btns", R.ev("QA.btns()"), "fails=", R.ev(f"DOMINO.Save.data.fails[{sid}]"))
        if R.ev("DOMINO.Game.state") == "result" and "retry" in R.ev("QA.btns()"):
            R.ev("QA.click('retry')")
            R.ev(f"(function(){{ var s = DOMINO.Game.sim; {setup} }})()")
            R.ev("QA.ff(60*40, {})" if inp != "jump" else """QA.ff(60*30, function(s){ var L = s.level, T = DOMINO.Level.T;
                return {steer: 0, jump: L.at(s.p.x, s.p.z + 0.6) === T.HOLE && !s.p.air}; })""")
            R.wait_for("DOMINO.Game.state==='result'", 5); R.wait(500)
            R.say("  3回目 btns", R.ev("QA.btns()"), "fails=", R.ev(f"DOMINO.Save.data.fails[{sid}]"))
    # とばす
    R.say("skip:", R.ev("QA.click('skip')"), R.ev("QA.st()"), "skipped", R.ev("JSON.stringify(DOMINO.Save.data.skipped)"))


def sc_spam(R, n):
    """連打: やり直し・つぎへ・お助け・とばす・リプレイのとばす"""
    R.wait_for("DOMINO.Game.renderKind", 10); R.wait(800)
    R.ev("DOMINO.Game.play(1); DOMINO.Game.go()")
    R.ev("DOMINO.Game.sim.p.stun = 99"); R.ev("QA.ff(60*40,{})")
    R.wait_for("DOMINO.Game.state==='result'", 5); R.wait(300)
    # もう1回 を 速く 15回(本物のクリックで)
    for i in range(15):
        try:
            R.page.click(".scr.on [data-act=retry]", timeout=300)
        except Exception as e:
            R.say("  retry click", i, "なし:", QA_short(R))
            break
        R.ev("DOMINO.Game.sim.p.stun = 99"); R.ev("QA.ff(60*40,{})")
        R.wait(30)
        R.wait_for("DOMINO.Game.state==='result'", 3)
    R.say("after 15 retry:", R.ev("QA.st()"), R.ev("QA.mem()"))
    # ダブルタップ: 結果の「つぎへ」→ ステージの前が すぐ始まってしまうか
    R.ev("DOMINO.Game.play(1); DOMINO.Game.go()"); R.ev("QA.ff(60*200,'bot')")
    R.wait_for("QA.st().scr==='replay' || QA.st().scr==='result'", 5); R.wait(300)
    # リプレイのとばす を 2回
    if R.ev("QA.st().scr") == "replay":
        R.page.click(".scr.on [data-act=skipReplay]");
        try: R.page.click(".scr.on [data-act=skipReplay]", timeout=300)
        except Exception: pass
    R.wait(500)
    R.say("after skip x2:", R.ev("QA.st()"), R.ev("QA.btns()"))
    box = R.page.locator(".scr.on [data-act=next]").bounding_box()
    R.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, click_count=1)
    R.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, click_count=1, delay=10)
    R.wait(150)
    R.say("next を ダブルタップ:", R.ev("QA.st()"))
    R.shot("spam-dbl-next")
    # お助け ダブル
    R.ev("DOMINO.Game.toMenu(); DOMINO.Game.play(2); DOMINO.Game.go(); DOMINO.Game.sim.p.stun=99"); R.ev("QA.ff(60*40,{})")
    R.wait_for("DOMINO.Game.state==='result'", 5); R.wait(300)
    box = R.page.locator(".scr.on [data-act=revive]").bounding_box()
    R.page.mouse.click(box["x"] + 20, box["y"] + 10); R.page.mouse.click(box["x"] + 20, box["y"] + 10)
    R.wait(100)
    R.say("お助け ダブル:", R.ev("QA.st()"), "input", R.ev("JSON.stringify(DOMINO.Input.state())"))
    # キーボード: 結果画面で Enter 連打
    R.ev("DOMINO.Game.sim.p.stun=99; DOMINO.Game.sim.p.safe=0"); R.ev("QA.ff(60*40,{})")
    R.wait_for("DOMINO.Game.state==='result'", 6); R.wait(300)
    for i in range(5): R.page.keyboard.press("Enter")
    R.wait(100)
    R.say("Enter x5 (fail):", R.ev("QA.st()"))


def QA_short(R):
    return R.ev("JSON.stringify(QA.st())")


def sc_pause(R, n):
    """ポーズ → 再開、ポーズ → やり直す、ポーズ → ステージ選び → また遊ぶ(音の状態も見る)"""
    R.wait_for("DOMINO.Game.renderKind", 10); R.wait(800)
    R.ev("QA.click('play')"); R.wait(300); R.ev("document.querySelector('.s-intro').click()")
    R.wait(1500)
    R.say("play audio:", R.ev("JSON.stringify(DOMINO.Audio.info().state)"), R.ev("QA.st()"))
    R.page.click("#hud .pausebtn"); R.wait(400)
    R.say("paused:", R.ev("QA.st()"), "audio", R.ev("DOMINO.Audio.info().state"))
    R.shot("pause")
    z0 = R.ev("DOMINO.Game.sim.t"); R.wait(800); z1 = R.ev("DOMINO.Game.sim.t")
    R.say("  ポーズ中に時間がすすむ?", z0, z1)
    R.page.click(".scr.on [data-act=resume]"); R.wait(600)
    R.say("resumed:", R.ev("QA.st()"), "audio", R.ev("DOMINO.Audio.info().state"))
    # ポーズ → やり直す
    R.page.click("#hud .pausebtn"); R.wait(300)
    R.page.click(".scr.on [data-act=retry]"); R.wait(1200)
    R.say("pause→retry:", R.ev("QA.st()"), "audio", R.ev("JSON.stringify(DOMINO.Audio.info())"))
    # ポーズ → ステージ選び → 1面
    R.page.click("#hud .pausebtn"); R.wait(300)
    R.page.click(".scr.on [data-act=stagesFromPause]"); R.wait(500)
    R.shot("pause-stages")
    R.page.click(".scr.on .node[data-id='1']"); R.wait(400); R.ev("document.querySelector('.s-intro').click()"); R.wait(1200)
    R.say("pause→stages→play:", R.ev("QA.st()"), "audio", R.ev("JSON.stringify(DOMINO.Audio.info())"))
    # Esc で ポーズ / Esc で もどる
    R.page.keyboard.press("Escape"); R.wait(200); a = R.ev("QA.st()")
    R.page.keyboard.press("Escape"); R.wait(200); b = R.ev("QA.st()")
    R.say("Esc x2:", a["g"], b["g"])
    # ポーズ中に 画面の左を さわって 動くか
    R.page.keyboard.press("Escape"); R.wait(200)
    R.page.mouse.click(50, 600); R.wait(200)
    R.say("ポーズ中に 画面をさわる:", R.ev("QA.st()"))


SAVES = {
    "broken-json": "{bad",
    "null": "null",
    "number": "5",
    "wrong-types": '{"stars":5,"best":"x","settings":"x","skins":null,"skin":"nope"}',
    "string-stars": '{"stars":{"1":"3","2":"2"},"settings":{}}',
    "all-clear": json.dumps({"stars": {str(i): 1 for i in range(1, 101)}}),
}


def sc_save(R, n, ctx, url):
    for name, raw in SAVES.items():
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(f"[pageerror] {e}"))
        pg.add_init_script("try{localStorage.setItem('domino-save-v1', %s)}catch(e){}" % json.dumps(raw))
        pg.goto(url); pg.wait_for_timeout(1800)
        info = pg.evaluate("""JSON.stringify({scr: document.getElementById('ui').getAttribute('data-scr'), sub: (document.getElementById('tPlaySub')||{}).textContent,
            stars: (document.getElementById('tStars')||{}).textContent, total: DOMINO.Save.totalStars(), unl: DOMINO.Save.unlocked(), skin: DOMINO.Save.data.skin,
            snd: DOMINO.Save.data.settings && DOMINO.Save.data.settings.sound})""")
        R.say(f"[save {name}] {info} errs={errs[:3]}")
        try:
            pg.click(".scr.on [data-act=play]", timeout=1000, force=True); pg.wait_for_timeout(400)
            R.say("   play ->", pg.evaluate("JSON.stringify(QA.st())"), errs[:3])
            pg.evaluate("DOMINO.Game.toMenu()"); pg.click(".scr.on [data-act=skins]", timeout=1000, force=True); pg.wait_for_timeout(300)
            pg.evaluate("DOMINO.Game.toMenu()"); pg.click(".scr.on [data-act=settings]", timeout=1000, force=True); pg.wait_for_timeout(300)
            R.say("   skins/settings ok", errs[:3])
            if name in ("wrong-types", "all-clear"):
                pg.evaluate("DOMINO.Game.toMenu()"); pg.wait_for_timeout(300)
                pg.screenshot(path=f"{R.out}-save-{name}.png"); R.log.append(f"  📷 {R.out}-save-{name}.png")
        except Exception as e:
            R.say("   !! 操作できない", str(e)[:200], errs[:3])
        pg.close()
    # localStorage が使えない
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(f"[pageerror] {e}"))
    pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
    pg.add_init_script("Object.defineProperty(window, 'localStorage', { get: function(){ throw new Error('SecurityError'); } });")
    pg.goto(url); pg.wait_for_timeout(1800)
    R.say("[no localStorage]", pg.evaluate("JSON.stringify(QA.st())"), errs[:5])
    try:
        pg.click(".scr.on [data-act=play]", timeout=1000, force=True); pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('.s-intro').click()")
        pg.evaluate("QA.ff(60*200,'bot')"); pg.wait_for_timeout(1500)
        R.say("   played ->", pg.evaluate("JSON.stringify(QA.st())"), errs[:5])
    except Exception as e:
        R.say("   !!", str(e)[:200], errs[:5])
    pg.close()


def sc_orient(R, n):
    R.wait_for("DOMINO.Game.renderKind", 10); R.wait(800)
    R.ev("DOMINO.Game.play(13); DOMINO.Game.go()"); R.wait(2500)
    R.shot("orient-portrait")
    R.page.set_viewport_size({"width": 844, "height": 390}); R.wait(1200)
    R.shot("orient-landscape-play")
    R.page.click("#hud .pausebtn"); R.wait(400); R.shot("orient-landscape-pause")
    R.page.click(".scr.on [data-act=resume]")
    R.ev("DOMINO.Game.sim.p.stun=99"); R.ev("QA.ff(60*40,{})"); R.wait_for("DOMINO.Game.state==='result'", 5); R.wait(600)
    R.shot("orient-landscape-fail")
    R.ev("DOMINO.Game.toMenu()"); R.wait(400); R.shot("orient-landscape-title")
    R.ev("DOMINO.UI.openStages(1)"); R.wait(400); R.shot("orient-landscape-stages")
    R.page.set_viewport_size({"width": 320, "height": 568}); R.wait(800)
    R.shot("orient-320-stages")
    R.ev("DOMINO.Game.play(1)"); R.wait(500); R.shot("orient-320-intro")
    R.ev("DOMINO.Game.go()"); R.ev("QA.ff(60*200,'bot')"); R.wait_for("QA.st().scr==='replay'||QA.st().scr==='result'", 5)
    R.ev("QA.click('skipReplay')"); R.wait(1500); R.shot("orient-320-result")
    R.ev("DOMINO.Game.play(1); DOMINO.Game.go(); DOMINO.Game.sim.p.stun=99"); R.ev("QA.ff(60*40,{})")
    R.wait_for("DOMINO.Game.state==='result'", 5); R.wait(600); R.shot("orient-320-fail")
    R.ev("DOMINO.Game.toMenu()"); R.wait(300); R.ev("QA.click('skins')"); R.wait(300); R.shot("orient-320-skins")
    R.ev("DOMINO.Game.toMenu()"); R.wait(300); R.ev("QA.click('settings')"); R.wait(300); R.shot("orient-320-settings")


def hide(R, on):
    R.ev("""(function(on){ Object.defineProperty(document, 'hidden', {configurable:true, get: function(){ return on; }});
        Object.defineProperty(document, 'visibilityState', {configurable:true, get: function(){ return on ? 'hidden' : 'visible'; }});
        document.dispatchEvent(new Event('visibilitychange')); })(%s)""" % ("true" if on else "false"))


def sc_hide(R, n):
    R.wait_for("DOMINO.Game.renderKind", 10); R.wait(800)
    R.ev("DOMINO.Game.play(1)"); hide(R, True); R.wait(300)
    R.say("intro で隠す:", R.ev("QA.st()"), R.ev("DOMINO.Audio.info().state")); hide(R, False); R.wait(300)
    R.say("  もどす:", R.ev("QA.st()"), R.ev("DOMINO.Audio.info().state"))
    R.ev("DOMINO.Game.go()"); R.wait(800); hide(R, True); R.wait(300)
    R.say("play で隠す:", R.ev("QA.st()"), R.ev("DOMINO.Audio.info().state")); hide(R, False); R.wait(300)
    R.say("  もどす:", R.ev("QA.st()"), R.ev("DOMINO.Audio.info().state"))
    R.page.click(".scr.on [data-act=resume]"); R.wait(300)
    R.say("  つづける:", R.ev("QA.st()"), R.ev("DOMINO.Audio.info().state"))
    R.ev("QA.ff(60*200,'bot')"); R.wait_for("QA.st().scr==='replay'", 5); hide(R, True); R.wait(300)
    R.say("replay で隠す:", R.ev("QA.st()"), R.ev("DOMINO.Audio.info().state")); hide(R, False); R.wait(300)
    R.wait_for("QA.st().scr==='result'", 15)
    R.say("  結果:", R.ev("QA.st()"), R.ev("DOMINO.Audio.info().state"))


def sc_mem(R, n):
    """同じ面を n 回 やり直し・つぎへ を くり返して、メモリ・WebGL の数が ふえ続けないか"""
    R.wait_for("DOMINO.Game.renderKind", 10); R.wait(1500)
    R.say("renderer", R.ev("DOMINO.Game.renderKind"))
    for k in range(n):
        sid = 1 + (k % 20)
        R.ev(f"DOMINO.Game.play({sid}); DOMINO.Game.go()")
        R.ev("QA.ff(60*8, {steer: 0.3})")
        R.wait(120)
        if k % 10 == 9:
            R.ev("window.gc && gc()"); R.wait(200)
            R.say(f"  {k+1}回目 mem", R.ev("QA.mem()"))


def sc_js(R, n):
    """--js の JS を そのまま実行して 結果を出す(1行ずつ ';;' で区切ると 間に 300ms 待つ)"""
    R.wait_for("DOMINO.Game.renderKind", 10); R.wait(800)
    for part in R.js.split(";;"):
        if part.strip().startswith("SHOT:"):
            R.shot(part.strip()[5:]); continue
        if part.strip().startswith("WAIT:"):
            R.wait(int(part.strip()[5:])); continue
        R.say(">", part.strip()[:80], "=>", R.ev(part))
        R.wait(300)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("--2d", dest="d2", action="store_true")
    ap.add_argument("--size", default="390x844")
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--hash", default="")
    ap.add_argument("--js", default="")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    out = ROOT / "_check" / ("qa-" + a.scene + ("-2d" if a.d2 else ""))
    out.parent.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(NoCache, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    log, errors = [], []
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        w, h = (int(x) for x in a.size.split("x"))
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path=CHROME, headless=True,
                                   args=["--mute-audio", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist",
                                         "--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc", "--enable-precise-memory-info"])
            ctx = br.new_context(viewport={"width": w, "height": h})
            ctx.add_init_script(INIT_JS)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
            hsh = "noinstall" + ("&2d" if a.d2 else "") + (("&" + a.hash) if a.hash else "")
            url = f"http://127.0.0.1:{port}/index.html?t=1#{hsh}"
            R = Run(page, str(out), log)
            R.js = a.js
            if a.scene == "save":
                sc_save(R, a.n, ctx, url)
            else:
                page.goto(url)
                t0 = time.time()
                try:
                    globals()["sc_" + a.scene](R, a.n)
                except Exception as e:
                    R.say("!! 道具のエラー:", repr(e)[:400])
                    try: R.shot("crash")
                    except Exception: pass
                R.say(f"time {time.time()-t0:.0f}s")
            br.close()
        srv.shutdown()
    print("errors/warnings:", len(errors))
    for e in errors[:40]:
        print("  ", e[:400])
    for l in log:
        if l.startswith("  📷"): print(l)


if __name__ == "__main__":
    main()
