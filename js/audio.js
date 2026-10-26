/* audio.js — 音(音係)。音のファイルは使わず、すべて WebAudio で その場で作る。
 *
 *   DOMINO.Audio.unlock()           最初のタップの中で呼ぶ(iPhone・LINE の中は これがないと鳴らない)。何度呼んでもよい
 *   DOMINO.Audio.stage(stage)       ステージの前(BGM を しずかに。同じワールドなら 曲は つづけて流す)
 *   DOMINO.Audio.start(stage)       走り出し(BGM を ふつうの大きさに)
 *   DOMINO.Audio.stop()             メニューへ(BGM・心臓・風を止める)
 *   DOMINO.Audio.pause(on)          ポーズ・タブが隠れたとき(全部止める / もどす)
 *   DOMINO.Audio.onEvents(list,sim) その1コマの出来事(sim.js の先頭の一覧)で 効果音を鳴らす
 *   DOMINO.Audio.update(sim,dt,st)  毎コマ: BGM の先読み・心臓の音・風・前から倒れる列のカタカタ
 *   DOMINO.Audio.setSound(on) / setMusic(on)   設定を変える(保存は UI がする)
 *   DOMINO.Audio.stats              鳴らした回数など(確認の道具が読む)
 *   DOMINO.Audio.offline            確認用: OfflineAudioContext に同じ合成をして 波形をもらう(スピーカーで鳴らさない)
 *
 * しくみ: 効果音(sfx)と BGM(mus)→ コンプレッサー → 全体の音量 → リミッター → やわらかいクリップ(割れない)→ スピーカー
 * 合成の関数は どれも f(ctx, out, t, o) の形(ctx = AudioContext か OfflineAudioContext、out = つなぐ先、t = 鳴らす時刻)。
 * 古い iPhone でも動くように var・function だけで書く。StereoPanner がない端末では 左右の振り分けをしない。
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Audio = (function () {
  // ---------- 小さな道具 ----------
  var seed = 20261027;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function noiseBuf(ctx) {
    if (ctx.__domNoise) return ctx.__domNoise;
    var len = Math.floor(ctx.sampleRate * 2), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), s = 777;
    for (var i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
    ctx.__domNoise = b;
    return b;
  }
  function gain(ctx, out, v) { var g = ctx.createGain(); g.gain.value = v == null ? 1 : v; if (out) g.connect(out); return g; }
  // 0 → peak(a 秒)→ ほぼ 0(d 秒)
  function env(g, t, a, peak, d) {
    var p = g.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, a));
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, a) + Math.max(0.005, d));
  }
  function osc(ctx, type, f, t, dur, out) {
    var o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.connect(out); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(ctx, t, dur, out) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf(ctx); s.loop = true;
    s.connect(out); s.start(t, rnd() * 1.5); s.stop(t + dur + 0.05);
    return s;
  }
  function filt(ctx, type, f, q, out) {
    var b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q;
    if (out) b.connect(out);
    return b;
  }
  function pan(ctx, out, p) {
    if (!p || !ctx.createStereoPanner) return out;
    var n = ctx.createStereoPanner(); n.pan.value = clamp(p, -1, 1); n.connect(out); return n;
  }
  // 音の高さが f → f2 へ動く、ひとつの音
  function tone(ctx, out, t, o) {
    var g = gain(ctx, out, 0);
    env(g, t, o.a || 0.004, o.v, o.d);
    var x = osc(ctx, o.type || 'sine', o.f, t, (o.a || 0.004) + o.d, g);
    if (o.f2) {
      if (o.lin) x.frequency.linearRampToValueAtTime(o.f2, t + (o.glide || o.d));
      else x.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.d));
    }
    if (o.detune) x.detune.value = o.detune;
    return x;
  }
  // 色のついた ザッ という音(フィルターの周波数を f → f2 へ)
  function hiss(ctx, out, t, o) {
    var g = gain(ctx, out, 0);
    env(g, t, o.a || 0.002, o.v, o.d);
    var b = filt(ctx, o.ft || 'bandpass', o.f, o.q == null ? 1 : o.q, g);
    if (o.f2) b.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.d));
    noise(ctx, t, (o.a || 0.002) + o.d, b);
    return b;
  }

  // ---------- 効果音(S.名前(ctx, out, t, o)) ----------
  var S = {};

  // ドミノが倒れて当たる「カチッ」。木やプラスチックの小さな板。o.f = 音の高さ、o.v = 大きさ
  S.clack = function (ctx, out, t, o) {
    var v = o.v == null ? 0.3 : o.v, f = o.f || 880, dst = pan(ctx, out, o.pan);
    // 当たった瞬間の カッ(板の角がぶつかる)
    hiss(ctx, dst, t, { ft: 'bandpass', f: clamp(f * 3.1, 2400, 6500), q: 1.6, v: v * 1.1, a: 0.0008, d: 0.022 });
    // 板が鳴る(音の高さ = 音階)
    tone(ctx, dst, t, { f: f, v: v * 0.55, a: 0.001, d: 0.055 });
    tone(ctx, dst, t, { f: f * 2.76, v: v * 0.16, a: 0.001, d: 0.022 });
    // 床に当たる 低い コッ
    tone(ctx, dst, t, { f: 330, f2: 170, v: v * 0.35, a: 0.001, d: 0.03 });
  };
  // 並べる「コトッ」(とても小さく)
  S.lay = function (ctx, out, t, o) {
    var v = (o && o.v) || 0.07;
    tone(ctx, out, t, { f: 460, f2: 300, v: v, a: 0.001, d: 0.035 });
    hiss(ctx, out, t, { f: 1500, q: 2, v: v * 0.6, a: 0.001, d: 0.016 });
  };
  // 心臓の「ドクン」。スマホのスピーカーでも聞こえるよう、低い音に 少し高い成分を まぜる
  S.heart = function (ctx, out, t, o) {
    var v = o.v || 0.5;
    function beat(tt, vv) {
      tone(ctx, out, tt, { f: 68, f2: 42, v: vv, a: 0.006, d: 0.17 });
      tone(ctx, out, tt, { type: 'triangle', f: 150, f2: 85, v: vv * 0.7, a: 0.004, d: 0.12 });
      tone(ctx, out, tt, { f: 240, f2: 150, v: vv * 0.3, a: 0.003, d: 0.06 });
      hiss(ctx, out, tt, { ft: 'lowpass', f: 520, q: 0.7, v: vv * 0.55, a: 0.003, d: 0.07 });
    }
    beat(t, v); beat(t + 0.17, v * 0.7);
  };
  S.jump = function (ctx, out, t, o) {
    var big = o && o.big;
    tone(ctx, out, t, { type: 'triangle', f: big ? 260 : 330, f2: big ? 1050 : 760, v: 0.2, a: 0.005, d: big ? 0.3 : 0.15 });
    tone(ctx, out, t, { f: big ? 520 : 660, f2: big ? 2100 : 1520, v: 0.06, a: 0.005, d: big ? 0.26 : 0.12 });
    if (big) hiss(ctx, out, t, { f: 800, f2: 4000, q: 0.8, v: 0.08, a: 0.02, d: 0.3 });
  };
  S.land = function (ctx, out, t) {
    tone(ctx, out, t, { f: 160, f2: 70, v: 0.26, a: 0.002, d: 0.08 });
    hiss(ctx, out, t, { ft: 'lowpass', f: 900, q: 0.7, v: 0.16, a: 0.001, d: 0.045 });
  };
  S.bump = function (ctx, out, t) {
    tone(ctx, out, t, { f: 120, f2: 55, v: 0.4, a: 0.002, d: 0.14 });
    hiss(ctx, out, t, { ft: 'lowpass', f: 600, q: 0.8, v: 0.3, a: 0.001, d: 0.09 });
    S.clack(ctx, out, t, { f: 300, v: 0.18 });
  };
  // しびれた「ビビビッ」
  S.stun = function (ctx, out, t) {
    var g = gain(ctx, out, 0); env(g, t, 0.01, 0.13, 0.5);
    var lp = filt(ctx, 'lowpass', 2200, 1, g);
    var o = osc(ctx, 'sawtooth', 420, t, 0.52, lp);
    o.frequency.exponentialRampToValueAtTime(190, t + 0.5);
    var lfo = osc(ctx, 'square', 26, t, 0.52, gain(ctx, o.frequency, 90));
    lfo.frequency.value = 26;
    tone(ctx, out, t, { f: 200, f2: 90, v: 0.2, a: 0.002, d: 0.08 });
  };
  // 箱を拾った「ガラガラ」(ドミノが箱の中で鳴る)
  S.pick = function (ctx, out, t, o) {
    var big = o && o.big, n = big ? 12 : 7, pent = [0, 2, 4, 7, 9];
    for (var i = 0; i < n; i++) {
      var tt = t + i * (big ? 0.03 : 0.036) + rnd() * 0.012;
      S.clack(ctx, out, tt, { f: mtof(76 + pent[Math.floor(rnd() * 5)] + (rnd() < 0.4 ? 12 : 0)), v: 0.16 * (1 - i / (n + 3)), pan: (rnd() - 0.5) * 0.6 });
    }
    var e = t + n * 0.033;
    tone(ctx, out, e, { f: 1047, v: 0.12, a: 0.003, d: 0.25 });
    tone(ctx, out, e + 0.07, { f: 1568, v: 0.12, a: 0.003, d: 0.35 });
    if (big) tone(ctx, out, e + 0.14, { f: 2093, v: 0.11, a: 0.003, d: 0.45 });
  };
  // 金のドミノ「キラーン」
  S.star = function (ctx, out, t) {
    var fs = [1568, 2093, 2637, 3136, 4186];
    for (var i = 0; i < fs.length; i++) {
      var d = pan(ctx, out, i % 2 ? 0.35 : -0.35);
      tone(ctx, d, t + i * 0.045, { f: fs[i], v: 0.13, a: 0.002, d: 0.9 - i * 0.08 });
      tone(ctx, d, t + i * 0.045, { f: fs[i] * 2.01, v: 0.03, a: 0.002, d: 0.3 });
    }
    hiss(ctx, out, t + 0.05, { ft: 'highpass', f: 7000, q: 0.7, v: 0.05, a: 0.05, d: 0.6 });
  };
  S.coin = function (ctx, out, t) {
    var lp = filt(ctx, 'lowpass', 4000, 0.7, out);
    tone(ctx, lp, t, { type: 'square', f: 988, v: 0.08, a: 0.002, d: 0.07 });
    tone(ctx, lp, t + 0.07, { type: 'square', f: 1319, v: 0.08, a: 0.002, d: 0.28 });
  };
  // ダッシュ板「ブーン」
  S.boost = function (ctx, out, t) {
    var g = gain(ctx, out, 0); env(g, t, 0.04, 0.17, 0.5);
    var lp = filt(ctx, 'lowpass', 400, 4, g);
    lp.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
    var a = osc(ctx, 'sawtooth', 110, t, 0.55, lp), b = osc(ctx, 'sawtooth', 110, t, 0.55, lp);
    b.detune.value = 14;
    a.frequency.exponentialRampToValueAtTime(440, t + 0.4); b.frequency.exponentialRampToValueAtTime(440, t + 0.4);
    hiss(ctx, out, t, { f: 500, f2: 3500, q: 1.2, v: 0.1, a: 0.05, d: 0.45 });
  };
  // からくりの門が開く(カチカチ… ガチャン)
  S.gate = function (ctx, out, t) {
    var hp = filt(ctx, 'highpass', 1200, 0.7, out);
    for (var i = 0; i < 6; i++) tone(ctx, hp, t + i * 0.045, { type: 'square', f: 1900 - i * 60, v: 0.07, a: 0.001, d: 0.014 });
    var e = t + 0.29, lp = filt(ctx, 'lowpass', 1400, 1, out);
    tone(ctx, lp, e, { type: 'square', f: 160, v: 0.13, a: 0.002, d: 0.35 });
    tone(ctx, lp, e, { type: 'square', f: 237, v: 0.09, a: 0.002, d: 0.25 });
    hiss(ctx, out, e, { f: 2600, q: 1.5, v: 0.18, a: 0.001, d: 0.09 });
    tone(ctx, out, e + 0.12, { f: 1319, v: 0.07, a: 0.003, d: 0.3 });
  };
  // 数の門。ok = ふえた(上がる音)/ へった(下がる音)
  S.opgate = function (ctx, out, t, o) {
    if (o && o.ok === false) {
      var lp = filt(ctx, 'lowpass', 1300, 0.8, out);
      tone(ctx, lp, t, { type: 'square', f: 330, v: 0.1, a: 0.003, d: 0.1 });
      tone(ctx, lp, t + 0.13, { type: 'square', f: 262, f2: 233, v: 0.1, a: 0.003, d: 0.32 });
      return;
    }
    var x = o && o.op === 'x', ns = x ? [1047, 1319, 1568, 2093] : [1047, 1319, 1568], step = x ? 0.05 : 0.065;
    for (var i = 0; i < ns.length; i++) {
      tone(ctx, out, t + i * step, { type: 'triangle', f: ns[i], v: 0.15, a: 0.003, d: 0.25 });
      tone(ctx, out, t + i * step, { f: ns[i] * 2, v: 0.04, a: 0.003, d: 0.15 });
    }
    if (x) hiss(ctx, out, t + 0.15, { ft: 'highpass', f: 6000, q: 0.7, v: 0.05, a: 0.02, d: 0.4 });
  };
  // 2列になった「シャキーン」
  S.split = function (ctx, out, t) {
    hiss(ctx, out, t, { ft: 'highpass', f: 1800, f2: 8000, q: 0.8, v: 0.06, a: 0.01, d: 0.25 });
    tone(ctx, pan(ctx, out, -0.6), t + 0.04, { f: 1319, v: 0.1, a: 0.003, d: 0.5 });
    tone(ctx, pan(ctx, out, 0.6), t + 0.08, { f: 1976, v: 0.1, a: 0.003, d: 0.5 });
  };
  // 橋ドミノ(背の高いドミノ)「ゴトン、ぐいーん」
  S.bridge = function (ctx, out, t) {
    S.clack(ctx, out, t, { f: 330, v: 0.3 });
    tone(ctx, out, t + 0.04, { type: 'triangle', f: 523, f2: 1047, v: 0.12, a: 0.02, d: 0.3, glide: 0.2 });
  };
  // 爆弾「ドカン」
  S.bomb = function (ctx, out, t) {
    tone(ctx, out, t, { f: 120, f2: 30, v: 0.85, a: 0.002, d: 0.6, glide: 0.4 });
    hiss(ctx, out, t, { ft: 'lowpass', f: 4000, f2: 150, q: 0.7, v: 0.7, a: 0.002, d: 0.9, glide: 0.8 });
    hiss(ctx, out, t, { ft: 'highpass', f: 2200, q: 0.7, v: 0.35, a: 0.001, d: 0.08 });
    hiss(ctx, out, t + 0.05, { f: 300, q: 1, v: 0.3, a: 0.02, d: 0.5 });
  };
  // 途中の巨大ドミノ「ズーン」
  S.bigfall = function (ctx, out, t) {
    S.clack(ctx, out, t, { f: 220, v: 0.45 });
    tone(ctx, out, t + 0.02, { f: 90, f2: 38, v: 0.7, a: 0.004, d: 1.0, glide: 0.8 });
    tone(ctx, out, t + 0.02, { type: 'triangle', f: 180, f2: 70, v: 0.22, a: 0.004, d: 0.6 });
    hiss(ctx, out, t + 0.02, { ft: 'lowpass', f: 700, f2: 100, q: 0.7, v: 0.45, a: 0.004, d: 0.8 });
    S.clack(ctx, out, t + 0.36, { f: 196, v: 0.16 });
  };
  // 音のドミノ(オルゴール・鉄琴のような音)。o.f = 音の高さ
  S.note = function (ctx, out, t, o) {
    var f = o.f || 1047;
    tone(ctx, out, t, { f: f, v: 0.2, a: 0.002, d: 1.0 });
    tone(ctx, out, t, { f: f * 2, v: 0.06, a: 0.002, d: 0.4 });
    tone(ctx, out, t, { f: f * 3.01, v: 0.025, a: 0.001, d: 0.15 });
    S.clack(ctx, out, t, { f: f, v: 0.08 });
  };
  // 前から倒れてくる列「ゴゴゴ」(o.dur 秒)
  S.rival = function (ctx, out, t, o) {
    var dur = clamp((o && o.dur) || 2, 0.8, 5);
    var g = gain(ctx, out, 0), p = g.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(0.32, t + 0.25);
    p.setValueAtTime(0.32, t + dur - 0.3); p.linearRampToValueAtTime(0.0001, t + dur);
    var trem = gain(ctx, g, 0.6);
    var lfo = osc(ctx, 'sine', 9, t, dur, gain(ctx, trem.gain, 0.4));
    lfo.frequency.value = 9;
    noise(ctx, t, dur, filt(ctx, 'lowpass', 260, 1, trem));
    noise(ctx, t, dur, filt(ctx, 'bandpass', 180, 2, gain(ctx, trem, 0.6)));
    osc(ctx, 'sine', 52, t, dur, gain(ctx, trem, 0.35));
  };
  // ギリギリ「シュッ、ピン」
  S.near = function (ctx, out, t) {
    hiss(ctx, out, t, { f: 1200, f2: 5500, q: 1.4, v: 0.16, a: 0.01, d: 0.12 });
    tone(ctx, out, t + 0.07, { f: 1760, v: 0.13, a: 0.002, d: 0.35 });
    tone(ctx, out, t + 0.07, { f: 3520, v: 0.03, a: 0.002, d: 0.15 });
  };
  // 波が動き出す「カチッ」+ 小さな合図「ピッ」
  S.wavestart = function (ctx, out, t) {
    S.clack(ctx, out, t, { f: 880, v: 0.4 });
    tone(ctx, out, t + 0.12, { f: 1568, v: 0.12, a: 0.004, d: 0.12 });
    tone(ctx, out, t + 0.12, { type: 'triangle', f: 784, v: 0.06, a: 0.004, d: 0.12 });
  };
  S.low = function (ctx, out, t) {
    tone(ctx, out, t, { type: 'triangle', f: 880, v: 0.14, a: 0.003, d: 0.08 });
    tone(ctx, out, t + 0.14, { type: 'triangle', f: 880, v: 0.14, a: 0.003, d: 0.08 });
  };
  S.empty = function (ctx, out, t) {
    tone(ctx, out, t, { type: 'triangle', f: 700, f2: 220, v: 0.17, a: 0.004, d: 0.45 });
    S.clack(ctx, out, t + 0.05, { f: 600, v: 0.1 });
    S.clack(ctx, out, t + 0.12, { f: 500, v: 0.08 });
  };
  S.stepaside = function (ctx, out, t) {
    tone(ctx, out, t, { type: 'triangle', f: 600, f2: 950, v: 0.08, a: 0.004, d: 0.1 });
  };
  // ゴールの線をこえた: 明るい合図
  S.goal = function (ctx, out, t) {
    var ns = [1047, 1319, 1568, 2093, 2637];
    for (var i = 0; i < ns.length; i++) {
      tone(ctx, out, t + i * 0.06, { type: 'triangle', f: ns[i], v: 0.13, a: 0.003, d: 0.4 });
      tone(ctx, out, t + i * 0.06, { f: ns[i] * 2, v: 0.03, a: 0.003, d: 0.2 });
    }
    hiss(ctx, out, t + 0.2, { ft: 'highpass', f: 7000, q: 0.7, v: 0.05, a: 0.05, d: 0.5 });
  };
  // 歓声(合成のざわめき: 「わー」という声 + 息 + 拍手)
  S.crowd = function (ctx, out, t, o) {
    var len = (o && o.dur) || 3.2, v = (o && o.v) || 0.5;
    var bus = gain(ctx, out, 0), p = bus.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(v, t + 0.6);
    p.setValueAtTime(v, t + len * 0.6); p.exponentialRampToValueAtTime(0.0001, t + len);
    // 声: のこぎり波 → 「あ」の口の形(800Hz・1200Hz)
    var f1 = filt(ctx, 'bandpass', 800, 3, bus), f2 = filt(ctx, 'bandpass', 1250, 4, gain(ctx, bus, 0.7));
    var vo = gain(ctx, null, 1); vo.connect(f1); vo.connect(f2);
    for (var i = 0; i < 14; i++) {
      var st = t + rnd() * 0.5, d = len * (0.5 + rnd() * 0.45), base = 190 + rnd() * 260;
      var g = gain(ctx, vo, 0), q = g.gain;
      q.setValueAtTime(0.0001, st); q.linearRampToValueAtTime(0.05, st + 0.25 + rnd() * 0.3); q.exponentialRampToValueAtTime(0.0001, st + d);
      var x = osc(ctx, 'sawtooth', base, st, d, g);
      x.frequency.linearRampToValueAtTime(base * (1.15 + rnd() * 0.25), st + 0.4);
      x.frequency.linearRampToValueAtTime(base * (0.85 + rnd() * 0.1), st + d);
      var lfo = osc(ctx, 'sine', 5 + rnd() * 2, st, d, gain(ctx, x.frequency, base * 0.03));
      lfo.frequency.value = 5 + rnd() * 2;
    }
    // 息(ざわざわ)
    noise(ctx, t, len, filt(ctx, 'bandpass', 1100, 0.8, gain(ctx, bus, 0.35)));
    // 拍手
    for (var k = 0; k < 40; k++) {
      var ct = t + 0.4 + rnd() * (len * 0.7);
      hiss(ctx, pan(ctx, bus, (rnd() - 0.5) * 1.2), ct, { f: 1300 + rnd() * 1500, q: 1.5, v: 0.22 * (0.5 + rnd()), a: 0.001, d: 0.03 });
    }
  };
  // ゴールの大ドミノ「ドーーン」+ 低い地ひびき + 歓声
  S.giant = function (ctx, out, t, o) {
    var crowd = !o || o.crowd !== false;
    // 板の角が当たる バキッ
    hiss(ctx, out, t, { f: 1600, q: 1, v: 0.55, a: 0.001, d: 0.06 });
    S.clack(ctx, out, t, { f: 196, v: 0.5 });
    // ドーン(低い音・スマホで聞こえる中くらいの音)
    tone(ctx, out, t, { f: 72, f2: 28, v: 0.95, a: 0.004, d: 1.6, glide: 1.2 });
    tone(ctx, out, t, { type: 'triangle', f: 150, f2: 55, v: 0.32, a: 0.004, d: 0.9 });
    hiss(ctx, out, t, { ft: 'lowpass', f: 900, f2: 80, q: 0.7, v: 0.6, a: 0.003, d: 1.8, glide: 1.5 });
    // 地ひびき(ゴロゴロ…)
    var g = gain(ctx, out, 0), p = g.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(0.28, t + 0.15); p.exponentialRampToValueAtTime(0.0001, t + 2.8);
    noise(ctx, t, 2.8, filt(ctx, 'lowpass', 140, 1.2, g));
    noise(ctx, t, 2.8, filt(ctx, 'bandpass', 220, 1.5, gain(ctx, g, 0.5)));
    // まわりの ドミノも ガラガラ
    for (var i = 0; i < 8; i++) S.clack(ctx, out, t + 0.08 + i * 0.05 + rnd() * 0.03, { f: 300 + rnd() * 500, v: 0.12 * (1 - i / 10), pan: (rnd() - 0.5) * 0.8 });
    if (crowd) S.crowd(ctx, out, t + 0.35, { dur: 3.2, v: 0.5 });
  };
  // 金管(ファンファーレ用)
  function brass(ctx, out, t, f, dur, v) {
    var g = gain(ctx, out, 0), p = g.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(v, t + 0.02);
    p.setValueAtTime(v * 0.8, t + Math.max(0.03, dur - 0.05)); p.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    var lp = filt(ctx, 'lowpass', 700, 2, g);
    lp.frequency.linearRampToValueAtTime(3200, t + 0.04); lp.frequency.exponentialRampToValueAtTime(1500, t + dur + 0.1);
    var a = osc(ctx, 'sawtooth', f, t, dur + 0.15, lp), b = osc(ctx, 'sawtooth', f, t, dur + 0.15, lp);
    a.detune.value = -6; b.detune.value = 6;
  }
  // クリア: 短いファンファーレ「タタタ ターン」
  S.clear = function (ctx, out, t) {
    var n = [[67, 0, 0.1], [72, 0.12, 0.1], [76, 0.24, 0.1], [79, 0.36, 0.55]];
    for (var i = 0; i < n.length; i++) brass(ctx, out, t + n[i][1], mtof(n[i][0]), n[i][2], 0.12);
    var c = [60, 64, 67, 72];
    for (var k = 0; k < c.length; k++) brass(ctx, out, t + 0.36, mtof(c[k]), 0.6, 0.05);
    tone(ctx, out, t + 0.36, { f: 2093, v: 0.06, a: 0.003, d: 0.8 });
    hiss(ctx, out, t + 0.36, { ft: 'highpass', f: 6000, q: 0.7, v: 0.05, a: 0.02, d: 0.7 });
  };
  // 負け: 理由ごとに 少しちがう。短く・明るめ。最後に「もう1回!」の 小さな ピョコ
  S.fail = function (ctx, out, t, o) {
    var why = (o && o.why) || 'caught', e = t;
    if (why === 'caught') {           // つかまった「わわっ」
      tone(ctx, out, t, { type: 'triangle', f: 880, f2: 440, v: 0.16, a: 0.005, d: 0.25, glide: 0.22 });
      S.clack(ctx, out, t, { f: 523, v: 0.2 });
      tone(ctx, out, t + 0.3, { type: 'triangle', f: 523, v: 0.13, a: 0.004, d: 0.1 });
      tone(ctx, out, t + 0.42, { type: 'triangle', f: 392, v: 0.13, a: 0.004, d: 0.18 });
      e = t + 0.62;
    } else if (why === 'fall') {      // 落ちた「ヒューー… ぽふ」
      tone(ctx, out, t, { f: 1200, f2: 220, v: 0.13, a: 0.01, d: 0.7 });
      hiss(ctx, out, t + 0.72, { ft: 'lowpass', f: 700, q: 0.7, v: 0.2, a: 0.004, d: 0.14 });
      e = t + 0.85;
    } else if (why === 'empty') {     // ドミノ切れ「からん… とん とん」
      S.clack(ctx, out, t, { f: 659, v: 0.16 }); S.clack(ctx, out, t + 0.1, { f: 587, v: 0.12 });
      tone(ctx, out, t + 0.22, { type: 'triangle', f: 659, v: 0.12, a: 0.004, d: 0.12 });
      tone(ctx, out, t + 0.36, { type: 'triangle', f: 494, v: 0.12, a: 0.004, d: 0.2 });
      e = t + 0.6;
    } else {                          // 列が切れた「プツン… ポロロ」
      S.clack(ctx, out, t, { f: 600, v: 0.25 });
      hiss(ctx, out, t, { ft: 'highpass', f: 3000, q: 0.7, v: 0.12, a: 0.001, d: 0.04 });
      var lp = filt(ctx, 'lowpass', 1800, 0.7, out);
      tone(ctx, lp, t + 0.16, { type: 'square', f: 784, v: 0.07, a: 0.003, d: 0.1 });
      tone(ctx, lp, t + 0.28, { type: 'square', f: 659, v: 0.07, a: 0.003, d: 0.1 });
      tone(ctx, lp, t + 0.4, { type: 'square', f: 523, v: 0.07, a: 0.003, d: 0.18 });
      e = t + 0.62;
    }
    tone(ctx, out, e, { type: 'triangle', f: 523, v: 0.09, a: 0.003, d: 0.07 });
    tone(ctx, out, e + 0.08, { type: 'triangle', f: 784, v: 0.09, a: 0.003, d: 0.14 });
  };
  // お助け: キラキラと上がる
  S.revive = function (ctx, out, t) {
    var ns = [72, 74, 76, 79, 81, 84, 86, 88, 91];
    for (var i = 0; i < ns.length; i++) tone(ctx, pan(ctx, out, (i % 2 ? 0.3 : -0.3)), t + i * 0.035, { type: 'triangle', f: mtof(ns[i]), v: 0.1, a: 0.003, d: 0.3 });
    tone(ctx, out, t, { f: 400, f2: 1600, v: 0.06, a: 0.05, d: 0.4 });
    hiss(ctx, out, t + 0.1, { ft: 'highpass', f: 6500, q: 0.7, v: 0.06, a: 0.05, d: 0.6 });
  };
  // コンボの区切り(100 ごと)「ピロリン」
  S.milestone = function (ctx, out, t, o) {
    var b = (o && o.f) || 1047;
    tone(ctx, out, t, { f: b, v: 0.08, a: 0.002, d: 0.15 });
    tone(ctx, out, t + 0.05, { f: b * 1.25, v: 0.08, a: 0.002, d: 0.15 });
    tone(ctx, out, t + 0.1, { f: b * 1.5, v: 0.08, a: 0.002, d: 0.3 });
  };

  // ---------- カタカタ(倒れる音)のまとめ方 ----------
  var CLICK_GAP = 1 / 32;              // 1秒に 32 回まで
  var PENT_MAJ = [0, 2, 4, 7, 9], PENT_MIN = [0, 3, 5, 7, 10];
  // コンボ → 音の高さ。8枚ごとに1つ上がる。2オクターブ上がりきったら、1オクターブもどって また上がる
  function comboFreq(combo, song) {
    var deg = Math.floor(combo / 8);
    if (deg >= 10) deg = 5 + (deg - 10) % 5;
    var sc = song && song.minor ? PENT_MIN : PENT_MAJ;
    var root = song ? 72 + ((song.key % 12) + 12) % 12 : 72;   // 523〜988Hz のあたりから
    if (root > 77) root -= 12;
    return mtof(root - 12 + 12 * Math.floor(deg / 5) + sc[deg % 5] + 12);
  }
  // list = その1コマに倒れた topple の出来事。st = { last, clicks, dropped }
  function toppleBatch(st, ctx, out, t, list, song, px) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var tt = Math.max(t, st.last + CLICK_GAP);
      if (tt > t + 0.05) { st.dropped++; continue; }   // 多すぎる分は まとめる(鳴らさない)
      st.last = tt;
      st.clicks++;
      // まとめた枚数が多いほど 少しだけ大きく(でも うるさくしない)
      var v = 0.22 * (0.85 + rnd() * 0.3) * (list.length > 1 ? 1.12 : 1);
      var f = comboFreq(e.combo || 0, song) * (1 + (rnd() - 0.5) * 0.02);
      S.clack(ctx, out, tt, { f: f, v: v, pan: e.pan != null ? e.pan : 0 });
      if (e.combo && e.combo % 100 === 0) S.milestone(ctx, out, tt + 0.03, { f: comboFreq(e.combo, song) });
    }
  }

  // ---------- BGM ----------
  // 1小節 = 16 マス。mel の 文字: '.' 休み / '-' のばす / '0'〜'9' 'a'〜'e' = 音階の何番目(0 = key の 1オクターブ上)
  // bass: 'R' 和音の根 / '5' 5度 / 'O' 1オクターブ上 / '-' のばす。chords = 小節ごとの和音(音階の何番目)
  // lead: pluck(はじく)/ chip(ピコピコ)/ bell(鉄琴)/ marimba / flute(笛)/ brass(金管)
  var MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], DOR = [0, 2, 3, 5, 7, 9, 10], LYD = [0, 2, 4, 6, 7, 9, 11];
  var SONGS = {
    1: { name: '公園', bpm: 112, key: 60, scale: MAJ, lead: 'pluck', bass: 'tri', vol: 1, chords: [0, 5, 3, 4],
      mel: ['2-4-7-4-5-4-2---', '0-2-5---4-2-0---', '3-5-7-5-3-2-3-5-', '4---6-5-4---1---'],
      bassPat: 'R...R...5...R...', k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' },
    2: { name: 'おもちゃ', bpm: 126, key: 65, scale: MAJ, lead: 'chip', bass: 'sq', vol: 0.85, chords: [0, 3, 4, 0],
      mel: ['0.2.4.7.4.2.0...', '3.5.7.5.3.5.7...', '4.6.8.6.4.6.8.6.', '7.4.2.4.0---....'],
      bassPat: 'R.5.R.5.R.5.R.5.', k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    3: { name: '工場', bpm: 116, key: 57, scale: DOR, minor: true, lead: 'chip', bass: 'sq', vol: 0.85, perc: 'tick', chords: [0, 0, 3, 4],
      mel: ['0..0..2.3..2..0.', '0..0..4.3.2.0...', '3..3..5.6..5..3.', '4..4..6.7.6.4.2.'],
      bassPat: 'R.R.R.R.R.R.5.O.', k: 'x.....x...x.....', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
    4: { name: '空', bpm: 96, key: 62, scale: LYD, lead: 'bell', bass: 'sub', pad: true, vol: 0.72, echo: 0.3, chords: [0, 1, 0, 1],
      mel: ['4---7---6-4-2---', '5---8---7-5-1---', '4---7---9-8-7-6-', '5-------4-------'],
      bassPat: 'R-------5-------', k: 'x...............', s: '........x.......', h: '....x.......x...' },
    5: { name: '森', bpm: 122, key: 52, scale: MIN, minor: true, lead: 'marimba', bass: 'tri', vol: 0.9, perc: 'tom', chords: [0, 5, 2, 6],
      mel: ['0.2.4.0.7.4.2.4.', '5.4.2.0.2.4.5...', '2.4.6.4.9.7.6.4.', '6.4.3.1.6.....1.'],
      bassPat: 'R..R..5.R..R..O.', k: 'x..x....x..x....', s: '....x.......x.x.', h: '..x...x...x...x.' },
    6: { name: '雪', bpm: 104, key: 55, scale: MAJ, lead: 'bell', bass: 'tri', pad: true, vol: 0.85, echo: 0.25, perc: 'shaker', chords: [0, 4, 5, 3],
      mel: ['7-6-4-2-4-----..', '8-7-4-1-4-----..', '9-8-7-5-7-8-9-..', 'a-9-8-7-6-----..'],
      bassPat: 'R...5...R...5...', k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    7: { name: '祭り', bpm: 128, key: 62, scale: [0, 2, 5, 7, 9], lead: 'flute', bass: 'tri', vol: 0.8, perc: 'kane', taiko: true, chords: [0, 0, 3, 2],
      mel: ['0-1-2-3-4---3-2-', '3-2-1-0-1-------', '2-3-4-5-6---5-4-', '3-4-3-2-0-------'],
      bassPat: 'R...R.R.5...R...', k: 'x..x..x.x...x...', s: '....x.......x..x', h: '..x...x...x...x.' },
    8: { name: '海', bpm: 104, key: 58, scale: MAJ, lead: 'pluck', bass: 'tri', vol: 0.9, swing: 0.14, perc: 'shaker', echo: 0.2, chords: [0, 3, 1, 4],
      mel: ['4-2-0-2-4-5-4---', '5-5-7-5-4-------', '3-3-3-2-1-3-5---', '4-4-2-1-0-------'],
      bassPat: 'R..5..R.5..R.5..', k: 'x.....x.x.......', s: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
    9: { name: '夜', bpm: 80, key: 57, scale: MIN, minor: true, lead: 'bell', bass: 'sub', pad: true, vol: 0.6, echo: 0.4, quiet: true, chords: [0, 5, 3, 4],
      mel: ['4-------2---0---', '........7---5---', '3-------2---0---', '1---------------'],
      bassPat: 'R---------------', k: 'x...............', s: '................', h: '................' },
    10: { name: '城', bpm: 136, key: 48, scale: [0, 2, 3, 5, 7, 8, 11], minor: true, lead: 'brass', bass: 'saw', pad: true, vol: 1, chords: [0, 5, 3, 4],
      mel: ['0-0-2-4---4-5-4-', '7---5-4-2-0-2---', '3-3-5-7---7-8-7-', '6-------4---6---'],
      bassPat: 'R.R.R.R.5.5.O.O.', k: 'x...x...x...x.x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' }
  };
  function scaleNote(song, idx) {
    var sc = song.scale, n = sc.length;
    return song.key + 12 * Math.floor(idx / n) + sc[((idx % n) + n) % n];
  }
  function melIdx(ch) { var c = ch.charCodeAt(0); if (c >= 48 && c <= 57) return c - 48; if (c >= 97 && c <= 101) return c - 87; return -1; }

  var INST = {
    pluck: function (ctx, out, t, f, dur, v) {
      var lp = filt(ctx, 'lowpass', 3200, 0.8, out);
      lp.frequency.exponentialRampToValueAtTime(900, t + 0.25);
      tone(ctx, lp, t, { type: 'triangle', f: f, v: v, a: 0.003, d: Math.min(0.5, dur + 0.15) });
      tone(ctx, lp, t, { type: 'sawtooth', f: f, v: v * 0.25, a: 0.002, d: 0.08 });
    },
    chip: function (ctx, out, t, f, dur, v) {
      var lp = filt(ctx, 'lowpass', 3000, 0.7, out), g = gain(ctx, lp, 0), p = g.gain;
      p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(v * 0.55, t + 0.004);
      p.setValueAtTime(v * 0.45, t + Math.max(0.02, dur * 0.8)); p.linearRampToValueAtTime(0.0001, t + dur);
      osc(ctx, 'square', f, t, dur, g);
    },
    bell: function (ctx, out, t, f, dur, v) {
      tone(ctx, out, t, { f: f, v: v, a: 0.002, d: Math.max(0.6, dur + 0.4) });
      tone(ctx, out, t, { f: f * 2, v: v * 0.25, a: 0.002, d: 0.35 });
      tone(ctx, out, t, { f: f * 2.76, v: v * 0.12, a: 0.001, d: 0.12 });
    },
    marimba: function (ctx, out, t, f, dur, v) {
      tone(ctx, out, t, { f: f, v: v, a: 0.002, d: 0.35 });
      tone(ctx, out, t, { f: f * 4, v: v * 0.18, a: 0.001, d: 0.05 });
      tone(ctx, out, t, { f: f * 10, v: v * 0.05, a: 0.001, d: 0.015 });
    },
    flute: function (ctx, out, t, f, dur, v) {
      var g = gain(ctx, out, 0), p = g.gain;
      v *= 0.6;
      p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(v, t + 0.04);
      p.setValueAtTime(v * 0.85, t + Math.max(0.05, dur - 0.03)); p.linearRampToValueAtTime(0.0001, t + dur + 0.08);
      var o = osc(ctx, 'sine', f, t, dur + 0.1, g);
      osc(ctx, 'triangle', f, t, dur + 0.1, gain(ctx, g, 0.3));
      if (dur > 0.25) { var l = osc(ctx, 'sine', 5.5, t + 0.15, dur, gain(ctx, o.frequency, f * 0.012)); l.frequency.value = 5.5; }
      hiss(ctx, out, t, { f: f * 2, q: 2, v: v * 0.15, a: 0.01, d: 0.06 });
    },
    brass: function (ctx, out, t, f, dur, v) { brass(ctx, out, t, f, dur, v * 0.8); }
  };
  var BASS = {
    tri: function (ctx, out, t, f, dur, v) { tone(ctx, out, t, { type: 'triangle', f: f, v: v, a: 0.004, d: Math.min(0.6, dur + 0.1) }); },
    sq: function (ctx, out, t, f, dur, v) {
      var lp = filt(ctx, 'lowpass', 700, 1, out);
      tone(ctx, lp, t, { type: 'square', f: f, v: v * 0.6, a: 0.003, d: Math.min(0.4, dur + 0.05) });
    },
    saw: function (ctx, out, t, f, dur, v) {
      var lp = filt(ctx, 'lowpass', 900, 3, out);
      lp.frequency.exponentialRampToValueAtTime(300, t + 0.15);
      tone(ctx, lp, t, { type: 'sawtooth', f: f, v: v * 0.6, a: 0.003, d: Math.min(0.4, dur + 0.05) });
    },
    sub: function (ctx, out, t, f, dur, v) {
      var g = gain(ctx, out, 0), p = g.gain;
      v *= 0.75;
      p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(v, t + 0.08);
      p.setValueAtTime(v * 0.8, t + Math.max(0.1, dur - 0.1)); p.linearRampToValueAtTime(0.0001, t + dur + 0.1);
      osc(ctx, 'sine', f, t, dur + 0.15, g);
      osc(ctx, 'triangle', f * 2, t, dur + 0.15, gain(ctx, g, 0.2));
    }
  };
  var DRUM = {
    kick: function (ctx, out, t, v) {
      tone(ctx, out, t, { f: 150, f2: 48, v: v, a: 0.002, d: 0.22, glide: 0.12 });
      hiss(ctx, out, t, { ft: 'lowpass', f: 2500, q: 0.7, v: v * 0.15, a: 0.001, d: 0.01 });
    },
    taiko: function (ctx, out, t, v) {
      tone(ctx, out, t, { f: 110, f2: 62, v: v, a: 0.003, d: 0.4, glide: 0.25 });
      hiss(ctx, out, t, { ft: 'lowpass', f: 500, q: 0.7, v: v * 0.4, a: 0.002, d: 0.12 });
    },
    snare: function (ctx, out, t, v) {
      hiss(ctx, out, t, { f: 1900, q: 0.8, v: v * 0.7, a: 0.001, d: 0.12 });
      tone(ctx, out, t, { type: 'triangle', f: 200, f2: 150, v: v * 0.5, a: 0.001, d: 0.06 });
    },
    hat: function (ctx, out, t, v) { hiss(ctx, out, t, { ft: 'highpass', f: 7500, q: 0.7, v: v, a: 0.001, d: 0.03 }); },
    shaker: function (ctx, out, t, v) { hiss(ctx, out, t, { f: 5500, q: 1.2, v: v * 1.1, a: 0.012, d: 0.05 }); },
    tick: function (ctx, out, t, v) { tone(ctx, filt(ctx, 'highpass', 1500, 0.7, out), t, { type: 'square', f: 2400, v: v * 0.5, a: 0.001, d: 0.012 }); },
    kane: function (ctx, out, t, v) {
      tone(ctx, out, t, { f: 2200, v: v * 0.45, a: 0.001, d: 0.12 });
      tone(ctx, out, t, { f: 3170, v: v * 0.3, a: 0.001, d: 0.08 });
    },
    tom: function (ctx, out, t, v) { tone(ctx, out, t, { f: 220, f2: 140, v: v, a: 0.002, d: 0.15 }); }
  };
  function padChord(ctx, out, t, song, deg, dur, v) {
    var g = gain(ctx, out, 0), p = g.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(v, t + dur * 0.3);
    p.setValueAtTime(v, t + dur * 0.75); p.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    var lp = filt(ctx, 'lowpass', 1100, 0.7, g);
    for (var i = 0; i < 3; i++) {
      var f = mtof(scaleNote(song, deg + i * 2) - 12);
      var a = osc(ctx, 'sawtooth', f, t, dur + 0.1, lp), b = osc(ctx, 'sawtooth', f, t, dur + 0.1, lp);
      a.detune.value = -8; b.detune.value = 8;
    }
  }

  // ms = { song, step, next, tempo(1 = ふつう), inten(0..1 強さ) }。horizon 秒先まで 音を予約する
  function musicSchedule(ms, ctx, ch, horizon) {
    var song = ms.song; if (!song) return;
    var bars = song.mel.length, total = bars * 16;
    var stepDur = 60 / song.bpm / 4 / (ms.tempo || 1);
    var lead = INST[song.lead] || INST.pluck, bass = BASS[song.bass] || BASS.tri;
    var leadOut = ch.musLead || ch.mus;
    while (ms.next < horizon) {
      var s = ms.step % total, bar = Math.floor(s / 16), i = s % 16;
      var t = ms.next + (song.swing && i % 2 ? song.swing * stepDur : 0);
      var deg = song.chords[bar % song.chords.length];
      var inten = ms.inten || 0;
      // メロディー
      var line = song.mel[bar], c = line.charAt(i), mi = melIdx(c);
      if (mi >= 0) {
        var n = 1; while (i + n < 16 && line.charAt(i + n) === '-') n++;
        lead(ctx, leadOut, t, mtof(scaleNote(song, mi) + 12), n * stepDur * 0.95, 0.16);
      }
      // ベース
      var bc = song.bassPat.charAt(i);
      if (bc === 'R' || bc === '5' || bc === 'O') {
        var bn = 1; while (i + bn < 16 && song.bassPat.charAt(i + bn) === '-') bn++;
        var root = scaleNote(song, deg) - 12; while (root >= song.key) root -= 12;
        var bf = bc === 'R' ? root : bc === '5' ? root + 7 : root + 12;
        bass(ctx, ch.mus, t, mtof(bf), bn * stepDur, 0.22);
      }
      // パッド(小節の頭)
      if (song.pad && i === 0) padChord(ctx, ch.mus, t, song, deg, 16 * stepDur, song.quiet ? 0.008 : 0.014);
      // リズム
      if (song.k.charAt(i) === 'x') (song.taiko ? DRUM.taiko : DRUM.kick)(ctx, ch.mus, t, song.quiet ? 0.25 : 0.45 + inten * 0.1);
      if (song.s.charAt(i) === 'x') DRUM.snare(ctx, ch.mus, t, 0.16 + inten * 0.05);
      var hatF = song.perc && DRUM[song.perc] && song.perc !== 'tom' ? DRUM[song.perc] : DRUM.hat;
      if (song.h.charAt(i) === 'x') hatF(ctx, ch.mus, t, 0.07 + inten * 0.03);
      else if (inten > 0.5 && !song.quiet) hatF(ctx, ch.mus, t, 0.035 * inten);         // 速いときは きざみを足す
      if (song.perc === 'tom' && i === 14 && bar % 2 === 1) DRUM.tom(ctx, ch.mus, t, 0.2);
      if (inten > 0.75 && !song.quiet && i % 8 === 4) DRUM.kick(ctx, ch.mus, t, 0.18);    // とても速いときは 足を足す
      ms.step++;
      ms.next += stepDur;
    }
  }

  // 心臓の予約。hs = { next, beats }、c = 近さ 0..1
  function heartSchedule(hs, ctx, out, now, c, horizon) {
    var interval = 0.95 - 0.5 * c;              // 0.95 秒 → 0.45 秒
    if (hs.next < now) hs.next = now + 0.02;
    while (hs.next < horizon) {
      S.heart(ctx, out, hs.next, { v: 0.22 + 0.5 * c });
      hs.beats++;
      hs.next += interval;
    }
  }

  // ---------- つなぎ方(本物の AudioContext でも Offline でも 同じ) ----------
  function softCurve() {
    var n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1, a = Math.abs(x);
      var y = a < 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18);
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }
  var MUS_BASE = 0.27;               // BGM の ふつうの大きさ(効果音より 小さく)
  function makeChain(ctx) {
    var ch = {};
    var shaper = ctx.createWaveShaper(); shaper.curve = softCurve(); shaper.connect(ctx.destination);
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    lim.connect(shaper);
    var master = gain(ctx, lim, 0.8);
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(master);
    ch.master = master; ch.comp = comp;
    ch.sfx = gain(ctx, comp, 1);
    ch.mus = gain(ctx, comp, MUS_BASE);
    // メロディーにだけ 少し こだま
    ch.musLead = gain(ctx, ch.mus, 1);
    var dl = ctx.createDelay(1.0); dl.delayTime.value = 0.32;
    var fb = gain(ctx, dl, 0.28), lp = filt(ctx, 'lowpass', 2200, 0.7, fb);
    dl.connect(lp);
    ch.echoWet = gain(ctx, ch.mus, 0);
    dl.connect(ch.echoWet);
    ch.musLead.connect(dl);
    return ch;
  }

  // ---------- 本番の状態 ----------
  var A = {
    ctx: null, ch: null, paused: false, hidden: false,
    stageObj: null, song: SONGS[1], world: 1,
    mus: { song: null, step: 0, next: 0, tempo: 1, inten: 0, on: false },
    heart: { next: 0, beats: 0, on: false },
    click: { last: 0, clicks: 0, dropped: 0 },
    layN: 0, layLast: 0, musLevel: -1, duck: 1, duckUntil: 0,
    wind: null, rivalSeen: 0, rivalLast: 0, rivalClicks: 0
  };
  var stats = { created: false, unlocks: 0, sfx: {}, clicks: 0, dropped: 0, lays: 0, beats: 0, steps: 0, rivalClicks: 0, errors: 0 };

  function settings() { var s = DOMINO.Save && DOMINO.Save.data && DOMINO.Save.data.settings; return s || { sound: true, music: true }; }
  function soundOn() { return settings().sound !== false; }
  function musicOn() { return settings().music !== false; }
  function songFor(stage) { var w = stage ? (stage.world || Math.ceil((stage.id || 1) / 10)) : 1; return SONGS[clamp(w | 0, 1, 10)] || SONGS[1]; }

  function ensure() {
    if (A.ctx) return A.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      A.ctx = new AC();
      A.ch = makeChain(A.ctx);
      A.ch.sfx.gain.value = soundOn() ? 1 : 0;
      stats.created = true;
    } catch (e) { A.ctx = null; stats.errors++; }
    return A.ctx;
  }
  function running() { return A.ctx && A.ctx.state === 'running' && !A.paused && !A.hidden; }
  function play(name, o, dt) {
    if (!running() || !soundOn() || !S[name]) return;
    try { S[name](A.ctx, A.ch.sfx, A.ctx.currentTime + 0.005 + (dt || 0), o || {}); stats.sfx[name] = (stats.sfx[name] || 0) + 1; }
    catch (e) { stats.errors++; }
  }

  function unlock() {
    var ctx = ensure(); if (!ctx) return;
    stats.unlocks++;
    try {
      if (ctx.state !== 'running' && !A.paused) { var r = ctx.resume(); if (r && r.catch) r.catch(function () {}); }
      // iPhone の古い Safari: タップの中で 無音を1回鳴らすと 音が出るようになる
      var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) { stats.errors++; }
  }
  // UI が呼びわすれても鳴るように、タップのたびに そっと unlock する(動いていれば 何もしない)
  function gesture() { if (!A.ctx || A.ctx.state !== 'running') unlock(); }
  try {
    document.addEventListener('touchend', gesture, true);
    document.addEventListener('pointerup', gesture, true);
    document.addEventListener('keydown', gesture, true);
    document.addEventListener('visibilitychange', function () {
      A.hidden = document.hidden;
      if (!A.ctx) return;
      try { if (document.hidden) A.ctx.suspend(); else if (!A.paused) A.ctx.resume(); } catch (e) {}
    });
  } catch (e) {}

  function setMusicLevel(level, fast) {
    if (!A.ctx) return;
    if (Math.abs(level - A.musLevel) < 0.005) return;
    A.musLevel = level;
    var p = A.ch.mus.gain, t = A.ctx.currentTime;
    p.cancelScheduledValues(t); p.setTargetAtTime(level * MUS_BASE, t, fast ? 0.05 : 0.25);
  }
  function stopWind() {
    if (!A.wind) return;
    try { var t = A.ctx.currentTime; A.wind.g.gain.setTargetAtTime(0, t, 0.1); A.wind.src.stop(t + 0.5); } catch (e) {}
    A.wind = null;
  }
  function startWind() {
    if (A.wind || !A.ctx) return;
    var ctx = A.ctx, g = gain(ctx, A.ch.sfx, 0);
    var bp = filt(ctx, 'bandpass', 900, 2.5, g), bp2 = filt(ctx, 'bandpass', 2200, 4, gain(ctx, g, 0.4));
    var src = ctx.createBufferSource(); src.buffer = noiseBuf(ctx); src.loop = true;
    src.connect(bp); src.connect(bp2); src.start();
    A.wind = { g: g, bp: bp, bp2: bp2, src: src, level: 0 };
  }

  function stageFn(stage) {
    A.stageObj = stage;
    var song = songFor(stage);
    A.song = song;
    A.heart.on = false; A.rivalSeen = 0; A.duck = 1; A.duckUntil = 0;
    A.click.last = 0;
    stopWind();
    if (A.mus.song !== song) { A.mus.song = song; A.mus.step = 0; A.mus.next = 0; }
    A.mus.on = true; A.mus.tempo = 1; A.mus.inten = 0;
    if (A.ctx) setMusicLevel(musicOn() ? song.vol * 0.4 : 0);
  }
  function start(stage) {
    ensure();
    if (stage && stage !== A.stageObj) stageFn(stage);
    A.mus.on = true;
    if (A.ctx && A.ctx.state !== 'running' && !A.paused) { try { var r = A.ctx.resume(); if (r && r.catch) r.catch(function () {}); } catch (e) {} }
  }
  function stop() {
    A.mus.on = false; A.heart.on = false;
    A.mus.song = null;
    stopWind();
    if (A.ctx) setMusicLevel(0, true);
  }
  function pause(on) {
    A.paused = !!on;
    if (!A.ctx) return;
    try { if (on) A.ctx.suspend(); else if (!A.hidden) A.ctx.resume(); } catch (e) {}
  }

  function onEvents(list, sim) {
    if (!list || !list.length) return;
    var topples = null;
    for (var i = 0; i < list.length; i++) {
      var e = list[i], ty = e.type;
      if (ty === 'topple') {
        if (!topples) topples = [];
        var d = sim && sim.doms && sim.doms[e.i];
        topples.push({ combo: e.combo, pan: d && sim.p ? clamp((d.x - sim.p.x) / 6, -0.5, 0.5) : 0 });
        continue;
      }
      if (ty === 'lay') {            // とても小さく、まびく(3枚に1回・1秒に 5 回まで)
        A.layN++;
        if (A.layN % 3 === 0 && A.ctx && A.ctx.currentTime - A.layLast > 0.18) { A.layLast = A.ctx.currentTime; play('lay', { v: 0.06 }); stats.lays++; }
        continue;
      }
      switch (ty) {
        case 'pick':
          var it = e.item || {};
          if (it.t === 'star') play('star'); else if (it.t === 'coin') play('coin'); else play('pick', { big: it.t === 'bigbox' });
          break;
        case 'jump': play('jump', { big: e.big }); break;
        case 'stun': play('stun', { why: e.why }); break;
        case 'opgate': play('opgate', { ok: e.ok, op: e.op }); break;
        case 'note':
          var mel = A.stageObj && A.stageObj.melody, semi;
          if (mel && mel.length) semi = mel[(e.k || 0) % mel.length];
          else { var doremi = [0, 2, 4, 5, 7, 9, 11, 12]; semi = doremi[(e.k || 0) % doremi.length]; }
          play('note', { f: mtof(72 + (+semi || 0)) });
          break;
        case 'rival':
          var o = sim && sim.objs && sim.objs[e.id], dur = o ? Math.abs(o.z2 - o.z) / (o.v || 5) + 0.4 : 2;
          play('rival', { dur: dur });
          break;
        case 'goal': play('goal'); A.duck = 0.6; A.duckUntil = A.ctx ? A.ctx.currentTime + 6 : 0; break;
        case 'giant': play('giant'); A.duck = 0.2; A.duckUntil = A.ctx ? A.ctx.currentTime + 4.5 : 0; break;
        case 'clear': play('clear', null, 0.05); A.heart.on = false; break;
        case 'fail': play('fail', { why: e.why }); A.heart.on = false; A.duck = 0.5; A.duckUntil = A.ctx ? A.ctx.currentTime + 2 : 0; break;
        case 'revive': play('revive'); A.duck = 1; A.duckUntil = 0; break;
        case 'gate': case 'land': case 'bump': case 'boost': case 'split': case 'bridge': case 'bomb': case 'bigfall':
        case 'near': case 'wavestart': case 'low': case 'empty': case 'stepaside':
          play(ty); break;
      }
    }
    if (topples) {
      if (!running() || !soundOn()) { stats.dropped += topples.length; return; }
      var c = A.click, b0 = c.clicks, d0 = c.dropped;
      try { toppleBatch(c, A.ctx, A.ch.sfx, A.ctx.currentTime + 0.005, topples, A.song); } catch (er) { stats.errors++; }
      stats.clicks += c.clicks - b0; stats.dropped += c.dropped - d0;
    }
  }

  function update(sim, dt, state) {
    var ctx = A.ctx;
    if (!ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime;
    try {
      var playing = state === 'play' && sim && sim.state === 'run';
      // 心臓: 波が 4m より近いと ドクン…ドクン(近いほど 速く・大きく)
      var c = 0;
      if (playing && sim.wave && sim.wave.started && sim.danger < 4 && !(sim.p && sim.p.safe > 0)) c = clamp(1 - sim.danger / 4, 0, 1);
      if (c > 0 && soundOn()) { var b0 = A.heart.beats; heartSchedule(A.heart, ctx, A.ch.sfx, now, c, now + 0.1); stats.beats += A.heart.beats - b0; }
      else A.heart.next = 0;

      // 風(ヒュー): obj の wind が on の間
      var windOn = false, windDir = 1;
      if (playing && sim.objs) for (var i = 0; i < sim.objs.length; i++) if (sim.objs[i].t === 'wind' && sim.objs[i].on) { windOn = true; windDir = sim.objs[i].dir || 1; }
      if (windOn && soundOn()) startWind();
      if (A.wind) {
        var wl = windOn && soundOn() ? 0.16 : 0;
        if (Math.abs(wl - A.wind.level) > 0.001) { A.wind.level = wl; A.wind.g.gain.setTargetAtTime(wl, now, 0.3); }
        var wf = 700 + 450 * Math.sin(now * 1.3) + 250 * Math.sin(now * 0.47 + windDir);
        A.wind.bp.frequency.setTargetAtTime(wf, now, 0.1);
        A.wind.bp2.frequency.setTargetAtTime(wf * 2.4, now, 0.1);
      }

      // 前から倒れてくる列: 低めの カタカタ(1秒に 12 回まで)
      if (sim && sim.rivals && sim.rivals.length) {
        var seen = 0; for (var r = 0; r < sim.rivals.length; r++) if (sim.rivals[r].t0 >= 0) seen++;
        if (seen > A.rivalSeen && soundOn() && now - A.rivalLast > 1 / 12) {
          A.rivalLast = now; stats.rivalClicks++;
          S.clack(ctx, A.ch.sfx, now + 0.005, { f: 392 + rnd() * 60, v: 0.13 });
        }
        if (seen < A.rivalSeen || seen > A.rivalSeen) A.rivalSeen = seen;
      }

      // BGM
      var ms = A.mus;
      if (ms.on && ms.song && musicOn()) {
        if (playing && sim.wave) {
          var cfg = sim.cfg || {}, v0 = cfg.v0 || 4.4, vm = cfg.max || 7;
          var k = sim.wave.started ? clamp((sim.wave.v - v0) / Math.max(0.1, vm - v0), 0, 1) : 0;
          var tempo = 1 + 0.12 * k;
          ms.tempo += (tempo - ms.tempo) * Math.min(1, (dt || 0.016) * 0.8);
          ms.inten = clamp(k * 0.8 + c * 0.4, 0, 1);
        } else { ms.tempo += (1 - ms.tempo) * 0.05; ms.inten *= 0.95; }
        if (ms.next < now - 0.3 || ms.next === 0) ms.next = now + 0.05;             // 止まっていた → 今から
        var s0 = ms.step;
        musicSchedule(ms, ctx, A.ch, now + 0.2);
        stats.steps += ms.step - s0;
        // 音量: プレイ中はふつう、ステージの前・結果は しずか。心臓が鳴っている間は 少し下げる
        if (A.duckUntil && now > A.duckUntil) { A.duck = 1; A.duckUntil = 0; }
        var lv = state === 'play' ? (sim && sim.state === 'run' ? 1 : 0.8) : 0.4;
        setMusicLevel(ms.song.vol * lv * A.duck * (1 - 0.35 * c));
      } else setMusicLevel(0);
      if (A.ch.echoWet) { var ew = (ms.song && ms.song.echo) || 0.12; if (A.ch.__ew !== ew) { A.ch.__ew = ew; A.ch.echoWet.gain.setTargetAtTime(ew, now, 0.3); } }
    } catch (e) { stats.errors++; }
  }

  function setSound(on) {
    var s = settings(); s.sound = !!on;
    if (A.ctx) { A.ch.sfx.gain.setTargetAtTime(on ? 1 : 0, A.ctx.currentTime, 0.03); if (!on) stopWind(); }
  }
  function setMusic(on) {
    var s = settings(); s.music = !!on;
    if (A.ctx && !on) setMusicLevel(0, true);
    if (on && A.mus.song) A.mus.next = 0;
  }

  // ---------- 確認用(スピーカーで鳴らさない): OfflineAudioContext に同じ合成をする ----------
  var offline = {
    names: function () { return Object.keys(S); },
    songs: SONGS,
    // kind: 'sfx'(name, o)/ 'topple'(rate 毎秒の枚数, combo0)/ 'music'(world, tempo, inten)/ 'heart'(c)/ 'mix'(全部いっしょ)
    render: function (kind, o, secs) {
      o = o || {}; secs = secs || 2;
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var oc = new OAC(2, Math.ceil(secs * 44100), 44100), ch = makeChain(oc), info = {};
      seed = 20261027;
      if (kind === 'sfx') S[o.name](oc, ch.sfx, 0.05, o);
      else if (kind === 'topple' || kind === 'mix') {
        var st = { last: 0, clicks: 0, dropped: 0 }, rate = o.rate || 12, combo = o.combo0 || 0, song = SONGS[o.world || 1];
        var acc = 0;
        for (var f = 0; f * (1 / 60) < secs - 0.3; f++) {
          acc += rate / 60; var list = [];
          while (acc >= 1) { acc -= 1; combo++; list.push({ combo: combo, pan: 0 }); }
          if (list.length) toppleBatch(st, oc, ch.sfx, 0.05 + f / 60, list, song);
        }
        info.clicks = st.clicks; info.dropped = st.dropped; info.combo = combo;
        if (kind === 'mix') {
          var ms = { song: song, step: 0, next: 0.05, tempo: 1.12, inten: 1 };
          musicSchedule(ms, oc, ch, secs - 0.2);
          var hs = { next: 0.05, beats: 0 };
          heartSchedule(hs, oc, ch.sfx, 0.05, 1, secs - 0.3);
          S.giant(oc, ch.sfx, 0.6, {}); S.bomb(oc, ch.sfx, 0.3, {}); S.star(oc, ch.sfx, 1.0, {}); S.clear(oc, ch.sfx, 2.2, {});
          info.steps = ms.step; info.beats = hs.beats;
        }
      } else if (kind === 'music') {
        var m = { song: SONGS[o.world || 1], step: 0, next: 0.05, tempo: o.tempo || 1, inten: o.inten || 0 };
        ch.echoWet.gain.value = m.song.echo || 0.12; ch.mus.gain.value = MUS_BASE * m.song.vol;
        musicSchedule(m, oc, ch, secs - 0.5);
        info.steps = m.step;
      } else if (kind === 'heart') {
        var h = { next: 0.05, beats: 0 };
        heartSchedule(h, oc, ch.sfx, 0.05, o.c == null ? 1 : o.c, secs - 0.4);
        info.beats = h.beats;
      }
      return oc.startRendering().then(function (buf) { return { buf: buf, info: info }; });
    }
  };

  return {
    unlock: unlock, stage: stageFn, start: start, stop: stop, pause: pause,
    onEvents: function (l, s) { try { onEvents(l, s); } catch (e) { stats.errors++; } },
    update: update, setSound: setSound, setMusic: setMusic,
    stats: stats, offline: offline,
    info: function () {
      return { state: A.ctx ? A.ctx.state : 'none', world: A.song && A.song.name, musicOn: A.mus.on, tempo: +A.mus.tempo.toFixed(3),
        inten: +A.mus.inten.toFixed(2), musLevel: +A.musLevel.toFixed(3), heartOn: A.heart.next > 0, stats: stats };
    }
  };
})();
