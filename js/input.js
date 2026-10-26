/* input.js — さわった・押したを、sim に渡す形 { steer: -1..1, jump: true/false } にする。
 * (まとめ役の仮。UI・UX係が さわり心地を仕上げる)
 *   スマホ: 画面の左がわ(はば 58%)を さわったまま 左右になぞる = 左右に動く。右がわを タップ = ジャンプ
 *   パソコン: ← → (A D) で左右、スペース・↑・W でジャンプ
 * DOMINO.Input.read() を 1/60 秒ごとに呼ぶ。jump は 押した瞬間の1回だけ true。
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Input = (function () {
  var el = null, enabled = false;
  var steerTouch = null;     // { id, x0, x }
  var jumpQueued = false;
  var keys = {};
  var SPLIT = 0.58;          // 左がわの はば(この割合より左が 左右の操作)
  var FULL = 46;             // 指を この px 動かすと いちばん速く動く

  function attach(target) {
    el = target;
    el.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', function (e) {
      if (!enabled) return;
      if (e.repeat) return;
      keys[e.code] = true;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { jumpQueued = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { keys = {}; steerTouch = null; });
  }

  function onDown(e) {
    if (!enabled) return;
    var w = window.innerWidth;
    if (e.clientX < w * SPLIT && !steerTouch) {
      steerTouch = { id: e.pointerId, x0: e.clientX, x: e.clientX };
    } else jumpQueued = true;
    if (e.cancelable) e.preventDefault();
  }
  function onMove(e) {
    if (!steerTouch || e.pointerId !== steerTouch.id) return;
    steerTouch.x = e.clientX;
    // 指の元の位置を少しずつ ついてこさせる(行きすぎても すぐ もどせるように)
    var d = steerTouch.x - steerTouch.x0;
    if (d > FULL) steerTouch.x0 = steerTouch.x - FULL; else if (d < -FULL) steerTouch.x0 = steerTouch.x + FULL;
  }
  function onUp(e) { if (steerTouch && e.pointerId === steerTouch.id) steerTouch = null; }

  function read() {
    var steer = 0;
    if (steerTouch) steer = (steerTouch.x - steerTouch.x0) / FULL;
    if (keys.ArrowLeft || keys.KeyA) steer -= 1;
    if (keys.ArrowRight || keys.KeyD) steer += 1;
    var j = jumpQueued; jumpQueued = false;
    return { steer: Math.max(-1, Math.min(1, steer)), jump: j };
  }

  return {
    attach: attach, read: read,
    enable: function (on) { enabled = on; if (!on) { steerTouch = null; jumpQueued = false; keys = {}; } },
    state: function () { return { steering: !!steerTouch, steerX0: steerTouch && steerTouch.x0, steerX: steerTouch && steerTouch.x }; }
  };
})();
