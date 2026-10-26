/* bot.js — 自動で遊ぶ係(ステージ設計係)。
 *
 *   DOMINO.Bot.input(sim)          main が #auto のとき 1/60 秒ごとに呼ぶ。{steer, jump} を返す
 *   DOMINO.Bot.solve(stage, opts)  1面を最後まで遊んで結果を返す(tools/stagecheck.py が使う)
 *       → { clear, time(ゴールした秒), clearT(クリアの秒), minDanger(いちばん近づいた波 m), stockMin(ドミノの残りの最小),
 *           gold(金のドミノ), near(ギリギリ回数), z(進んだ所), why(負けた理由), nodes(調べた数), ms, inputs }
 *       opts = { beam: 幅(32), every: 何コマごとに入力を変えるか(6 = 0.1秒), steers: [左右の強さ], gold: 金のドミノを取りにいく強さ(1),
 *                maxT: 打ち切りの秒(300), retry: 失敗したら幅を広げてもう1回(true) }
 *
 * しくみ: sim は「同じ入力なら同じ結果」なので、数の多い先読み(ビーム探索)で遊ぶ。
 *   0.1 秒ごとに「左右の強さ × ジャンプするか」の候補を全部ためし、点の良い 幅 個の流れだけを残して進む。
 *   人の速さをこえないように: 入力は 0.1 秒ごと(ジャンプは 0.05 秒きざみ)、ふつうは 5 段階の左右だけ。
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Bot = (function () {
  var C = DOMINO.CONFIG;

  // ---- 速い複製: 倒れきったドミノは もう変わらないので 共有する(sim.clone と同じ中身) ----
  function deep(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) { var a = new Array(v.length); for (var i = 0; i < v.length; i++) a[i] = deep(v[i]); return a; }
    var o = {}; for (var k in v) o[k] = deep(v[k]); return o;
  }
  function copyObj(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }
  function fastClone(sim) {
    var s = new DOMINO.Sim(null);
    for (var k in sim) {
      if (!sim.hasOwnProperty(k)) continue;
      var v = sim[k];
      if (k === 'level' || k === 'stage' || k === 'cfg') s[k] = v;
      else if (k === 'events') s[k] = [];
      else if (k === 'doms') {
        var n = v.length, a = new Array(n);
        for (var i = 0; i < n; i++) { var d = v[i]; a[i] = (d.st === 1 && i < n - 2) ? d : copyObj(d); }
        s[k] = a;
      } else if (k === 'rivals') {
        var b = new Array(v.length);
        for (var j = 0; j < v.length; j++) b[j] = v[j].t0 >= 0 ? v[j] : copyObj(v[j]);
        s[k] = b;
      } else s[k] = deep(v);
    }
    return s;
  }

  // ---- 地図の下ごしらえ(行ごとに「ジャンプが要りそうか」) ----
  var prepCache = [];
  function prep(sim) {
    var st = sim.stage;
    for (var i = 0; i < prepCache.length; i++) if (prepCache[i].stage === st) return prepCache[i];
    var L = sim.level, T = DOMINO.Level.T, rows = L.rows, hz = new Uint8Array(rows + 8);
    for (var r = 0; r < rows; r++) for (var c = 0; c < L.cols; c++) {
      var t = L.cell[r * L.cols + c];
      if (t === T.HOLE || t === T.SPIKE || t === T.SINK) hz[r] = 1;
    }
    var objs = st.obj || [];
    for (var o = 0; o < objs.length; o++) {
      var ob = objs[o];
      if (ob.t === 'ball' && ob.z >= 0 && ob.z < rows) hz[ob.z] = 1;
      if (ob.t === 'rival') for (var q = Math.max(0, ob.z - 1); q <= Math.min(rows - 1, ob.z2 + 1); q++) hz[q] = 1;
    }
    // スイッチ(k p q)のマスがあるか・爆弾の位置
    var bombs = [];
    for (var b = 0; b < sim.specials.length; b++) if (sim.specials[b].t === 'bomb') bombs.push(sim.specials[b]);
    var info = { stage: st, hz: hz, rows: rows, bombs: bombs };
    prepCache.push(info); if (prepCache.length > 8) prepCache.shift();
    return info;
  }
  function hazardAhead(info, z) {
    var r0 = Math.floor(z);
    for (var r = r0; r <= r0 + 5; r++) if (r >= 0 && r < info.rows && info.hz[r]) return true;
    return false;
  }

  // ---- 状態の点(大きいほど良い) ----
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function evaluate(node, info, gw) {
    var s = node.sim, p = s.p;
    if (s.state === 'goal' || s.state === 'clear') return 1e9 + s.stars * 1000 * gw - node.t;
    var sc = p.z * 60;
    var d = s.wave.started ? s.danger : 12;
    d = Math.min(d, 14);
    sc += 8 * clamp(d, 0, 3) + 4 * clamp(d - 3, 0, 3) + 1.5 * clamp(d - 6, 0, 4) + 0.3 * clamp(d - 10, 0, 4);
    if (d < 1.2) sc -= (1.2 - d) * 40;
    var rem = Math.max(0, s.level.goalZ + 0.5 - p.z), need = rem * 2 + 4, stock = s.stock;
    sc += 1.0 * Math.min(stock, need) + 0.15 * Math.max(0, stock - need);
    if (stock < 8) sc -= (8 - stock) * 15;
    if (stock <= 0) sc -= 2000;
    sc += s.stars * 150 * gw;
    sc += node.swc * 90;            // スイッチの上に ドミノを置けた(門が開く)
    sc += node.bmc * 90;            // 爆弾の近くに ドミノを置けた(かべがこわれる)
    // 先にある 金のドミノ・箱へ 向かっているほど 少し良い(取れそうな所だけ)
    var its = s.items;
    for (var i = 0; i < its.length; i++) {
      var it = its[i];
      if (it.taken) continue;
      var dz = it.z - p.z;
      if (dz < 0.3 || dz > 9) continue;
      var reach = dz / s.cfg.run * 5.5 + 0.6, dx = Math.abs(it.x - p.x);
      if (dx > reach) continue;
      var val = it.t === 'star' ? 150 * gw : (it.t === 'coin' ? 3 : it.n * (stock < need ? 1.0 : 0.15));
      sc += val * 0.45 * (1 - dx / (reach + 0.5)) * (1 - dz / 12);
    }
    // 空中: 着地する所が 穴なら だめな流れ
    if (p.air) {
      var g = C.GRAVITY, tl = (p.vy + Math.sqrt(Math.max(0, p.vy * p.vy + 2 * g * Math.max(0, p.y)))) / g;
      var fw = s.cfg.run * (p.boost > 0 ? 1.7 : 1), lx = p.x + p.vx * tl, lz = p.z + fw * tl;
      if (s.level.at(lx, lz) === DOMINO.Level.T.HOLE) sc -= 400;
      else if (s.cellAt(lx, lz) === DOMINO.Level.T.SINK && s.sunk(lz, s.t + tl)) sc -= 300;
    }
    if (p.stun > 0) sc -= 60;
    if (node.cut) sc -= 3000;
    sc -= node.jumps * 0.3;
    return sc;
  }

  // 新しく置いたドミノが スイッチ・爆弾に届いたかを数える(親から引きつぐ)
  function scanNew(node, info) {
    var d = node.sim.doms;
    for (var i = node.nd; i < d.length; i++) {
      var dm = d[i];
      // とぎれた(届かない すき間ができた)流れは もうだめ
      if (i > 0 && i < d.length && dm.gap > (d[i - 1].tall ? Math.max(C.REACH, d[i - 1].tall) : C.REACH)) node.cut = 1;
      if (dm.sw && !(node.swm & (1 << dm.sw))) { node.swm |= (1 << dm.sw); if (!node.sim.gateOpen[dm.sw]) node.swc++; }
      for (var b = 0; b < info.bombs.length; b++) {
        if (node.bmm & (1 << b)) continue;
        var bb = info.bombs[b], dx = bb.x - dm.x, dz = bb.z - dm.z;
        if (dx * dx + dz * dz < 1.5 * 1.5) { node.bmm |= (1 << b); node.bmc++; }
      }
    }
    node.nd = d.length;
  }

  function keyOf(node) {
    var s = node.sim, p = s.p;
    return Math.round(p.x * 4) + ',' + Math.round(p.vx * 0.7) + ',' + (p.air ? Math.round(p.y * 2) : 'g') + ',' + s.stars + ',' +
      Math.floor(s.stock / 5) + ',' + node.swm + ',' + node.bmm + ',' + (p.stun > 0 ? 1 : 0) + ',' + Math.round(p.z * 2);
  }

  // 1つの流れを every コマ進める
  function advance(node, act, every, info, gw) {
    var c = fastClone(node.sim);
    var minD = node.minD, stockMin = node.stockMin;
    var inp = { steer: act.s, jump: false };
    for (var f = 0; f < every; f++) {
      inp.jump = act.j === f;
      c.step(inp);
      if (c.state === 'fail') return null;
      if (c.state === 'run' && c.wave.started && c.danger < minD) minD = c.danger;
      if (c.stock < stockMin) stockMin = c.stock;
      if (c.state !== 'run') break;
    }
    var ch = { sim: c, parent: node, a: act, t: node.t + 1, minD: minD, stockMin: stockMin,
      nd: node.nd, cut: node.cut, swm: node.swm, swc: node.swc, bmm: node.bmm, bmc: node.bmc, jumps: node.jumps + (act.j >= 0 ? 1 : 0) };
    scanNew(ch, info);
    ch.score = evaluate(ch, info, gw);
    return ch;
  }

  function actionsFor(sim, info, steers, every) {
    var acts = [];
    for (var i = 0; i < steers.length; i++) acts.push({ s: steers[i], j: -1 });
    var p = sim.p;
    if (!p.air && p.stun <= 0 && hazardAhead(info, p.z)) {
      var js = [-1, 0, 1], half = Math.floor(every / 2);
      for (var k = 0; k < js.length; k++) { acts.push({ s: js[k], j: 0 }); if (half > 0) acts.push({ s: js[k], j: half }); }
    }
    return acts;
  }

  // ゴールのあと(入力は効かない)を最後まで進める
  function finish(sim, maxSteps) {
    for (var n = 0; n < maxSteps && sim.state !== 'clear' && sim.state !== 'fail'; n++) sim.step({});
    return sim;
  }

  function pathOf(node) {
    var acts = [];
    while (node && node.a) { acts.push(node.a); node = node.parent; }
    return acts.reverse();
  }

  function search(start, opts, info) {
    var W = opts.beam, every = opts.every, steers = opts.steers, gw = opts.gold;
    var root = { sim: start, parent: null, a: null, t: 0, minD: 99, stockMin: start.stock, nd: 0, cut: 0, swm: 0, swc: 0, bmm: 0, bmc: 0, jumps: 0 };
    scanNew(root, info);
    root.score = evaluate(root, info, gw);
    var beam = [root], nodes = 0, best = root, maxGen = Math.ceil(opts.maxT / (every * C.DT));
    var t0 = Date.now();
    for (var gen = 0; gen < maxGen && beam.length; gen++) {
      var cand = [], goals = [];
      for (var b = 0; b < beam.length; b++) {
        var nd = beam[b], acts = actionsFor(nd.sim, info, steers, every);
        for (var a = 0; a < acts.length; a++) {
          var ch = advance(nd, acts[a], every, info, gw);
          nodes++;
          if (!ch) continue;
          if (ch.sim.state !== 'run') goals.push(ch); else cand.push(ch);
        }
        if (nd !== best) nd.sim = null;   // もう使わない(メモリを空ける)
      }
      if (goals.length) {
        // ゴールした流れの中で、金のドミノが多く・最後まで倒れたもの
        goals.sort(function (x, y) { return y.score - x.score; });
        for (var g = 0; g < goals.length; g++) {
          var fs = finish(goals[g].sim, 60 * 40);
          if (fs.state === 'clear') return { node: goals[g], sim: fs, nodes: nodes, ms: Date.now() - t0 };
        }
      }
      // 同じような状態は 1つにまとめて、点の良い順に W 個
      cand.sort(function (x, y) { return y.score - x.score; });
      var seen = {}, next = [], nAir = 0, airMax = Math.ceil(W * 0.6);
      for (var i = 0; i < cand.length && next.length < W; i++) {
        var k = keyOf(cand[i]);
        if (seen[k]) continue;
        if (cand[i].sim.p.air) { if (nAir >= airMax) continue; nAir++; }
        seen[k] = 1; next.push(cand[i]);
      }
      if (next.length) best = next[0];
      if (opts.trace) opts.trace.push([gen, cand.length, next.length, next.length ? +next[0].sim.p.z.toFixed(2) : -1,
        next.filter(function (n) { return n.sim.p.air; }).length, next.length ? Math.round(next[0].score) : 0]);
      beam = next;
      if (opts.deadline && Date.now() > opts.deadline) break;
    }
    return { node: best, sim: best.sim, nodes: nodes, ms: Date.now() - t0, fail: true };
  }

  function defaults(opts) {
    opts = opts || {};
    return { beam: opts.beam || 32, every: opts.every || 6, steers: opts.steers || [-1, -0.5, 0, 0.5, 1],
      gold: opts.gold != null ? opts.gold : 1, maxT: opts.maxT || 300, retry: opts.retry !== false, deadline: opts.deadline || 0, trace: opts.trace };
  }

  // 1面を最後まで遊ぶ
  function solve(stage, opts, fromSim) {
    var o = defaults(opts);
    var start = fromSim ? fastClone(fromSim) : new DOMINO.Sim(stage);
    var info = prep(start);
    var r = search(start, o, info), tries = 1;
    if (r.fail && o.retry) {
      var o2 = defaults(opts); o2.beam = o.beam * 4;
      var r2 = search(fromSim ? fastClone(fromSim) : new DOMINO.Sim(stage), o2, info);
      r2.nodes += r.nodes; r2.ms += r.ms; tries = 2;
      if (!r2.fail || (r2.sim && r.sim && r2.sim.p.z > r.sim.p.z)) r = r2;
    }
    var path = pathOf(r.node), s = r.sim;
    // 負けた流れは 最後の一歩を もう一度すすめて 理由を出す
    var why = '';
    if (r.fail) {
      why = 'beam-empty';
      var probe = fastClone(r.node.sim || start);
      for (var n = 0; n < 600 && probe.state === 'run'; n++) probe.step({ steer: 0 });
      if (probe.state === 'fail') why = probe.failReason;
    }
    return {
      clear: !r.fail && s.state === 'clear',
      time: +(r.node.t * o.every * C.DT).toFixed(2),
      clearT: s ? +s.t.toFixed(2) : 0,
      minDanger: +Math.min(99, r.node.minD).toFixed(2),
      stockMin: r.node.stockMin,
      gold: s ? s.stars : 0, goldTotal: s ? s.starsTotal : 0,
      near: s ? s.nearCount : 0,
      z: s ? +s.p.z.toFixed(1) : 0, goalZ: start.level.goalZ,
      why: why, nodes: r.nodes, ms: r.ms, tries: tries,
      every: o.every, inputs: path.map(function (a) { return [a.s, a.j]; })
    };
  }

  // ---- 画面で遊ぶとき(#auto) ----
  var live = { sim: null, plan: null, base: 0, every: 6, cool: 0, cur: null };
  function input(sim) {
    if (live.sim !== sim) {
      live.sim = sim; live.plan = null; live.cur = null;
      if (sim.t < C.DT / 2) {
        var res = solve(sim.stage, { beam: 24, maxT: 200 }, sim);
        live.plan = res.inputs; live.every = res.every; live.base = 0;
      }
    }
    var k = Math.round(sim.t / C.DT) - live.base;
    if (live.plan && !sim.revived) {
      var g = Math.floor(k / live.every), f = k - g * live.every;
      if (g < live.plan.length) { var a = live.plan[g]; return { steer: a[0], jump: a[1] === f }; }
    }
    // 計画がない・ずれた(お助けのあと など): その場で少し先を読む
    if (live.cool <= 0 || !live.cur) {
      var r = search(fastClone(sim), { beam: 10, every: 6, steers: [-1, -0.5, 0, 0.5, 1], gold: 1, maxT: 1.5 }, prep(sim));
      var pth = pathOf(r.node);
      live.cur = pth.length ? pth[0] : { s: 0, j: -1 }; live.cool = 6; live.f = 0;
    }
    var act = live.cur, jf = live.f++;
    live.cool--;
    return { steer: act.s, jump: act.j === jf };
  }

  return { input: input, solve: solve, clone: fastClone };
})();
