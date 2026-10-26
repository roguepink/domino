/* sim.js — ゲームの中身(計算だけ。絵も音も出さない)。まとめ役が持つ。ほかの係は「読むだけ」。
 *
 * 遊び方の決まり:
 *   主人公は前へ自動で走り、走ったあとに ドミノを1枚ずつ並べていく(持っている数 = stock だけ)。
 *   少しすると いちばん最初のドミノが押され、「倒れる波」がうしろから追いかけてくる。
 *   - 波が いちばん新しいドミノまで来たとき、主人公が近く(REACH 以内)にいたら「つかまった」= 負け
 *   - ドミノとドミノの間が 届く長さより広いと、波はそこで止まる = 「チェーンが切れた」= 負け(ドミノ切れのとき)
 *   - ジャンプで穴をこえると、穴の手前のドミノが「橋ドミノ」(背の高いドミノ)になり、波は穴を渡れる
 *   - 穴に落ちても負け
 *   - ゴールの行をこえたら、主人公は大ドミノの前まで ドミノを並べて よける。波が大ドミノを倒したらクリア
 *
 * 使い方:
 *   var sim = new DOMINO.Sim(stage);           // stage は stages.js の1つ
 *   sim.step(input);                           // 1/60 秒すすめる。input = { steer: -1..1, jump: true/false(押した瞬間) }
 *   sim.events                                 // その回に起きたこと(絵・音・画面の係が読む)。毎回の step の最初に空になる
 *   sim.state  'run' | 'goal' | 'clear' | 'fail'      sim.failReason  'caught' | 'broken' | 'fall'
 *   sim.revive()                               // お助け(1回だけ): 負けた所から やり直す
 *   sim.clone()                                // 先読み用の複製(ボット用)
 *
 * 同じ入力なら いつも同じ結果になる(乱数を使わない)。
 *
 * 出来事(events の type。中身は下の _emit をさがす):
 *   lay {i} / topple {i, combo} / wavestart / pick {item} / jump / land / bump / stun {why} / boost / empty / low
 *   gate {g} 門が開いた / bomb {x,z} / bigfall {i} 途中の巨大ドミノ / note {k} 音のドミノ / opgate {op,n,ok} +20 ×2 の門
 *   split 2列になった / bridge {i} 橋ドミノができた / rival {i} 前から倒れてくる列が動き出した / sink {on}
 *   near 波が近い(あぶない!)/ escape {n} にげきった(セーフ! ギリギリ1回)/ goal / stepaside / giant 大ドミノが倒れ始めた / clear / fail {why} / revive
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Sim = (function () {
  var C, T;

  function Sim(stage) {
    C = DOMINO.CONFIG; T = DOMINO.Level.T;
    if (!stage) return;                      // clone 用
    var L = this.level = DOMINO.Level.parse(stage);
    this.stage = stage;
    var w = stage.wave || {};
    this.cfg = {
      run: stage.run || C.RUN,
      delay: w.delay != null ? w.delay : C.WAVE_DELAY,
      v0: w.v0 || C.WAVE_V0, acc: w.acc != null ? w.acc : C.WAVE_ACC, max: w.max || C.WAVE_MAX,
      far: w.far || C.WAVE_FAR, catchup: w.catchup != null ? w.catchup : C.WAVE_CATCHUP,
      closer: w.closer != null ? w.closer : C.WAVE_CLOSER,
      nearGoal: stage.nearGoal || 3,
      sinkPeriod: stage.sinkPeriod || 3.2,     // しずむ床(f)の1回分の秒
      stun: C.STUN
    };
    // むずかしさ「やさしい」(はじめは こちら): 波を おそく・ドミノ多め・しびれ短め。DOMINO.mode = 'normal' で ふつう
    this.easy = DOMINO.mode !== 'normal';
    if (this.easy) {
      var E = C.EASY, f = this.cfg;
      f.v0 *= E.v; f.max *= E.v; f.acc *= E.acc; f.delay += E.delay;
      f.far += E.far; f.catchup *= E.catchup; f.closer *= E.closer; f.stun *= E.stun;
    }
    this.t = 0;
    this.state = 'run';
    this.failReason = '';
    this.events = [];
    this.p = { x: L.start.x, z: L.start.z, y: 0, vx: 0, vy: 0, air: false, stun: 0, boost: 0, coyote: 0.1, jumpBuf: 0,
      heading: 0, s: 0, onIce: false, done: false, hitCool: 0, blocked: false, ledge: 0, jumped: false, twin: 0, safe: 0, wind: 0 };
    this.doms = [];
    this.stock = Math.ceil((stage.stock || C.STOCK) * (this.easy ? C.EASY.stock : 1));
    this.stockUsed = 0;
    this.items = L.items.map(function (it) { return { t: it.t, x: it.x, z: it.z, n: it.n || 0, taken: false }; });
    this.starsTotal = 0; for (var q = 0; q < this.items.length; q++) if (this.items[q].t === 'star') this.starsTotal++;
    this.stars = 0; this.coins = 0; this.score = 0; this.nearTime = 0; this.nearCount = 0; this.inNear = false;
    this.combo = 0;                          // 途切れずに倒れた数(音の高さ・数字の演出用)
    this.gateOpen = [false, false, false, false];
    this.gateT = [0, 0, 0, 0];               // 門が開いた時刻(絵の係が使う)
    this.broken = [];                        // こわれた かべ(爆弾)のマス番号
    this.wave = { started: false, v: 0, hold: 0 };
    this.fronts = [];
    this.giant = null;                       // ゴールの大ドミノ { x, z, h, t0 }
    this.endT = 0;
    this.revived = false;
    this.notes = 0;
    this.objs = (stage.obj || []).map(function (o, i) {
      var c = {}; for (var k in o) c[k] = o[k];
      c.id = i; c.hx = o.x || 0; c.hz = o.z || 0; c.used = false; c.on = false; c.t0 = -1;
      return c;
    });
    // 地図にある 特別なマス(爆弾・巨大ドミノ・音)の一覧
    this.specials = [];
    for (var r = 0; r < L.rows; r++) for (var cc = 0; cc < L.cols; cc++) {
      var ch = (stage.map[L.rows - 1 - r] || '').charAt(cc);
      if (ch === 'o' || ch === 'D' || ch === 'n') this.specials.push({ t: ch === 'o' ? 'bomb' : ch === 'D' ? 'big' : 'note',
        x: cc - L.cols / 2 + 0.5, z: r + 0.5, done: false, t0: -1 });
    }
    this.rivals = [];                        // 前から倒れてくる列のドミノ {x, z, t0, o}
    for (var oi = 0; oi < this.objs.length; oi++) {
      var o = this.objs[oi];
      if (o.t !== 'rival') continue;
      for (var rz = o.z2; rz >= o.z; rz -= C.SPACING) this.rivals.push({ x: o.x, z: rz, t0: -1, o: oi });
    }
    this.danger = 99;                        // 波から主人公までの長さ(チェーンにそった長さ)
    this.progress = 0;                       // 0..1 ゴールまで どれだけ来たか
    // スタートの うしろに 3枚 置いておく(ここから波が始まる)
    var sx = this.p.x, sz = this.p.z;
    for (var k = 3; k >= 1; k--) this._place(sx, sz - k * C.SPACING, 0, true);
    var last = this.doms[this.doms.length - 1];
    this.layFrom = { x: last.x, z: last.z };
    this.events.length = 0;
  }

  var P = Sim.prototype;

  // 先読み用の複製(ボットが使う)。ドミノの配列などは中身ごと写す
  P.clone = function () {
    var s = new Sim(null);
    for (var k in this) {
      if (!this.hasOwnProperty(k)) continue;
      var v = this[k];
      if (k === 'level' || k === 'stage' || k === 'cfg') s[k] = v;
      else s[k] = deep(v);
    }
    s.events = [];
    return s;
  };
  function deep(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) { var a = new Array(v.length); for (var i = 0; i < v.length; i++) a[i] = deep(v[i]); return a; }
    var o = {}; for (var k in v) o[k] = deep(v[k]); return o;
  }

  P._emit = function (type, data) { var e = data || {}; e.type = type; this.events.push(e); };

  P.cellAt = function (x, z) {       // かべ・門・しずむ床の今の状態もふくめた マスの種類
    var L = this.level, i = L.index(x, z), t = L.at(x, z);
    if (t === T.WALL && i >= 0 && this.broken.indexOf(i) >= 0) return T.FLOOR;
    return t;
  };
  P._solid = function (x, z) {
    var L = this.level, t = this.cellAt(x, z);
    if (t === T.WALL) return true;
    if (t === T.GATE) { var g = L.group[L.index(x, z)]; return !this.gateOpen[g]; }
    return false;
  };
  P._hitsSolid = function (x, z) {
    var r = C.RADIUS * 0.92;
    return this._solid(x - r, z - r) || this._solid(x + r, z - r) || this._solid(x - r, z + r) || this._solid(x + r, z + r);
  };
  P.sunk = function (z, t) {          // しずむ床(f)が 今しずんでいるか。行ごとに少しずつ ずれる
    var per = this.cfg.sinkPeriod, u = ((t == null ? this.t : t) / per + Math.floor(z) * 0.07) % 1;
    return u > 0.62;
  };
  P._ground = function (x, z) {       // ドミノを置ける床か(しずむ床の上にも置ける。浮かぶ)
    var t = this.cellAt(x, z);
    return t !== T.HOLE && t !== T.WALL && !(t === T.GATE && this._solid(x, z));
  };
  P._floorUnder = function (x, z) {   // 主人公が立てるか
    var t = this.cellAt(x, z);
    if (t === T.HOLE) return false;
    if (t === T.SINK && this.sunk(z)) return false;
    return true;
  };

  P._place = function (x, z, heading, free) {
    var d = this.doms, prev = d[d.length - 1];
    var s = prev ? prev.s + Math.hypot(x - prev.x, z - prev.z) : 0;
    var L = this.level, i = L.index(x, z);
    var sw = (i >= 0 && L.cell[i] === T.SWITCH) ? L.group[i] : 0;
    var dom = { x: x, z: z, h: heading, s: s, st: 0, t0: 0, sw: sw, gap: prev ? s - prev.s : 0, n: d.length,
      rest: Math.PI / 2, tall: 0, twin: this.p.twin > 0, gold: false };
    if (prev) {
      // ジャンプで穴をこえたとき: 手前のドミノを 背の高い「橋ドミノ」にする
      if (dom.gap > C.REACH && this.p.jumped && !free) {
        var need = Math.ceil(dom.gap);
        if (this.stock >= need) {
          prev.tall = Math.min(7, dom.gap + 0.3);
          this.stock -= need; this.stockUsed += need;
          this._emit('bridge', { i: prev.n });
        }
      }
      prev.rest = restAngle(dom.gap, prev.tall || C.DOM_H);
    }
    d.push(dom);
    if (!this.p.air) this.p.jumped = false;      // 空中で(穴の手前に)置いたときは まだ「ジャンプ中」のまま
    if (!free) {
      var cost = dom.twin ? 2 : 1;
      this.stock = Math.max(0, this.stock - cost); this.stockUsed += cost;
    }
    this._emit('lay', { i: d.length - 1 });
    return dom;
  };
  function reachOf(dom) { return dom.tall ? Math.max(C.REACH, dom.tall) : C.REACH; }

  // 倒れたドミノが 次のドミノにもたれる角度(すき間が狭いほど 立ったまま)
  function restAngle(gap, h) {
    if (gap > Math.max(C.REACH, h)) return Math.PI / 2;
    var a = Math.asin(Math.min(1, Math.max(0, (gap - C.DOM_T) / h)));
    return Math.min(Math.PI / 2, a + 0.05);
  }

  P.step = function (input) {
    input = input || {};
    var dt = C.DT;
    this.events.length = 0;
    this.t += dt;
    if (this.state === 'clear' || this.state === 'fail') {
      this.endT += dt;
      var p = this.p;
      if (this.failReason === 'fall') { p.vy -= C.GRAVITY * dt; p.y = Math.max(-30, p.y + p.vy * dt); }
      if (this.state === 'clear' || this.failReason !== 'caught') this._stepWaveOnly(dt);   // 負けたあとも 波は少し進む(見せるため)
      this._stepGoal(dt);
      return;
    }
    this._stepObjs(dt);
    this._stepPlayer(dt, input);
    this._stepLay();
    this._stepItems();
    this._stepWave(dt);
    this._stepSpecials();
    this._stepGoal(dt);
    this._stepScore(dt);
  };

  P._stepPlayer = function (dt, input) {
    var p = this.p;
    if (this.state === 'goal') { this._autoGoal(dt); return; }
    var cellT = p.air ? -1 : this.cellAt(p.x, p.z);
    p.onIce = cellT === T.ICE;
    if (p.hitCool > 0) p.hitCool -= dt;
    if (p.safe > 0) p.safe -= dt;
    if (p.stun > 0) { p.stun -= dt; p.vx *= 0.8; }
    if (p.boost > 0) p.boost -= dt;

    // 左右
    var steer = Math.max(-1, Math.min(1, input.steer || 0));
    if (p.stun > 0) steer = 0;
    var target = steer * C.SIDE;
    var acc = p.onIce ? 6 : C.SIDE_ACC;
    var dv = target - p.vx, lim = acc * dt;
    p.vx += Math.max(-lim, Math.min(lim, dv));
    var push = p.wind;
    if (cellT === T.BELT_L) push -= 3.2; else if (cellT === T.BELT_R) push += 3.2;

    // 前
    var fwd = this.cfg.run;
    if (cellT === T.MUD) fwd *= 0.5;
    if (p.boost > 0) fwd *= 1.7;
    if (p.stun > 0) fwd = 0;
    if (cellT === T.BOOST) { if (p.boost <= 0.2) this._emit('boost'); p.boost = 1.2; }
    if (cellT === T.SPRING && !p.air) {     // ジャンプ台: 大きく飛ぶ
      p.air = true; p.vy = C.JUMP_V * 1.45; p.jumped = true; p.coyote = 0; this._emit('jump', { big: true });
    }

    // ジャンプ(押すのが少し早くても、床から少し出たあとでも 効くように)
    if (input.jump) p.jumpBuf = 0.14;
    if (p.jumpBuf > 0) p.jumpBuf -= dt;
    if (!p.air) p.coyote = 0.1; else p.coyote -= dt;
    if (p.jumpBuf > 0 && p.coyote > 0 && p.stun <= 0 && (!p.air || p.vy <= 0)) {
      p.air = true; p.vy = C.JUMP_V; p.jumpBuf = 0; p.coyote = 0; p.jumped = true; this._emit('jump');
    }
    if (p.air) {
      p.vy -= C.GRAVITY * dt; p.y += p.vy * dt;
      if (p.y <= 0) {
        if (this._floorUnder(p.x, p.z)) { p.y = 0; p.vy = 0; p.air = false; this._emit('land'); }
        else if (p.y < -0.3) { this._fail('fall'); return; }
      }
    }

    // 動かす(左右と前を べつべつに。かべに当たったら その向きだけ止める)
    var nx = p.x + (p.vx + push) * dt;
    if (!this._hitsSolid(nx, p.z)) p.x = nx; else p.vx = 0;
    var nz = p.z + fwd * dt;
    if (!this._hitsSolid(p.x, nz)) { p.z = nz; p.blocked = false; }
    else { if (!p.blocked) this._emit('bump'); p.blocked = true; this.lastBump = this.t; }
    if (Math.abs(p.vx + push) + fwd > 0.05) p.heading = Math.atan2(p.vx + push, Math.max(fwd, 0.001));

    // 床の効果
    if (!p.air) {
      var under = this.cellAt(p.x, p.z);
      if (under === T.SPIKE && p.hitCool <= 0) this._hit('spike');
      if (!this._floorUnder(p.x, p.z)) {
        p.ledge += dt;
        if (p.ledge > 0.1) { p.air = true; p.vy = -1; p.coyote = 0; }   // 足場がない → 落ちはじめる(この間ならジャンプできる)
      } else p.ledge = 0;
    }
  };

  P._hit = function (why) {
    var p = this.p;
    if (p.hitCool > 0 || p.safe > 0 || this.state !== 'run') return;
    p.stun = this.cfg.stun; p.hitCool = this.cfg.stun + 0.5;
    this.lastStun = this.t; this.lastStunWhy = why;
    this._emit('stun', { why: why });
  };

  // ゴールのあと: まん中へ寄って、大ドミノの前まで並べたら 横へよける
  P._autoGoal = function (dt) {
    var p = this.p, g = this.giant;
    p.stun = 0;
    if (p.air) { p.vy -= C.GRAVITY * dt; p.y += p.vy * dt; if (p.y <= 0) { p.y = 0; p.air = false; } }
    if (!p.done) {
      var dx = 0 - p.x;
      p.vx = Math.max(-4, Math.min(4, dx * 4));
      p.x += p.vx * dt;
      p.z += this.cfg.run * dt;
      p.heading = Math.atan2(p.vx, this.cfg.run);
      if (p.z >= g.z - 0.9) { p.done = true; this._emit('stepaside'); }
    } else {
      p.x += (2.2 - p.x) * Math.min(1, dt * 5);
      p.z += (g.z - 1.6 - p.z) * Math.min(1, dt * 5);
      p.heading = Math.PI;
    }
  };

  P._stepLay = function () {
    var p = this.p;
    if (p.done) return;
    var free = this.state === 'goal';
    if (p.twin > 0) p.twin -= this.cfg.run * C.DT;
    for (var guard = 0; guard < 8; guard++) {
      var dx = p.x - this.layFrom.x, dz = p.z - this.layFrom.z, d = Math.hypot(dx, dz);
      if (d < C.SPACING) break;
      var qx = this.layFrom.x + dx / d * C.SPACING, qz = this.layFrom.z + dz / d * C.SPACING;
      var h = Math.atan2(dx, dz);
      if (this._ground(qx, qz) && (free || this.stock > 0)) {
        var before = this.stock;
        this._place(qx, qz, h, free);
        if (!free && this.stock === 0) this._emit('empty');
        else if (!free && before > 10 && this.stock <= 10) this._emit('low');
      }
      this.layFrom = { x: qx, z: qz };
    }
    var last = this.doms[this.doms.length - 1];
    p.s = last.s + Math.hypot(p.x - last.x, p.z - last.z);
    // ドミノが0本で、もう列につなげない(届く長さより はなれた)→ すぐ「ドミノが なくなった」
    if (!free && this.state === 'run' && this.stock <= 0 && !p.air && p.safe <= 0 && p.s - last.s > reachOf(last)) {
      this.brokenAt = last.n; this.brokenGap = false; this._fail('empty');
    }
  };

  P._stepItems = function () {
    var p = this.p;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.taken) continue;
      var dx = it.x - p.x, dz = it.z - p.z;
      if (dx * dx + dz * dz > 0.75 * 0.75 || p.y > 1.8) continue;
      it.taken = true;
      if (it.t === 'box' || it.t === 'bigbox') { this.stock += it.n; this.score += it.n * 5; }
      else if (it.t === 'star') { this.stars++; this.score += 500; }
      else if (it.t === 'coin') { this.coins++; this.score += 50; }
      this._emit('pick', { item: it, i: i });
    }
  };

  P._stepWave = function (dt) {
    if (!this.wave.started) {
      if (this.t >= this.cfg.delay) {
        this.wave.started = true; this.wave.v = this.cfg.v0;
        this.fronts.push({ s: 0, i: 0, dead: false });
        this._emit('wavestart');
      } else { this.danger = 99; return; }
    }
    var w = this.wave;
    w.v = Math.min(this.cfg.max, w.v + this.cfg.acc * dt);
    this._stepWaveOnly(dt);
  };

  // 波を進めて、ドミノを倒す
  P._stepWaveOnly = function (dt) {
    if (!this.wave.started) return;
    var d = this.doms, p = this.p, maxS = -1;
    var v = this.wave.v;
    if (this.state === 'goal' || this.state === 'clear') v = Math.max(v, 8);   // ゴールのあとは 少し急いで 見せ場へ
    else {
      var far = Math.max(3, this.cfg.far - this.cfg.closer * this.progress);   // 面の後半ほど 近くまで追い上げる
      if (this.danger < 90 && this.danger > far) v += (this.danger - far) * this.cfg.catchup;   // 遠すぎると 追い上げる
    }
    if (this.wave.hold > 0) { this.wave.hold -= dt; v = 0; }                  // お助けの直後は 少し止まる
    for (var f = 0; f < this.fronts.length; f++) {
      var fr = this.fronts[f];
      if (fr.dead) continue;
      fr.s += v * dt;
      while (fr.i < d.length && d[fr.i].s <= fr.s) {
        var dom = d[fr.i];
        if (fr.i > 0 && dom.gap > reachOf(d[fr.i - 1])) { fr.dead = true; fr.s = d[fr.i - 1].s; this.brokenGap = true; this._frontDied(fr, fr.i - 1); break; }
        if (dom.st === 0) this._topple(dom);
        fr.i++;
      }
      if (fr.dead) continue;
      if (fr.i >= d.length) {
        fr.s = d[d.length - 1].s;
        if (this.state === 'run') {
          // 最後の1枚まで倒れた: 主人公が近ければ つかまる。遠ければ チェーンが切れた
          var last = d[d.length - 1], gapP = Math.hypot(p.x - last.x, p.z - last.z);
          if (p.safe > 0) { /* お助けの間は待つ */ }
          else if (p.air && p.jumped && !this._ground(p.x, p.z)) { /* 穴の上をジャンプ中: 着地して橋ドミノがかかるまで 待つ */ }
          else if (gapP <= reachOf(last) && p.y < 1.2) { fr.dead = true; this._fail('caught'); }
          else if (gapP > reachOf(last) + 0.01) { fr.dead = true; this.brokenAt = last.n; this.brokenGap = false; this._fail(this.stock <= 0 ? 'empty' : 'broken'); }
        } else if (this.state === 'goal' && p.done) {
          fr.dead = true; this._topGiant();
        }
      }
      if (fr.s > maxS) maxS = fr.s;
    }
    if (this.state === 'run') this.danger = maxS < 0 ? 99 : Math.max(0, p.s - maxS);
  };

  P._frontDied = function (fr, at) {
    for (var f = 0; f < this.fronts.length; f++) if (!this.fronts[f].dead && this.fronts[f].s > fr.s) return;
    if (this.state === 'run' || this.state === 'goal') { this.brokenAt = at; this._fail(this.stock <= 0 ? 'empty' : 'broken'); }
  };

  P._topple = function (dom) {
    dom.st = 1; dom.t0 = this.t;
    this.combo++;
    this.score += 10 + Math.min(40, Math.floor(this.combo / 25) * 5);
    this._emit('topple', { i: dom.n, combo: this.combo });
    if (dom.sw && !this.gateOpen[dom.sw]) {
      this.gateOpen[dom.sw] = true; this.gateT[dom.sw] = this.t;
      this._emit('gate', { g: dom.sw });
    }
  };

  // 爆弾・巨大ドミノ・音のドミノ: 倒れる波が その近くを通ったら 動く
  P._stepSpecials = function () {
    if (!this.fronts.length) return;
    var d = this.doms, L = this.level;
    var fr = this.fronts[this.fronts.length - 1], k = Math.max(0, Math.min(d.length - 1, fr.i - 1));
    var head = d[k];
    if (!head || head.st === 0) return;
    for (var i = 0; i < this.specials.length; i++) {
      var sp = this.specials[i];
      if (sp.done) continue;
      var dx = sp.x - head.x, dz = sp.z - head.z, r = sp.t === 'note' ? 0.75 : sp.t === 'bomb' ? 1.6 : 2.6;
      if (dx * dx + dz * dz > r * r) continue;
      sp.done = true; sp.t0 = this.t;
      if (sp.t === 'bomb') {
        this.score += 300;
        // まわり 2.6m の こわれるかべ(W) をこわす
        for (var r2 = 0; r2 < L.rows; r2++) for (var c = 0; c < L.cols; c++) {
          var idx = r2 * L.cols + c;
          if (L.cell[idx] !== T.WALL || !L.weak[idx]) continue;
          var wx = c - L.cols / 2 + 0.5, wz = r2 + 0.5;
          if ((wx - sp.x) * (wx - sp.x) + (wz - sp.z) * (wz - sp.z) < 2.8 * 2.8 && this.broken.indexOf(idx) < 0) this.broken.push(idx);
        }
        this._emit('bomb', { x: sp.x, z: sp.z, i: i });
      } else if (sp.t === 'big') { this.score += 200; this._emit('bigfall', { i: i, x: sp.x, z: sp.z }); }
      else { this._emit('note', { k: this.notes++, i: i }); this.score += 30; }
    }
  };

  P._stepGoal = function () {
    var p = this.p, L = this.level;
    this.progress = Math.max(0, Math.min(1, (p.z - L.start.z) / Math.max(1, (L.goalZ + 0.5 - L.start.z))));
    if (this.state === 'run' && p.z >= L.goalZ + 0.5) {
      this.state = 'goal';
      p.stun = 0;
      this.giant = { x: 0, z: L.goalZ + C.GIANT_DZ, h: C.GIANT_H, t0: -1 };
      this.score += 1000 + this.stock * 20;
      this._emit('goal');
    }
    if (this.giant && this.giant.t0 >= 0 && this.state === 'goal' && this.t - this.giant.t0 > 1.3) {
      this.state = 'clear'; this.endT = 0;
      this._emit('clear');
    }
  };

  P._topGiant = function () {
    if (this.giant.t0 >= 0) return;
    this.giant.t0 = this.t;
    this.score += 2000;
    this._emit('giant');
  };

  // ギリギリ: 波が NEAR より近くまで来たら「あぶない!」(near)。そこから にげきったら「セーフ!」(escape)= 1回と数える
  //   近いほど 点が増える(nearMul: 1.6m 以内 ×2、0.8m 以内 ×3)
  P._stepScore = function (dt) {
    if (this.state !== 'run' || !this.wave.started) { this.nearMul = 1; return; }
    var near = this.inNear ? this.danger < C.NEAR + 0.8 : this.danger < C.NEAR;   // 出入りでチラチラしないよう 少し幅をもたせる
    this.nearMul = this.danger < 0.8 ? 3 : this.danger < C.NEAR ? 2 : 1;
    if (near) { this.nearTime += dt; this.score += Math.round(dt * 150 * this.nearMul); }
    if (near && !this.inNear) this._emit('near');
    if (!near && this.inNear) { this.nearCount++; this.score += 200; this._emit('escape', { n: this.nearCount }); }
    this.inNear = near;
  };

  // ゴールまで まっすぐ走ったときに いるドミノの数(画面の「たりる/たりない」の目安)
  P.needToGoal = function () {
    if (this.state !== 'run') return 0;
    return Math.ceil(Math.max(0, this.level.goalZ + 0.5 - this.p.z) / C.SPACING * (this.p.twin > 0 ? 2 : 1));
  };

  // 星: 1つ目 = クリア、2つ目 = 金のドミノ(★のマス)を全部、3つ目 = ギリギリを nearGoal 回
  P.starResult = function () {
    if (this.state !== 'clear') return 0;
    return 1 + (this.stars >= this.starsTotal && this.starsTotal > 0 ? 1 : 0) + (this.nearCount >= this.cfg.nearGoal ? 1 : 0);
  };

  P._fail = function (why) {
    if (this.state === 'fail' || this.state === 'clear') return;
    this.state = 'fail'; this.failReason = why; this.endT = 0;
    // 負けの原因の ヒント(画面の係が コツの文を選ぶ): wall かべで止まった / hit じゃま物 / mud ぬかるみ / far 遠回り / ''
    var h = '';
    if (why === 'caught') {
      if (this.lastBump != null && this.t - this.lastBump < 2.5) h = 'wall';
      else if (this.lastStun != null && this.t - this.lastStun < 2.5) h = 'hit';
    } else if (why === 'empty' || why === 'broken') {
      h = this.stockUsed > (this.p.z - this.level.start.z) / C.SPACING * 1.35 ? 'far' : '';
    }
    this.failHint = h;
    this.combo = 0;
    this._emit('fail', { why: why });
  };

  // お助け(1回だけ): 波を2.5秒止めて、主人公を「その先 2m が走れる」安全な所へ動かす。
  //   つかまった → 少し前(前が かべなら よこ)/ 落ちた → 穴の向こう / 切れた → すき間に橋ドミノをかけて +15本
  //   主人公と列の間が あいたときは、次の1枚が 橋ドミノになって つながる
  P.revive = function () {
    if (this.state !== 'fail' || this.revived) return false;
    var p = this.p, why = this.failReason, d = this.doms, last = d[d.length - 1];
    this.revived = true; this.state = 'run'; this.failReason = '';
    p.stun = 0; p.safe = 2.0; p.hitCool = 0; p.air = false; p.vy = 0; p.y = 0; p.ledge = 0; p.blocked = false;
    this.wave.hold = 2.5;
    for (var f = 0; f < this.fronts.length; f++) this.fronts[f].dead = false;
    var spot = null;
    if (why === 'caught') spot = this._safeSpot(p.x, p.z + 0.6, 2.5);
    else if (why === 'fall') spot = this._safeSpot(last.x, last.z + 0.5, 9);
    else {   // broken / empty
      this.stock += 15;
      if (this.brokenGap && d[this.brokenAt + 1]) {
        // 列のとちゅうの すき間に 橋ドミノをかける(主人公は そのまま)
        var a = d[this.brokenAt], b = d[this.brokenAt + 1];
        a.tall = Math.min(7, b.gap + 0.3); a.rest = restAngle(b.gap, a.tall);
        this._emit('bridge', { i: a.n });
      } else spot = this._safeSpot(last.x, last.z + 0.3, 4);
    }
    if (spot) { p.x = spot.x; p.z = spot.z; p.vx = 0; }
    var gapNow = Math.hypot(p.x - last.x, p.z - last.z);
    if (gapNow > C.REACH * 0.8) { p.jumped = true; this.stock += Math.ceil(gapNow); }   // 次の1枚を 橋ドミノにして つなぐ
    this.brokenGap = false;
    this._emit('revive', { why: why });
    return true;
  };
  // (x, z) の近くで、立てて・かべがなく・その先 2m も まっすぐ走れる所をさがす
  P._safeSpot = function (x, z, dzMax) {
    var DX = [0, -0.6, 0.6, -1.2, 1.2, -1.8, 1.8, -2.4, 2.4, -3, 3, -3.6, 3.6], hw = this.level.halfW - C.RADIUS;
    for (var dz = 0; dz <= dzMax; dz += 0.25) {
      for (var k = 0; k < DX.length; k++) {
        var px = Math.max(-hw, Math.min(hw, x + DX[k])), pz = z + dz, ok = true;
        for (var a = 0; a <= 2.0 && ok; a += 0.5) {
          if (!this._floorUnder(px, pz + a) || this._hitsSolid(px, pz + a) || this.cellAt(px, pz + a) === T.SPIKE) ok = false;
        }
        if (ok) return { x: px, z: pz };
      }
    }
    return null;
  };

  // 動くじゃま物・仕掛け(stage.obj)。x, x2 は マスの中心の x(-4 〜 +4)、z は 行の番号(スタート側が 0)
  //   { t:'saw',  z, x, x2, v }           のこぎり: x と x2 の間を行ったり来たり(さわると しびれる。ジャンプでもこえられない)
  //   { t:'ball', z, x, x2, v }           転がる玉: 同じく行ったり来たり。低いので ジャンプでこえられる
  //   { t:'hammer', z, x, len, w, ph }    ふりこのハンマー: x を中心に ±len を ゆれる(w = 速さ、ph = ずらし)。ジャンプでこえられない
  //   { t:'gate', z, x, w, op:'+'|'x'|'-', n }   数の門(はば w マス): 通ると ドミノの数が +n / ×n / -n
  //   { t:'split', z, x, w, len }         2列の門: 通ると len m の間、ドミノが2列になる(2本ずつ使う・見た目がはなやか)
  //   { t:'wind', z, z2, f, per }         風: z〜z2 の間、横に f の強さ(+ = 右)で ふく。per 秒ごとに向きが変わる(書かなければ ずっと同じ)
  //   { t:'rival', z, z2, x, at }         前から倒れてくる列: x の列に z〜z2 の間 ドミノが立っていて、主人公が at の行に来ると
  //                                       ゴール側から こちらへ倒れてくる。当たると しびれる(よこへよける)
  P._stepObjs = function (dt) {
    var p = this.p, t = this.t;
    p.wind = 0;
    for (var i = 0; i < this.objs.length; i++) {
      var o = this.objs[i], r = 0.55, high = 1.0, hurt = false;
      if (o.t === 'saw' || o.t === 'ball') {
        var span = Math.abs(o.x2 - o.x) || 0.001, v = o.v || 2;
        var u = (t * v / span) % 2; if (u > 1) u = 2 - u;
        o.hx = o.x + (o.x2 - o.x) * u; o.hz = o.z + 0.5;
        if (o.t === 'ball') { r = 0.45; high = 0.75; }
        hurt = true;
      } else if (o.t === 'hammer') {
        o.hx = o.x + Math.sin(t * (o.w || 2) + (o.ph || 0)) * (o.len || 3); o.hz = o.z + 0.5; r = 0.6; high = 1.6; hurt = true;
      } else if (o.t === 'gate' || o.t === 'split') {
        if (!o.used && p.z >= o.z + 0.5 && p.z < o.z + 1.6 && Math.abs(p.x - o.x) <= (o.w || 3) / 2) {
          o.used = true; o.t0 = t;
          // 横にならんだ 同じ行の門は 1つしか通れない
          for (var j = 0; j < this.objs.length; j++) if (j !== i && this.objs[j].z === o.z && (this.objs[j].t === 'gate' || this.objs[j].t === 'split')) this.objs[j].used = true;
          if (o.t === 'gate') {
            var before = this.stock;
            if (o.op === '+') this.stock += o.n; else if (o.op === 'x') this.stock = Math.round(this.stock * o.n); else this.stock = Math.max(0, this.stock - o.n);
            this._emit('opgate', { op: o.op, n: o.n, ok: this.stock >= before, id: i });
          } else { p.twin = o.len || 12; this._emit('split', { id: i }); }
        }
      } else if (o.t === 'wind') {
        if (p.z >= o.z && p.z <= o.z2 + 1) {
          var dir = o.per ? (Math.floor(t / o.per) % 2 ? -1 : 1) : 1;
          p.wind = (o.f || 2.5) * dir; o.on = true; o.dir = dir;
        } else o.on = false;
      } else if (o.t === 'rival') {
        if (o.t0 < 0 && p.z >= o.at) { o.t0 = t; this._emit('rival', { id: i }); }
        if (o.t0 >= 0) {
          // 先頭(倒れているいちばん手前)は z2 から 速さ 5 で こちらへ
          var head = o.z2 - (t - o.t0) * (o.v || 5);
          o.hz = head; o.hx = o.x;
          for (var q = 0; q < this.rivals.length; q++) { var rv = this.rivals[q]; if (rv.o === i && rv.t0 < 0 && rv.z >= head) rv.t0 = t; }
          if (head > o.z - 1 && Math.abs(p.x - o.x) < 0.75 && Math.abs(p.z - head) < 0.7 && p.y < 0.9) this._hit('rival');
        }
      }
      if (hurt) {
        var dx = o.hx - p.x, dz = o.hz - p.z;
        if (dx * dx + dz * dz < (r + C.RADIUS) * (r + C.RADIUS) && p.y < high && this.state === 'run') this._hit(o.t);
      }
    }
  };

  return Sim;
})();
