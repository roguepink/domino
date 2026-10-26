/* ui.js — 画面(UI・UX係)。タイトル・ステージ選び・ステージの前・プレイ中の表示・ポーズ・結果・着せかえ・せってい。
 *
 *   DOMINO.UI = { init(game), showMenu(), showIntro(stage, sim), showHud(sim), showPause(), showResult(res, sim),
 *                 onEvents(list, sim), update(sim, state, dt), show(name) }
 *   DOMINO.SKINS = 着せかえ(ここで決める・render3d.js が読む)
 *
 * 画面は #ui の中に ここで作る(index.html には 入れ物だけ)。見た目は css/style.css。
 * ボタンは data-act="なにをするか" を付けておき、1か所でまとめて受ける(押したら blur する)。
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

// ---- 着せかえ(★の合計で手に入る) ----
DOMINO.SKINS = [
  { id: 'classic', name: 'にじいろ', cost: 0, colors: 'rainbow', pip: '#ffffff', look: 'gloss' },
  { id: 'wood', name: '木', cost: 5, colors: ['#d9a273', '#c98b5a', '#b5764a', '#e0b085', '#a8693f'], pip: '#3b2414', look: 'wood' },
  { id: 'pastel', name: 'パステル', cost: 15, colors: ['#ffb3c7', '#ffd9a8', '#fff1a0', '#b8f0c8', '#b3dcff', '#d6c2ff'], pip: '#ffffff', look: 'gloss' },
  { id: 'neon', name: 'ネオン', cost: 30, colors: ['#ff2bd6', '#00f0ff', '#b6ff00', '#ffea00', '#7a5cff'], pip: '#ffffff', look: 'neon' },
  { id: 'gold', name: '金', cost: 60, colors: ['#ffd700', '#f5c542', '#ffe680', '#e8b923'], pip: '#7a5200', look: 'gold' },
  { id: 'glass', name: 'ガラス', cost: 90, colors: ['#bfe9ff', '#d9f7ff', '#cfe0ff', '#e3fff4'], pip: '#ffffff', look: 'glass' },
  { id: 'candy', name: 'おかし', cost: 120, colors: ['#ff8fb1', '#8fd3ff', '#ffe27a', '#a8f0b0', '#c9a3ff'], pip: '#ffffff', look: 'candy' },
  { id: 'sakura', name: 'さくら', cost: 160, colors: ['#ffc0d9', '#ffe4ef', '#ff9fc4', '#fff0f6'], pip: '#e0457b', look: 'gloss' },
  { id: 'night', name: '夜空', cost: 200, colors: ['#1d1b4f', '#2b2a7a', '#3a2f8f', '#232060'], pip: '#ffe680', look: 'gloss' },
  { id: 'sumi', name: 'すみ', cost: 250, colors: ['#1b1b1f', '#26262c', '#303038'], pip: '#ffffff', look: 'gloss' }
];

DOMINO.UI = (function () {
  var G = null, root = null, S = {}, cur = '';
  var R = {};                 // プレイ中の部品
  var run = null;             // プレイ中の 小さな状態(コンボの区切り など)
  var resultTimer = [];

  var REASON = {
    caught: { t: '波に つかまった!', h: 'ジグザグに走ると 列が長くなって、波が おくれるよ' },
    broken: { t: '列が とぎれた!', h: 'ドミノの間が はなれすぎると、波が とどかないよ' },
    empty: { t: 'ドミノが なくなった!', h: '箱や「+」の門で ドミノを ふやそう' },
    fall: { t: '落ちちゃった!', h: '穴は 右がわを タップして ジャンプ!' }
  };
  var REVIVE = { caught: '波を 少し 止める', broken: 'ドミノ +15本で つなぎ直す', empty: 'ドミノ +15本で つなぎ直す', fall: '近くの床に もどる' };

  // ---------- 小さな道具 ----------
  function $(id) { return document.getElementById(id); }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sv() { return DOMINO.Save.data; }
  function stages() { return DOMINO.STAGES || []; }
  function stageById(id) { var a = stages(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function worldNo(st) { return st.world || Math.ceil(st.id / 10); }
  function label(id) { return Math.ceil(id / 10) + '-' + ((id - 1) % 10 + 1); }
  function starStr(n, max) { var s = ''; for (var i = 0; i < (max || 3); i++) s += i < n ? '★' : '☆'; return s; }
  function unlock() { try { if (DOMINO.Audio && DOMINO.Audio.unlock) DOMINO.Audio.unlock(); } catch (e) {} }
  function restart(e, cls) { e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); }
  function clearTimers() { for (var i = 0; i < resultTimer.length; i++) clearTimeout(resultTimer[i]); resultTimer = []; }
  function later(fn, ms) { resultTimer.push(setTimeout(fn, ms)); }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // 「あそぶ」で始める面: まだクリアしていない いちばん先の面(作ってある面だけ)
  function playTarget() {
    var u = DOMINO.Save.unlocked();
    if (stageById(u)) return u;
    return 0;
  }

  // ---------- 画面の切りかえ ----------
  function show(name) {
    for (var k in S) S[k].classList.toggle('on', k === name);
    cur = name;
    root.setAttribute('data-scr', name);
  }

  // ドミノの形のタイル(文字入り)
  function tileHTML(ch, color, cls) {
    return '<span class="tile ' + (cls || '') + '" style="--c:' + color + '"><i class="pip pt"></i><span class="ch">' + ch + '</span><i class="pip pb"></i></span>';
  }
  var RAINBOW = ['#ff5a6a', '#ff9a3c', '#ffd23f', '#5fd068', '#3fb7ff', '#7a6cff', '#ff6ad5'];

  function domikun(cls) {
    return '<span class="domikun ' + (cls || '') + '"><i class="eye l"></i><i class="eye r"></i><i class="mouth"></i><i class="leg l"></i><i class="leg r"></i></span>';
  }

  // ---------- 作る ----------
  function build() {
    root = $('ui'); root.innerHTML = '';

    // プレイ中の表示(ふち・上の表示・文字・指の絵)
    R.edge = h('div', '', ''); R.edge.id = 'edge'; root.appendChild(R.edge);
    var hud = h('div', '', ''); hud.id = 'hud';
    hud.innerHTML =
      '<div class="hrow top">' +
        '<button class="pausebtn" data-act="pause" aria-label="ポーズ"><i></i><i></i></button>' +
        '<div class="prog"><span class="flag s">S</span><span class="flag g">G</span>' +
          '<div class="lane"><div class="track"><div class="fill"></div><div class="wavefill"></div></div>' +
          '<span class="mk wave"><i></i><i></i><i></i></span><span class="mk hero">' + domikun('mini') + '</span></div></div>' +
      '</div>' +
      '<div class="hrow chips">' +
        '<span class="chip stock"><i class="ico dom"></i><b class="v">0</b></span>' +
        '<span class="chip gold"><i class="ico gdom"></i><b class="v">0/3</b></span>' +
        '<span class="chip near"><i class="ico nr">ギリ</i><b class="v">0/3</b></span>' +
        '<span class="score"><b class="v">0</b></span>' +
      '</div>';
    root.appendChild(hud); R.hud = hud;
    R.fill = hud.querySelector('.fill'); R.waveFill = hud.querySelector('.wavefill');
    R.mkWave = hud.querySelector('.mk.wave'); R.mkHero = hud.querySelector('.mk.hero'); R.prog = hud.querySelector('.prog');
    R.stock = hud.querySelector('.chip.stock'); R.stockV = R.stock.querySelector('.v');
    R.gold = hud.querySelector('.chip.gold'); R.goldV = R.gold.querySelector('.v');
    R.near = hud.querySelector('.chip.near'); R.nearV = R.near.querySelector('.v');
    R.scoreV = hud.querySelector('.score .v');
    R.pop = h('div', 'pop', ''); R.pop.id = 'pop'; root.appendChild(R.pop);
    R.combo = h('div', 'combo', ''); R.combo.id = 'combo'; root.appendChild(R.combo);
    R.plus = h('div', '', ''); R.plus.id = 'plus'; root.appendChild(R.plus);
    R.tip = h('div', '', ''); R.tip.id = 'tip';
    R.tip.innerHTML =
      '<div class="half l"><div class="finger swipe">👆</div><div class="arrows">◀ ▶</div><p>左を なぞって<br>左右に うごく</p></div>' +
      '<div class="half r"><div class="finger tap">👆</div><div class="ripple"></div><p>右を タップで<br>ジャンプ</p></div>';
    root.appendChild(R.tip);

    // それぞれの画面
    S.title = scr('title'); S.stages = scr('stages'); S.intro = scr('intro'); S.pause = scr('pause');
    S.replay = scr('replay'); S.result = scr('result'); S.skins = scr('skins'); S.settings = scr('settings'); S.hud = scr('hudscr');
    R.toast = h('div', '', ''); R.toast.id = 'toast'; root.appendChild(R.toast);

    buildTitle();
  }
  function scr(name) { var e = h('div', 'scr s-' + name, ''); root.appendChild(e); return e; }

  // ---------- タイトル ----------
  function buildTitle() {
    var a = 'ドミノ'.split(''), b = 'ラッシュ'.split(''), l1 = '', l2 = '', i;
    for (i = 0; i < a.length; i++) l1 += tileHTML(a[i], RAINBOW[i], 'd' + i);
    for (i = 0; i < b.length; i++) l2 += tileHTML(b[i], RAINBOW[i + 3], 'd' + (i + 3));
    var row = '';
    for (i = 0; i < 16; i++) row += '<i style="--i:' + i + ';--c:' + RAINBOW[i % RAINBOW.length] + '"></i>';
    S.title.innerHTML =
      '<div class="sky"><i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i></div>' +
      '<div class="tbody">' +
        '<div class="logo"><div class="lrow">' + l1 + '</div><div class="lrow">' + l2 + '</div></div>' +
        '<div class="hero-wrap">' + domikun('run') + '<span class="sweat">💦</span></div>' +
        '<div class="tctl"><button class="btn big play" data-act="play"><span class="t">▶ あそぶ</span><span class="sub" id="tPlaySub"></span></button>' +
        '<div class="trow">' +
          '<button class="btn round" data-act="stages"><span class="ic">🗺️</span><span>ステージ</span></button>' +
          '<button class="btn round" data-act="skins"><span class="ic">🎨</span><span>きせかえ</span></button>' +
          '<button class="btn round" data-act="settings"><span class="ic">⚙️</span><span>せってい</span></button>' +
        '</div>' +
        '<div class="tstars" id="tStars"></div></div>' +
      '</div>' +
      '<div class="ground">' + row + '</div>';
  }
  function refreshTitle() {
    var t = playTarget(), sub = $('tPlaySub');
    sub.textContent = t ? ('ステージ ' + label(t) + (t === 1 && !sv().stars[1] ? ' から' : ' から つづき')) : 'つぎの面は じゅんび中';
    $('tStars').innerHTML = '<span class="st">★</span> ' + DOMINO.Save.totalStars();
  }

  // ---------- ステージ選び ----------
  var NODE_X = [50, 72, 80, 64, 40, 22, 28, 50, 72, 50];
  function buildStages() {
    var W = Math.min(root.clientWidth || window.innerWidth, 560);
    var unlocked = DOMINO.Save.unlocked(), target = playTarget();
    var html = '<div class="bar"><button class="btn back" data-act="menu">◀ もどる</button><b>ステージ</b>' +
      '<span class="bstars"><span class="st">★</span> ' + DOMINO.Save.totalStars() + '</span></div><div class="scroll" id="stScroll"><div class="map" style="max-width:' + W + 'px">';
    var STEP = 84, TOP = 172;
    for (var w = 0; w < DOMINO.WORLDS.length; w++) {
      var WD = DOMINO.WORLDS[w], wsum = 0, nodes = '', pts = [];
      for (var n = 0; n < 10; n++) {
        var id = w * 10 + n + 1, st = stageById(id), stars = sv().stars[id] || 0;
        wsum += stars;
        var x = NODE_X[n] / 100 * W, y = TOP + n * STEP;
        pts.push(Math.round(x) + ',' + Math.round(y));
        var cls = 'node' + (n === 9 ? ' boss' : '');
        var inner;
        if (!st) { cls += ' none'; inner = '<span class="num">' + (n + 1) + '</span>'; }
        else if (id > unlocked) { cls += ' lock'; inner = '<span class="lk">🔒</span>'; }
        else { inner = '<span class="num">' + (n + 1) + '</span>'; if (id === target) cls += ' now'; if (sv().skipped[id] && !stars) cls += ' skipped'; }
        nodes += '<button class="' + cls + '" style="left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;--c:' + WD.accent + '" data-act="stage" data-id="' + id + '"' + (st && id <= unlocked ? '' : ' disabled') + '>' +
          '<span class="face">' + inner + '</span>' +
          (st && id <= unlocked ? '<span class="nst">' + starStr(stars) + '</span>' : '') +
          (id === target ? '<span class="here">' + domikun('mini') + '</span>' : '') +
          '</button>';
      }
      var hgt = TOP + 9 * STEP + 70;
      var made = 0; for (var q = 1; q <= 10; q++) if (stageById(w * 10 + q)) made++;
      html += '<section class="world' + (WD.dark ? ' dark' : '') + '" style="height:' + hgt + 'px;--sky:' + WD.sky + ';--sky2:' + WD.sky2 + ';--fl:' + WD.floor + ';--fl2:' + WD.floor2 + ';--ac:' + WD.accent + ';--wl:' + WD.wall + '">' +
        '<div class="whead"><span class="wno">ワールド ' + WD.id + '</span><b class="wname">' + esc(WD.name) + '</b>' +
        '<span class="wst"><span class="st">★</span> ' + wsum + ' / 30</span>' +
        (made === 0 ? '<span class="wsoon">じゅんび中</span>' : '') + '</div>' +
        '<svg class="road" width="' + W + '" height="' + hgt + '"><polyline class="r1" points="' + pts.join(' ') + '"/><polyline class="r2" points="' + pts.join(' ') + '"/></svg>' +
        nodes + '</section>';
    }
    html += '<div class="mapend">つづきは じゅんび中…</div></div></div>';
    S.stages.innerHTML = html;
  }
  function openStages(focusId) {
    buildStages();
    show('stages');
    var sc = $('stScroll'), id = focusId || playTarget() || 1;
    var node = S.stages.querySelector('.node[data-id="' + id + '"]');
    if (sc && node) {
      var sec = node.parentNode;
      sc.scrollTop = Math.max(0, sec.offsetTop + node.offsetTop - sc.clientHeight * 0.5);
    }
  }

  // ---------- ステージの前 ----------
  function showIntro(st, sim) {
    clearTimers();
    hideHud();
    var WD = DOMINO.worldOf(st), best = sv().best[st.id] || 0, got = sv().stars[st.id] || 0;
    var gold = sim ? sim.starsTotal : 3, near = sim ? sim.cfg.nearGoal : 3;
    S.intro.style.setProperty('--ac', WD.accent);
    S.intro.innerHTML =
      '<button class="btn back small" data-act="stagesFromIntro">◀ ステージ選び</button>' +
      '<div class="icard">' +
        '<div class="iw">ワールド ' + WD.id + ' ・ ' + esc(WD.name) + '</div>' +
        '<div class="ino">' + tileHTML(label(st.id), WD.accent, 'big') + '</div>' +
        '<div class="iname">' + esc(st.name || '') + '</div>' +
        (got ? '<div class="ibest"><span class="st">' + starStr(got) + '</span>  さいこう ' + fmt(best) + ' 点</div>' : '') +
        '<ul class="conds">' +
          '<li><span class="st">★</span> ゴールまで にげきる</li>' +
          (gold > 0 ? '<li><span class="st">★</span> 金のドミノを ' + gold + 'つ とる</li>' : '<li class="off"><span class="st">★</span> (金のドミノは ない面)</li>') +
          '<li><span class="st">★</span> ギリギリ を ' + near + '回</li>' +
        '</ul>' +
        (st.tip ? '<div class="itip"><span class="new">NEW</span>' + esc(st.tip) + '</div>' : '') +
      '</div>' +
      '<div class="tapgo"><span class="tf">👆</span> タップで スタート</div>';
    show('intro');
  }
  function startFromIntro(e) {
    if (!G || G.state !== 'intro') return;
    if (e && e.target && e.target.closest && e.target.closest('[data-act]')) return;
    unlock();
    G.go();
  }

  // ---------- プレイ中 ----------
  function hideHud() { R.hud.classList.remove('on'); R.edge.style.opacity = 0; R.tip.className = ''; }
  function showHud(sim) {
    clearTimers();
    show('hud');
    R.hud.classList.add('on');
    if (!run || run.sim !== sim) {
      run = { sim: sim, combo: 0, milestone: 0, score: 0, tipT: -1, lastStock: sim.stock };
      R.pop.className = 'pop'; R.combo.className = 'combo';
      var st = sim.stage;
      if (st && st.id === 1 && !(sv().seenTips || {})[1]) run.tipT = 0;
    }
    R.tip.className = run.tipT >= 0 ? 'on' : '';
  }
  function pop(text, kind) {
    R.pop.textContent = text;
    R.pop.className = 'pop ' + (kind || '');
    restart(R.pop, 'go');
  }
  function plus(text, kind) {
    var e = h('span', 'pl ' + (kind || ''), esc(text));
    R.plus.appendChild(e);
    setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 900);
  }
  var MILES = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000];
  function onEvents(list, sim) {
    if (!run || G.state !== 'play') return;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      switch (e.type) {
        case 'topple':
          if (e.combo < run.combo) run.milestone = 0;
          run.combo = e.combo;
          var m = 0; for (var k = 0; k < MILES.length; k++) if (e.combo >= MILES[k]) m = MILES[k];
          if (m > run.milestone) {
            run.milestone = m;
            R.combo.innerHTML = '<b>' + m + '</b><span>コンボ!</span>';
            R.combo.className = 'combo' + (m >= 500 ? ' mega' : m >= 200 ? ' big' : '');
            restart(R.combo, 'go');
          }
          break;
        case 'near': pop('ギリギリ!', 'near'); break;
        case 'opgate':
          var t = e.op === '+' ? '+' + e.n : e.op === 'x' ? '×' + e.n : '−' + e.n;
          pop(t, e.op === '-' ? 'bad' : 'good'); break;
        case 'bridge': pop('橋ドミノ!', 'good'); break;
        case 'bigfall': pop('ドーン!', 'boom'); break;
        case 'split': pop('2列!', 'good'); break;
        case 'gate': pop('門が ひらいた!', 'info'); break;
        case 'pick':
          if (e.item.t === 'star') pop('金のドミノ ' + sim.stars + '/' + sim.starsTotal, 'gold');
          else if (e.item.t === 'box' || e.item.t === 'bigbox') { plus('+' + e.item.n, 'good'); restart(R.stock, 'bump'); }
          break;
        case 'low': pop('ドミノが のこり わずか!', 'bad'); break;
        case 'empty': pop('ドミノ切れ!', 'bad'); break;
        case 'goal': pop('ゴール!', 'gold'); break;
        case 'revive': pop('お助け!', 'info'); break;
      }
    }
  }
  function waveProgress(sim) {
    if (!sim.wave || !sim.wave.started) return -1;
    var bi = -1;
    for (var i = 0; i < sim.fronts.length; i++) if (!sim.fronts[i].dead && sim.fronts[i].i > bi) bi = sim.fronts[i].i;
    if (bi < 0 || !sim.doms[bi]) return -1;
    var L = sim.level;
    return Math.max(0, Math.min(1, (sim.doms[bi].z - L.start.z) / Math.max(1, (L.goalZ + 0.5 - L.start.z))));
  }
  function update(sim, state, dt) {
    if (!run || run.sim !== sim) return;
    if (state !== 'play' && state !== 'paused') return;
    // 進み具合
    var p = sim.progress, wp = waveProgress(sim);
    R.fill.style.width = (p * 100).toFixed(1) + '%';
    R.mkHero.style.left = (p * 100).toFixed(1) + '%';
    if (wp >= 0) { R.mkWave.style.display = ''; R.mkWave.style.left = (wp * 100).toFixed(1) + '%'; R.waveFill.style.width = (wp * 100).toFixed(1) + '%'; }
    else { R.mkWave.style.display = 'none'; R.waveFill.style.width = '0'; }
    var d = sim.danger, run2 = sim.state === 'run';
    var k = run2 && d < 2.5 ? Math.max(0, Math.min(1, (2.5 - d) / 2.1)) : 0;
    R.edge.style.opacity = k.toFixed(2);
    R.edge.classList.toggle('beat', k > 0.45);
    R.prog.classList.toggle('danger', k > 0);
    // ドミノの残り
    if (sim.stock !== run.lastStock) { R.stockV.textContent = sim.stock; run.lastStock = sim.stock; }
    R.stock.classList.toggle('low', sim.stock <= 10);
    R.goldV.textContent = sim.stars + '/' + sim.starsTotal;
    R.gold.classList.toggle('done', sim.starsTotal > 0 && sim.stars >= sim.starsTotal);
    R.gold.style.display = sim.starsTotal > 0 ? '' : 'none';
    R.nearV.textContent = Math.min(sim.nearCount, sim.cfg.nearGoal) + '/' + sim.cfg.nearGoal;
    R.near.classList.toggle('done', sim.nearCount >= sim.cfg.nearGoal);
    // 点(すっと 追いつく)
    run.score += (sim.score - run.score) * Math.min(1, dt * 10);
    if (Math.abs(sim.score - run.score) < 1) run.score = sim.score;
    R.scoreV.textContent = fmt(run.score);
    // 1面目の 指の絵
    if (run.tipT >= 0 && state === 'play') {
      run.tipT += dt;
      if (run.tipT > 5.5) {
        run.tipT = -1; R.tip.className = 'off';
        sv().seenTips = sv().seenTips || {}; sv().seenTips[1] = true; DOMINO.Save.write();
      }
    }
  }

  // ---------- ポーズ ----------
  function showPause() {
    clearTimers();
    var st = sv().settings;
    S.pause.innerHTML =
      '<div class="card">' +
        '<h2>ひとやすみ</h2>' +
        '<button class="btn big" data-act="resume">▶ つづける</button>' +
        '<button class="btn mid" data-act="retry">↻ やり直す</button>' +
        '<button class="btn mid ghost" data-act="stagesFromPause">ステージ選び</button>' +
        '<div class="toggles">' + toggleHTML('sound', '効果音', st.sound) + toggleHTML('music', 'BGM', st.music) + '</div>' +
      '</div>';
    show('pause');
  }
  function toggleHTML(key, name, on) {
    return '<button class="tg' + (on ? ' on' : '') + '" data-act="toggle" data-key="' + key + '"><span class="tn">' + name + '</span><span class="sw"><i></i></span><span class="tv">' + (on ? 'オン' : 'オフ') + '</span></button>';
  }

  // ---------- 結果 ----------
  function showResult(res, sim) {
    clearTimers();
    hideHud();
    if (!res.clear) { showFail(res); return; }
    // まず 空からのリプレイ(あれば)
    var Rd = DOMINO.Render, done = false;
    var go = function () { if (done) return; done = true; if (Rd && Rd.stopReplay) try { Rd.stopReplay(); } catch (e) {} showClear(res); };
    if (Rd && typeof Rd.replay === 'function' && Rd.replay.length > 0) {
      S.replay.innerHTML = '<div class="rtag">🎥 リプレイ</div><button class="btn skip" data-act="skipReplay">とばす ▶▶</button>';
      S.replay._go = go;
      show('replay');
      later(go, 15000);   // 念のため(リプレイが 終わりを知らせなくても 先へ)
      try { Rd.replay(go); } catch (e) { go(); }
    } else go();
  }
  function newSkins(res) {
    // 今回ふえた★で 手に入った着せかえ
    var after = DOMINO.Save.totalStars(), before = after - Math.max(0, res.stars - res.prevStars), got = [];
    for (var i = 0; i < DOMINO.SKINS.length; i++) {
      var k = DOMINO.SKINS[i];
      if (k.cost > before && k.cost <= after) got.push(k);
      if (k.cost <= after) sv().skins[k.id] = true;
    }
    DOMINO.Save.write();
    return got;
  }
  function showClear(res) {
    var st = res.stage, nextOk = stageExistsAfter(st);
    var c1 = true, c2 = res.goldTotal > 0 && res.goldGot >= res.goldTotal, c3 = res.near >= res.nearGoal;
    var conds = [c1, c2, c3];
    var got = newSkins(res);
    S.result.className = 'scr s-result clear';
    S.result.innerHTML =
      '<div class="card">' +
        '<div class="rlabel">ステージ ' + label(st.id) + '</div>' +
        '<h2 class="rtitle">クリア!</h2>' +
        '<div class="rstars">' +
          starSlot(0, conds[0], 'クリア') +
          starSlot(1, conds[1], res.goldTotal > 0 ? '金 ' + res.goldGot + '/' + res.goldTotal : '金 なし') +
          starSlot(2, conds[2], 'ギリ ' + Math.min(res.near, res.nearGoal) + '/' + res.nearGoal) +
        '</div>' +
        '<div class="rscore"><span id="rScore">0</span><small> 点</small></div>' +
        '<div class="rrec">' + (res.newRecord ? '<span class="newrec">新記録!</span>' : 'さいこう ' + fmt(res.best) + ' 点') + '</div>' +
        '<div class="rstat"><span>倒した ドミノ <b>' + res.dominoes + '</b></span></div>' +
        (got.length ? '<div class="rskin">🎨 きせかえ「' + esc(got[got.length - 1].name) + '」が 手に入った!</div>' : '') +
        (nextOk ? '<button class="btn big next" data-act="next">つぎへ ▶</button>' :
          '<div class="rsoon">つぎの面は じゅんび中です</div><button class="btn big next" data-act="stagesFromResult">ステージ選び</button>') +
        '<div class="rrow"><button class="btn mid" data-act="retry">↻ もう1回</button>' +
          (nextOk ? '<button class="btn mid ghost" data-act="stagesFromResult">ステージ選び</button>' : '') + '</div>' +
      '</div>';
    show('result');
    // ★を1つずつ
    var slots = S.result.querySelectorAll('.slot');
    for (var i = 0; i < 3; i++) (function (i) { if (conds[i]) later(function () { slots[i].classList.add('got'); }, 350 + i * 380); })(i);
    // 点が ぐんぐん ふえる
    var el = $('rScore'), t0 = Date.now(), target = res.score;
    (function tick() {
      var u = Math.min(1, (Date.now() - t0) / 900); u = 1 - Math.pow(1 - u, 3);
      el.textContent = fmt(target * u);
      if (u < 1 && cur === 'result') resultTimer.push(setTimeout(tick, 33));
    })();
  }
  function starSlot(i, on, cap) {
    return '<div class="slot s' + i + (on ? ' will' : '') + '"><span class="big">★</span><span class="cap">' + esc(cap) + '</span></div>';
  }
  function stageExistsAfter(st) { var a = stages(), i = a.indexOf(st); return i >= 0 && i < a.length - 1; }

  function showFail(res) {
    var r = REASON[res.reason] || { t: 'ざんねん!', h: '' }, pct = Math.round((res.progress || 0) * 100);
    var left = 100 - pct;
    S.result.className = 'scr s-result fail';
    S.result.innerHTML =
      '<div class="card">' +
        '<div class="rlabel">ステージ ' + label(res.stage.id) + '</div>' +
        '<h2 class="rtitle">' + r.t + '</h2>' +
        '<div class="fprog"><div class="ftrack"><div class="ffill" style="width:' + pct + '%"></div><span class="fhero" style="left:' + pct + '%">' + domikun('mini sad') + '</span></div>' +
          '<span class="fg">G</span></div>' +
        '<div class="fmsg">' + (pct >= 85 ? 'あと すこし!' : 'ゴールまで あと ' + left + '%') + '</div>' +
        (r.h ? '<div class="fhint">💡 ' + r.h + '</div>' : '') +
        '<button class="btn huge" data-act="retry">↻ もう1回</button>' +
        (res.canRevive ? '<button class="btn mid help" data-act="revive"><span>🛟 お助け</span><small>' + (REVIVE[res.reason] || 'つづきから') + '</small></button>' : '') +
        (res.canSkip ? '<button class="btn mid ghost" data-act="skip">この面を とばす ▶▶</button>' : '') +
        '<button class="btn link" data-act="stagesFromResult">ステージ選び</button>' +
      '</div>';
    show('result');
  }

  // ---------- 着せかえ ----------
  function skinColors(k, n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(k.colors === 'rainbow' ? 'hsl(' + Math.round(i * 360 / n) + ',85%,58%)' : k.colors[i % k.colors.length]);
    return a;
  }
  function openSkins() {
    var total = DOMINO.Save.totalStars(), html = '';
    for (var i = 0; i < DOMINO.SKINS.length; i++) {
      var k = DOMINO.SKINS[i], have = total >= k.cost, on = sv().skin === k.id, cols = skinColors(k, 5), row = '';
      if (have) sv().skins[k.id] = true;
      for (var j = 0; j < 5; j++) row += '<i style="--c:' + cols[j] + ';--p:' + k.pip + '"></i>';
      html += '<button class="skin look-' + k.look + (have ? '' : ' lock') + (on ? ' on' : '') + '" data-act="skin" data-id="' + k.id + '"' + (have ? '' : ' disabled') + '>' +
        '<span class="sprev">' + row + '</span><span class="sname">' + esc(k.name) + '</span>' +
        '<span class="sstate">' + (on ? '✔ つかっている' : have ? 'えらぶ' : '🔒 ★' + k.cost + 'で 手に入る') + '</span></button>';
    }
    S.skins.innerHTML = '<div class="bar"><button class="btn back" data-act="menu">◀ もどる</button><b>きせかえ</b><span class="bstars"><span class="st">★</span> ' + total + '</span></div>' +
      '<div class="scroll pad"><p class="lead">★を 集めると、ドミノの いろ・もようが 手に入るよ</p><div class="skins">' + html + '</div></div>';
    show('skins');
  }

  // ---------- せってい ----------
  var resetStep = 0;
  function openSettings() {
    var st = sv().settings;
    S.settings.innerHTML = '<div class="bar"><button class="btn back" data-act="menu">◀ もどる</button><b>せってい</b><span></span></div>' +
      '<div class="scroll pad"><div class="list">' +
        toggleHTML('sound', '効果音', st.sound) + toggleHTML('music', 'BGM', st.music) + toggleHTML('shake', '画面の ゆれ', st.shake) +
      '</div>' +
      '<div class="danger-zone" id="resetZone">' + resetHTML() + '</div>' +
      '<p class="ver">ドミノ ラッシュ ・ 広告なし ・ 登録なし</p></div>';
    show('settings');
  }
  function resetHTML() {
    if (resetStep === 0) return '<button class="btn mid ghost red" data-act="reset1">データを 消す</button>';
    if (resetStep === 1) return '<p>★・クリア・きせかえが ぜんぶ 消えます。いいですか?</p><div class="rrow"><button class="btn mid red" data-act="reset2">消す</button><button class="btn mid" data-act="resetNo">やめる</button></div>';
    return '<p><b>本当に 消しますか?</b> もとに もどせません。</p><div class="rrow"><button class="btn mid red" data-act="reset3">本当に 消す</button><button class="btn mid" data-act="resetNo">やめる</button></div>';
  }
  function setToggle(key) {
    var st = sv().settings; st[key] = !st[key]; DOMINO.Save.write();
    var A = DOMINO.Audio;
    try {
      if (key === 'sound' && A && A.setSound) A.setSound(st.sound);
      if (key === 'music' && A && A.setMusic) A.setMusic(st.music);
    } catch (e) {}
    var bs = root.querySelectorAll('.tg[data-key="' + key + '"]');
    for (var i = 0; i < bs.length; i++) { bs[i].classList.toggle('on', st[key]); bs[i].querySelector('.tv').textContent = st[key] ? 'オン' : 'オフ'; }
  }

  function toast(text) {
    R.toast.textContent = text; restart(R.toast, 'go');
  }

  function goFull() {
    // スマホ(Android)は 最初のタップで 全画面にする(iPhone はできない。断られても そのまま)
    try {
      if (!(window.matchMedia && matchMedia('(pointer:coarse)').matches)) return;
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      var d = document.documentElement, fs = d.requestFullscreen || d.webkitRequestFullscreen;
      var pr = fs && fs.call(d); if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
  }

  // ---------- ボタンを まとめて受ける ----------
  function act(name, b, e) {
    unlock();
    switch (name) {
      case 'play': goFull(); var t = playTarget(); if (t) G.play(t); else { openStages(); toast('つぎの面は じゅんび中です'); } break;
      case 'stages': openStages(); break;
      case 'skins': openSkins(); break;
      case 'settings': resetStep = 0; openSettings(); break;
      case 'menu': G.toMenu(); break;
      case 'stage': goFull(); G.play(+b.getAttribute('data-id')); break;
      case 'stagesFromIntro': case 'stagesFromPause': case 'stagesFromResult':
        var id = G.stageId; G.toMenu(); openStages(id); break;
      case 'pause': G.pause(); break;
      case 'resume': G.resume(); break;
      case 'retry': G.retry(); break;
      case 'next': G.next(); break;
      case 'revive': G.revive(); break;
      case 'skip': G.skip(); break;
      case 'skipReplay': if (S.replay._go) S.replay._go(); break;
      case 'toggle': setToggle(b.getAttribute('data-key')); break;
      case 'skin': sv().skin = b.getAttribute('data-id'); DOMINO.Save.write(); openSkins(); break;
      case 'reset1': resetStep = 1; $('resetZone').innerHTML = resetHTML(); break;
      case 'reset2': resetStep = 2; $('resetZone').innerHTML = resetHTML(); break;
      case 'reset3': resetStep = 0; DOMINO.Save.reset(); openSettings(); toast('データを 消しました'); break;
      case 'resetNo': resetStep = 0; $('resetZone').innerHTML = resetHTML(); break;
    }
  }

  function init(game) {
    G = game;
    build();
    root.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || b.disabled) return;
      e.preventDefault();
      try { b.blur(); } catch (er) {}
      act(b.getAttribute('data-act'), b, e);
    });
    // ステージの前: 画面のどこでも タップで スタート(さわった瞬間に 音の準備)
    S.intro.addEventListener('pointerdown', function () { unlock(); });
    S.intro.addEventListener('touchstart', function () { unlock(); }, { passive: true });
    S.intro.addEventListener('click', startFromIntro);
    // パソコン: スペース・Enter で スタート / 結果で つぎへ・もう1回
    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (G.state === 'intro' && cur === 'intro') { unlock(); G.go(); e.preventDefault(); }
      else if (G.state === 'result' && cur === 'result' && G.lastResult) {
        e.preventDefault();
        if (G.lastResult.clear) { if (stageExistsAfter(G.lastResult.stage)) G.next(); } else G.retry();
      }
    });
    // 音の設定を 音係に伝える
    try {
      var A = DOMINO.Audio, st = sv().settings;
      if (A && A.setSound) A.setSound(st.sound);
      if (A && A.setMusic) A.setMusic(st.music);
    } catch (e) {}
    window.addEventListener('resize', function () { if (cur === 'stages') { var sc = $('stScroll'), top = sc ? sc.scrollTop : 0; buildStages(); var s2 = $('stScroll'); if (s2) s2.scrollTop = top; } });
  }

  return {
    init: init, show: show,
    showMenu: function () { clearTimers(); hideHud(); run = null; refreshTitle(); show('title'); },
    showIntro: showIntro, showHud: showHud, showPause: showPause, showResult: showResult,
    onEvents: onEvents, update: update,
    openStages: openStages, openSkins: openSkins, openSettings: openSettings
  };
})();
