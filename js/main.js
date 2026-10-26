/* main.js — 全体をつなぐ(まとめ役)。画面の流れ・時間・保存。
 *
 *   DOMINO.Game.play(id)    ステージ id を始める(ステージの前の「タップでスタート」の画面から)
 *   Game.go()               走り出す(スタートのタップ)
 *   Game.retry() / next() / revive() / skip() / toMenu() / pause() / resume()
 *   Game.slowmo(scale, sec) ゆっくりにする(0.25 = 4分の1の速さ)   Game.hitstop(sec) 一瞬止める
 *   Game.state  'menu' | 'intro' | 'play' | 'paused' | 'result'
 *   Game.sim    今のステージの計算(sim.js)
 *
 * 係の部品(なくても動く。あれば つなぐ):
 *   DOMINO.UI     画面(ui.js)      DOMINO.Audio  音(audio.js)      DOMINO.Render  絵(3D か 2D)
 * 部品がそろったら window.__stats に数字を出す(確認の道具が読む)。
 * アドレスの印: #play=ステージ番号(すぐ始まる)/ #auto(自動で遊ぶ)/ #2d(2Dの絵)/ #noinstall
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Game = (function () {
  var C = DOMINO.CONFIG;
  var G = {
    state: 'menu', sim: null, stageId: 1, stage: null, render: null,
    timeScale: 1, slowT: 0, slowScale: 1, stopT: 0,
    auto: /auto/.test(location.hash), autoBot: null,
    events: [], fps: 0, resultShown: false, playT: 0
  };
  var box = document.getElementById('view');
  var hashArgs = {};
  (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) { if (!kv) return; var a = kv.split('='); hashArgs[a[0]] = a[1] == null ? true : decodeURIComponent(a[1]); });

  function stageById(id) {
    var S = DOMINO.STAGES || [];
    for (var i = 0; i < S.length; i++) if (S[i].id === id) return S[i];
    return S[0];
  }

  function unpauseAudio() { if (G.audioPaused && DOMINO.Audio && DOMINO.Audio.pause) DOMINO.Audio.pause(false); G.audioPaused = false; }
  G.play = function (id) {
    unpauseAudio();
    G.stageId = id; G.stage = stageById(id);
    G.sim = new DOMINO.Sim(G.stage);
    G.resultShown = false; G.playT = 0;
    G.timeScale = 1; G.slowT = 0; G.stopT = 0;
    if (G.render) G.render.setSim(G.sim, G.stage);
    if (DOMINO.Audio && DOMINO.Audio.stage) DOMINO.Audio.stage(G.stage);
    G.state = 'intro';
    DOMINO.Input.enable(false);
    if (DOMINO.UI) DOMINO.UI.showIntro(G.stage, G.sim);
    if (G.auto || hashArgs.go) setTimeout(G.go, 300);
  };
  G.go = function () {
    if (G.state !== 'intro') return;
    G.state = 'play';
    DOMINO.Input.enable(true);
    if (DOMINO.UI) DOMINO.UI.showHud(G.sim);
    if (DOMINO.Audio && DOMINO.Audio.start) DOMINO.Audio.start(G.stage);
  };
  G.retry = function () { G.play(G.stageId); G.go(); };
  G.next = function () {
    var S = DOMINO.STAGES, idx = S.indexOf(G.stage);
    if (idx >= 0 && idx < S.length - 1) G.play(S[idx + 1].id); else G.toMenu();
  };
  G.revive = function () {
    if (!G.sim || !G.sim.revive()) return false;
    G.resultShown = false; G.state = 'play';
    DOMINO.Input.enable(true);
    if (DOMINO.UI) DOMINO.UI.showHud(G.sim);
    return true;
  };
  G.skip = function () {
    var sv = DOMINO.Save.data; sv.skipped[G.stageId] = true; DOMINO.Save.write();
    G.next();
  };
  G.toMenu = function () {
    unpauseAudio();
    G.state = 'menu'; DOMINO.Input.enable(false);
    if (DOMINO.Audio && DOMINO.Audio.stop) DOMINO.Audio.stop();
    if (DOMINO.UI) DOMINO.UI.showMenu();
  };
  G.pause = function () {
    if (G.state !== 'play') return;
    G.state = 'paused'; DOMINO.Input.enable(false);
    if (DOMINO.Audio && DOMINO.Audio.pause) { DOMINO.Audio.pause(true); G.audioPaused = true; }
    if (DOMINO.UI) DOMINO.UI.showPause();
  };
  G.resume = function () {
    if (G.state !== 'paused') return;
    G.state = 'play'; DOMINO.Input.enable(true);
    if (DOMINO.Audio && DOMINO.Audio.pause) { DOMINO.Audio.pause(false); G.audioPaused = false; }
    if (DOMINO.UI) DOMINO.UI.showHud(G.sim);
  };
  G.slowmo = function (scale, sec) { G.slowScale = scale; G.slowT = sec; };
  G.hitstop = function (sec) { G.stopT = Math.max(G.stopT, sec); };

  // 結果を覚えて、画面の係に渡す
  function finish() {
    var s = G.sim, sv = DOMINO.Save.data, id = G.stageId;
    var clear = s.state === 'clear';
    var stars = s.starResult();
    var prevBest = sv.best[id] || 0, prevStars = sv.stars[id] || 0;
    var unlockedBefore = DOMINO.Save.unlocked();
    if (clear) {
      sv.stars[id] = Math.max(prevStars, stars);
      if (s.score > prevBest) sv.best[id] = s.score;
      sv.coins += s.coins + stars * 5;
      sv.fails[id] = 0;
    } else if (!s.revived) sv.fails[id] = (sv.fails[id] || 0) + 1;   // お助けのあとの負けは 同じ1回として数える
    DOMINO.Save.write();
    var res = {
      stage: G.stage, clear: clear, stars: stars, prevStars: prevStars, score: s.score, best: Math.max(prevBest, clear ? s.score : 0),
      newRecord: clear && s.score > prevBest, reason: s.failReason, canRevive: !clear && !s.revived,
      fails: sv.fails[id] || 0, canSkip: !clear && (sv.fails[id] || 0) >= 3,
      goldGot: s.stars, goldTotal: s.starsTotal, near: s.nearCount, nearGoal: s.cfg.nearGoal,
      dominoes: s.doms.length, progress: s.progress, unlockedNew: DOMINO.Save.unlocked() > unlockedBefore
    };
    G.lastResult = res;
    DOMINO.Input.enable(false);
    if (DOMINO.UI) DOMINO.UI.showResult(res, s);
  }

  // ボット(#auto): 少し先を読んで 安全で 前に進める入力を選ぶ。確認用(ステージ設計係が tools/bot.js で強くする)
  function autoInput(s) {
    if (DOMINO.Bot) return DOMINO.Bot.input(s);
    if (!G.autoBot || G.autoBot.t <= 0) {
      var best = null, bestScore = -1e9;
      var cands = [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [-0.5, 0], [0.5, 0]];
      for (var k = 0; k < cands.length; k++) {
        var c = s.clone(), ok = 0;
        for (var n = 0; n < 60; n++) {
          c.step({ steer: cands[k][0], jump: n === 0 && cands[k][1] === 1 });
          if (c.state === 'fail') break;
          ok++;
        }
        var sc = ok * 10 + c.p.z * 3 + c.stock * 0.2 + c.stars * 30 - (cands[k][1] ? 2 : 0) + (c.state === 'goal' || c.state === 'clear' ? 1000 : 0);
        if (sc > bestScore) { bestScore = sc; best = cands[k]; }
      }
      G.autoBot = { steer: best[0], jump: best[1] === 1, t: 0.2 };
      return { steer: G.autoBot.steer, jump: G.autoBot.jump };
    }
    G.autoBot.t -= C.DT;
    return { steer: G.autoBot.steer, jump: false };
  }

  // 1コマごと
  var last = 0, acc = 0, fpsN = 0, fpsT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    try {
      var rdt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
      fpsN++; fpsT += rdt; if (fpsT >= 1) { G.fps = fpsN; fpsN = 0; fpsT = 0; }
      var dt = rdt;
      if (G.stopT > 0) { G.stopT -= rdt; dt = 0; }
      else if (G.slowT > 0) { G.slowT -= rdt; dt *= G.slowScale; }
      var evs = G.events; evs.length = 0;
      if (G.sim && (G.state === 'play' || G.state === 'result')) {
        acc += Math.min(dt, 0.05);
        var steps = 0;
        while (acc >= C.DT && steps < 5) {
          var inp = G.state === 'play' ? (G.auto ? autoInput(G.sim) : DOMINO.Input.read()) : {};
          G.sim.step(inp);
          for (var i = 0; i < G.sim.events.length; i++) evs.push(G.sim.events[i]);
          acc -= C.DT; steps++;
        }
        if (G.state === 'play') G.playT += dt;
        if (G.state === 'play' && (G.sim.state === 'fail' && G.sim.endT > 0.9 || G.sim.state === 'clear' && G.sim.endT > 0.5)) {
          G.state = 'result'; finish();
        }
      }
      if (evs.length) {
        if (G.render) G.render.onEvents(evs, G.sim);
        if (DOMINO.Audio && DOMINO.Audio.onEvents) DOMINO.Audio.onEvents(evs, G.sim);
        if (DOMINO.UI && DOMINO.UI.onEvents) DOMINO.UI.onEvents(evs, G.sim);
      }
      try { if (G.render) G.render.render(dt, rdt); } catch (e2) { console.error(e2); }   // 絵の失敗で 音・画面が止まらないように
      if (DOMINO.Audio && DOMINO.Audio.update && G.sim) DOMINO.Audio.update(G.sim, dt, G.state);
      if (DOMINO.UI && DOMINO.UI.update && G.sim) DOMINO.UI.update(G.sim, G.state, rdt);
      var s = G.sim;
      window.__stats = s ? { fps: G.fps, state: G.state, sim: s.state, why: s.failReason, t: +s.t.toFixed(2), z: +s.p.z.toFixed(1),
        doms: s.doms.length, stock: s.stock, danger: +s.danger.toFixed(2), score: s.score, stars: s.stars, near: s.nearCount,
        renderer: G.renderKind } : { fps: G.fps, state: G.state, renderer: G.renderKind };
    } catch (e) { console.error(e); }
  }

  function useRenderer(r, kind) {
    if (G.render && G.render.dispose) G.render.dispose();
    G.render = r; G.renderKind = kind; DOMINO.Render = r;
    r.init(box);
    if (G.sim) r.setSim(G.sim, G.stage);
  }

  function boot() {
    DOMINO.Input.attach(box);
    window.addEventListener('resize', function () { if (G.render) G.render.resize(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) G.pause(); });
    if (DOMINO.UI) DOMINO.UI.init(G);
    // 3D を読みこむ。だめなら 2D で遊べる
    var want3d = !hashArgs['2d'];
    var start = function () {
      if (hashArgs.play) { G.play(+hashArgs.play || 1); if (hashArgs.go || G.auto) setTimeout(G.go, 200); }
      else if (G.auto) { G.play(1); }
      else G.toMenu();
    };
    useRenderer(DOMINO.Render2D, '2d');
    start();
    if (want3d) {
      var ok = false;
      try {
        // 動的 import は 古い端末だと ここで文法エラーになることがあるので Function で包む
        var imp = new Function('u', 'return import(u)');
        imp(new URL('js/render3d.js?v=' + (DOMINO.BUILD || 1), document.baseURI).href).then(function (m) {
          var R = m && m.default;
          if (R && R.supported()) { useRenderer(R, '3d'); ok = true; }
        }).catch(function (e) { console.warn('3D が使えないので 2D で表示します', e && e.message); });
      } catch (e) { console.warn('3D が使えないので 2D で表示します'); }
    }
    requestAnimationFrame(function (t) { last = t; loop(t); });
  }

  G.boot = boot;
  return G;
})();
