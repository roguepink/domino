/* input.js — さわった・押したを、sim に渡す形 { steer: -1..1, jump: true/false } にする。(UI・UX係)
 *
 * スマホ:
 *   - 画面の左がわ(はば 58%)を さわったまま 左右になぞる = 左右に動く。
 *     「指にすいつく」方式: 指を動かした長さ = 主人公が動く長さ(画面の左がわ いっぱい ≒ コースのはば)。
 *     指を止めれば 主人公も止まる。小さく動かしても 少しだけ動く。行きすぎない(先を読んで ブレーキ)。
 *     かべで止まったときは、目標が 主人公の近くまで もどる(はなれたまま 急に飛ばない)。
 *   - 右がわを タップ = ジャンプ(さわった瞬間)。左で動かしながら 右でジャンプ(2本指)も OK。
 *   - 指の下に うすい目印(輪 = 指、点 = 主人公が今いる所。追いつくと重なる)
 * パソコン: ← → / A D で左右、スペース・↑・W でジャンプ、Esc・P でポーズ
 *
 * DOMINO.Input.read() を main が 1/60 秒ごとに呼ぶ。jump は 押した瞬間の1回だけ true。
 * Input.enable(on) は main が切りかえる(ステージの前・結果の画面では 入力にしない)。
 * PointerEvent がない古い iPhone(iOS 12 以前)では touch で同じことをする。
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Input = (function () {
  var el = null, enabled = false;
  var SPLIT = 0.58;          // 左がわの はば(この割合より左が 左右の操作)
  var steerTouch = null;     // { id, x0, x, tx(目標の x m), lastX }
  var jumpQueued = false;
  var keys = {};
  var mark = null, markRing = null, markDot = null;

  // 指 1px = 何 m か。左がわ いっぱいで コースのはば(9m)より少し少ないくらい
  function pxPerM() {
    var w = Math.min(window.innerWidth, 900) * SPLIT;
    return Math.max(20, Math.min(36, w / 8));
  }
  function simNow() { var G = DOMINO.Game; return G && G.sim && G.state === 'play' ? G.sim : null; }
  function halfW() { return ((DOMINO.CONFIG && DOMINO.CONFIG.COLS) || 9) / 2 - 0.35; }

  // ---- 指が ふれた・動いた・はなれた(pointer と touch の両方から呼ぶ) ----
  function down(id, x, y) {
    if (!enabled) return false;
    var w = window.innerWidth;
    if (x < w * SPLIT && !steerTouch) {
      var s = simNow();
      steerTouch = { id: id, x0: x, x: x, y: y, tx: s ? s.p.x : 0 };
      showMark(x, y);
    } else jumpQueued = true;
    return true;
  }
  function move(id, x, y) {
    if (!steerTouch || id !== steerTouch.id) return;
    var dx = x - steerTouch.x;
    steerTouch.x = x; steerTouch.y = y;
    // 目標の位置を 指の動いた分だけ ずらす
    var H = halfW();
    steerTouch.tx = Math.max(-H, Math.min(H, steerTouch.tx + dx / pxPerM()));
  }
  function up(id) {
    if (steerTouch && id === steerTouch.id) { steerTouch = null; hideMark(); }
  }

  // ---- pointer ----
  function onPDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (down(e.pointerId, e.clientX, e.clientY) && e.cancelable) e.preventDefault();
    try { if (el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (er) {}
  }
  function onPMove(e) { if (steerTouch && e.pointerId === steerTouch.id) { move(e.pointerId, e.clientX, e.clientY); if (e.cancelable) e.preventDefault(); } }
  function onPUp(e) { up(e.pointerId); }

  // ---- touch(PointerEvent がない端末だけ) ----
  function onTStart(e) {
    var used = false;
    for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; if (down(t.identifier, t.clientX, t.clientY)) used = true; }
    if (used && e.cancelable) e.preventDefault();
  }
  function onTMove(e) {
    for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; move(t.identifier, t.clientX, t.clientY); }
    if (steerTouch && e.cancelable) e.preventDefault();
  }
  function onTEnd(e) { for (var i = 0; i < e.changedTouches.length; i++) up(e.changedTouches[i].identifier); }

  function attach(target) {
    el = target;
    if (window.PointerEvent) {
      el.addEventListener('pointerdown', onPDown, { passive: false });
      window.addEventListener('pointermove', onPMove, { passive: false });
      window.addEventListener('pointerup', onPUp);
      window.addEventListener('pointercancel', onPUp);
    } else {
      el.addEventListener('touchstart', onTStart, { passive: false });
      window.addEventListener('touchmove', onTMove, { passive: false });
      window.addEventListener('touchend', onTEnd);
      window.addEventListener('touchcancel', onTEnd);
      el.addEventListener('mousedown', function (e) { if (down('m', e.clientX, e.clientY)) e.preventDefault(); });
      window.addEventListener('mousemove', function (e) { move('m', e.clientX, e.clientY); });
      window.addEventListener('mouseup', function () { up('m'); });
    }
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', function (e) {
      var G = DOMINO.Game;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (G && G.state === 'play') { G.pause(); e.preventDefault(); }
        else if (G && G.state === 'paused') { G.resume(); e.preventDefault(); }
        return;
      }
      if (!enabled) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { if (!e.repeat) jumpQueued = true; e.preventDefault(); }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
      keys[e.code] = true;
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { keys = {}; steerTouch = null; hideMark(); });

    mark = document.createElement('div'); mark.id = 'steerMark';
    markRing = document.createElement('i'); markRing.className = 'ring';
    markDot = document.createElement('b'); markDot.className = 'dot';
    mark.appendChild(markDot); mark.appendChild(markRing);
    document.body.appendChild(mark);
  }

  function showMark(x, y) { if (!mark) return; mark.className = 'on'; placeMark(x, y, 0); }
  function hideMark() { if (mark) mark.className = ''; }
  function placeMark(x, y, lagPx) {
    mark.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    markDot.style.transform = 'translateX(' + Math.round(lagPx) + 'px)';
  }

  function read() {
    var steer = 0, s = simNow();
    if (steerTouch) {
      if (s) {
        var p = s.p, C = DOMINO.CONFIG;
        // 目標は 主人公から 4m まで(はなれすぎない)
        var LEAD = 4, gap = steerTouch.tx - p.x;
        if (gap > LEAD) steerTouch.tx = p.x + LEAD; else if (gap < -LEAD) steerTouch.tx = p.x - LEAD;
        // かべで 横に動けないときだけ、目標を 主人公の近くへ少しずつ寄せる(はなれたまま 急に飛ばない)
        if (p.stun <= 0 && Math.abs(p.vx) < 0.8 && Math.abs(gap) > 0.5) steerTouch.bt = (steerTouch.bt || 0) + C.DT; else steerTouch.bt = 0;
        if (steerTouch.bt > 0.12) steerTouch.tx -= (gap > 0 ? 1 : -1) * 5 * C.DT;
        // 先読み(今の速さで 少し先の位置)で 行きすぎを ふせぐ
        var err = steerTouch.tx - (p.x + p.vx * 0.06);
        if (Math.abs(err) < 0.02) err = 0;
        steer = err * 11 / C.SIDE;
        placeMark(steerTouch.x, steerTouch.y, -(steerTouch.tx - p.x) * pxPerM());
      } else {
        steer = (steerTouch.x - steerTouch.x0) / 46;   // sim がないとき(念のため): 昔ながらの スティック
      }
    }
    if (keys.ArrowLeft || keys.KeyA) steer -= 1;
    if (keys.ArrowRight || keys.KeyD) steer += 1;
    var j = jumpQueued; jumpQueued = false;
    return { steer: Math.max(-1, Math.min(1, steer)), jump: j };
  }

  return {
    attach: attach, read: read, SPLIT: SPLIT,
    enable: function (on) { enabled = on; if (!on) { steerTouch = null; jumpQueued = false; keys = {}; hideMark(); } },
    state: function () { return { steering: !!steerTouch, steerX0: steerTouch && steerTouch.x0, steerX: steerTouch && steerTouch.x, target: steerTouch && steerTouch.tx }; }
  };
})();
