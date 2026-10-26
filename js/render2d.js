/* render2d.js — 3D が動かない古い端末のための、真上から見た 2D の絵(代わり)。確認にも使う。
 * 3D の係(render3d.js)と同じ形: DOMINO.Render2D = { init(box), setSim(sim), onEvents(list), render(dt), resize(), replay(), dispose() }
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Render2D = (function () {
  var cv, ctx, sim = null, camZ = 0, W = 0, H = 0, dpr = 1, shake = 0;
  var COL = {
    bg: '#20163f', floor: '#f2e6cf', floor2: '#eadbbf', wall: '#6b4f9e', mud: '#8a6a43', boost: '#46d1ff', ice: '#bfe9ff',
    belt: '#9aa0b5', spike: '#ff5a6a', sw: '#ffd23f', gate: '#ff8f3f', sink: '#4fa3ff', spring: '#6be36b'
  };

  function init(box) {
    cv = document.createElement('canvas');
    cv.className = 'view2d';
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    box.appendChild(cv);
    ctx = cv.getContext('2d');
    resize();
  }
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth || window.innerWidth; H = cv.clientHeight || window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  function setSim(s) { sim = s; camZ = s.p.z; }
  function onEvents(list) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.type === 'bump' || e.type === 'stun' || e.type === 'bomb' || e.type === 'giant') shake = 0.25;
    }
  }

  function render(dt) {
    if (!sim) return;
    var T = DOMINO.Level.T, L = sim.level, p = sim.p, C = DOMINO.CONFIG;
    camZ += (p.z + 3 - camZ) * Math.min(1, dt * 6);
    var scale = Math.min(W / (L.cols + 1.5), H / 16);
    var ox = W / 2, oy = H * 0.72;
    if (shake > 0) { shake -= dt; ox += (Math.random() - 0.5) * 8; oy += (Math.random() - 0.5) * 8; }
    function sx(x) { return ox + x * scale; }
    function sy(z) { return oy - (z - camZ + 3) * scale; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    var z0 = Math.max(0, Math.floor(camZ - 8)), z1 = Math.min(L.rows + 12, Math.ceil(camZ + 16));
    for (var r = z0; r < z1; r++) {
      for (var c = 0; c < L.cols; c++) {
        var x = c - L.cols / 2, t = r < L.rows ? sim.cellAt(x + 0.5, r + 0.5) : T.FLOOR;
        if (t === T.HOLE) continue;
        var col = (r + c) % 2 ? COL.floor : COL.floor2;
        if (t === T.WALL) col = COL.wall; else if (t === T.MUD) col = COL.mud; else if (t === T.BOOST) col = COL.boost;
        else if (t === T.ICE) col = COL.ice; else if (t === T.BELT_L || t === T.BELT_R) col = COL.belt; else if (t === T.SPIKE) col = COL.spike;
        else if (t === T.SWITCH) col = COL.sw; else if (t === T.SPRING) col = COL.spring;
        else if (t === T.GATE) col = sim.gateOpen[L.group[r * L.cols + c]] ? COL.floor : COL.gate;
        else if (t === T.SINK) col = sim.sunk(r + 0.5) ? '#2d5f9e' : COL.sink;
        if (r === L.goalZ) col = (c % 2) ? '#222' : '#fff';
        ctx.fillStyle = col;
        ctx.fillRect(sx(x), sy(r + 1), scale + 0.5, scale + 0.5);
      }
    }
    // 特別なマス
    sim.specials.forEach(function (sp) {
      ctx.fillStyle = sp.t === 'bomb' ? (sp.done ? '#555' : '#222') : sp.t === 'big' ? (sp.done ? '#bbb' : '#ff4f8b') : '#b07cff';
      var s2 = sp.t === 'big' ? 0.9 : 0.4;
      ctx.fillRect(sx(sp.x) - s2 * scale / 2, sy(sp.z) - s2 * scale / 2, s2 * scale, s2 * scale);
    });
    // 仕掛け
    sim.objs.forEach(function (o) {
      if (o.t === 'gate' || o.t === 'split') {
        ctx.fillStyle = o.used ? 'rgba(120,120,120,.4)' : (o.t === 'split' ? 'rgba(180,90,255,.7)' : o.op === '-' ? 'rgba(255,70,70,.7)' : 'rgba(60,160,255,.7)');
        var w2 = (o.w || 3) * scale;
        ctx.fillRect(sx(o.x) - w2 / 2, sy(o.z + 1), w2, scale * 0.5);
        ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(scale * 0.5) + 'px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(o.t === 'split' ? '2れつ' : (o.op === 'x' ? '×' : o.op) + o.n, sx(o.x), sy(o.z + 1) + scale * 0.45);
      } else if (o.t === 'saw' || o.t === 'ball' || o.t === 'hammer') {
        ctx.fillStyle = o.t === 'saw' ? '#e33' : o.t === 'ball' ? '#555' : '#a63';
        ctx.beginPath(); ctx.arc(sx(o.hx), sy(o.hz), scale * 0.5, 0, 6.283); ctx.fill();
      }
    });
    sim.rivals.forEach(function (rv) {
      drawDom(rv.x, rv.z, Math.PI, rv.t0 < 0 ? 0 : Math.min(1, (sim.t - rv.t0) / C.FALL_TIME) * 1.5, '#333', 1);
    });
    // アイテム
    sim.items.forEach(function (it) {
      if (it.taken) return;
      ctx.fillStyle = it.t === 'star' ? '#ffd700' : it.t === 'coin' ? '#ffb800' : it.t === 'bigbox' ? '#d2691e' : '#e8a050';
      var rr = it.t === 'bigbox' ? 0.4 : 0.28;
      ctx.beginPath(); ctx.arc(sx(it.x), sy(it.z), rr * scale, 0, 6.283); ctx.fill();
    });
    // ドミノ
    var d = sim.doms, n = d.length;
    for (var i = 0; i < n; i++) {
      var dm = d[i];
      if (dm.z < camZ - 9 || dm.z > camZ + 16) continue;
      var a = 0;
      if (dm.st > 0) { var u = Math.min(1, (sim.t - dm.t0) / C.FALL_TIME); a = dm.rest * u * u; }
      var hue = (i * 4) % 360;
      drawDom(dm.x, dm.z, dm.h, a, 'hsl(' + hue + ',70%,' + (dm.st ? 45 : 58) + '%)', dm.tall ? dm.tall / C.DOM_H : 1);
    }
    // ゴールの大ドミノ
    if (sim.giant) {
      var g = sim.giant, ga = g.t0 < 0 ? 0 : Math.min(1, Math.pow((sim.t - g.t0) / 1.0, 2)) * Math.PI / 2;
      drawDom(g.x, g.z, 0, ga, '#ff3d7f', 3.4, 3);
    }
    // 主人公
    var py = p.y || 0;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(sx(p.x), sy(p.z), C.RADIUS * scale, C.RADIUS * scale * 0.6, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = p.stun > 0 ? '#ff7' : p.safe > 0 ? '#9ff' : '#fff';
    ctx.strokeStyle = '#1b1430'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(p.x), sy(p.z) - py * scale * 0.5, Math.max(0.05, C.RADIUS * scale * (1 + Math.max(-0.9, py * 0.15))), 0, 6.283); ctx.fill(); ctx.stroke();
  }

  function drawDom(x, z, h, a, color, hMul, wMul) {
    var C = DOMINO.CONFIG, s = Math.min(W / (sim.level.cols + 1.5), H / 16);
    var len = C.DOM_T + Math.sin(a) * C.DOM_H * (hMul || 1);
    var wid = C.DOM_W * (wMul || 1);
    var cx = W / 2 + x * s, cy = H * 0.72 - (z - camZ + 3) * s;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(h);
    ctx.fillStyle = color;
    ctx.fillRect(-wid * s / 2, -len * s, wid * s, len * s);
    ctx.restore();
  }

  return { init: init, setSim: setSim, onEvents: onEvents, render: render, resize: resize, replay: function (onDone) { if (onDone) setTimeout(onDone, 0); }, dispose: function () { if (cv) cv.remove(); } };
})();
