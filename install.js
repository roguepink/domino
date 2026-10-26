/* install.js — Google Play 風の「はじめの画面」(インストールして遊ぶ / このまま遊ぶ)
 * ROGUE PINK のアプリ・ゲーム共通(2026-10-26 ノブさんの依頼)。この1ファイルだけで動く(ほかの部品・ライブラリなし)。
 * 古い iPhone でも動くように、昔ながらの書き方(var・function)だけで書いてある。
 *
 * 使い方: index.html の </body> の前に
 *   <script>window.INSTALL_GATE = { id:'sokai', name:'爽快ゾンビ無双', icon:'icon-192.png',
 *     tagline:'3Dの ゾンビ無双アクション', desc:'…', points:['…','…'], shots:['shots/1.jpg','shots/2.jpg'],
 *     badges:['無料','広告なし','登録なし'], color:'#ff5a1f', onPlay: function(){} };  (← script タグの中に書く)
 *   そのあとに install.js を script タグ(src="install.js")で読む
 *
 * - 英語のアプリは lang:'en' を足す(はじめの画面の文字・案内が英語になる)。書かなければ 日本語(今までどおり)
 * - shield:true を足すと、はじめの画面・案内にふれても うしろのアプリに伝えない(「このまま…」のボタンだけは伝える)。
 *   画面のどこにふれても反応するアプリ(一灯・ひとくべ など「ふれると灯る」もの)用。書かなければ 今までどおり
 * - laterLabel:'あとで(このまま見る)' で、案内の「あとで(このまま遊ぶ)」の文字を変えられる(書かなければ playLabel から作る)
 * - installLabel:'📲 ホーム画面に入れる' で、インストールのボタンの文字を変えられる
 * - large:true で、字を大きく・ボタンをたてに並べる(お年寄り向けのアプリ)
 * - color が明るい色(黄色など)のときは、ボタンの字を自動で黒にする
 * - ホーム画面から開いたとき(インストール済み)は 出さない
 * - アドレスに #play / #auto / #noinstall があるときも出さない(確認用)
 * - Android の Chrome: 本物のインストール画面を出す(1回押すだけ)
 * - iPhone: 「共有 → ホーム画面に追加」を 絵で案内する(Apple の決まりで ボタン1つでは入れられない)
 * - LINE の中: Safari / Chrome で開きなおす(LINE の中からは入れられない)
 */
(function () {
  'use strict';
  var C = window.INSTALL_GATE || {};
  var ID = C.id || location.pathname.split('/')[1] || 'app';
  var KEY = 'ig-' + ID + '-hide';
  var ua = navigator.userAgent || '';
  var isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !/iPhone/.test(ua));
  var isIOS = /iPhone|iPod/.test(ua) || isIPad;
  var isAndroid = /Android/.test(ua);
  var isLine = / Line\//i.test(ua);
  var isInApp = isLine || /FBAN|FBAV|Instagram|Twitter/i.test(ua);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) || navigator.standalone === true;
  var hash = location.hash || '';
  var deferred = null;
  var EN = C.lang === 'en';   // 英語のアプリ(2026-10-26 one candle のために足した。日本語のときは今までと同じ)

  // Chrome が「インストールできます」と知らせてきたら、取っておく(ボタンを押したときに出す)
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    var b = document.getElementById('igInstall'); if (b) b.classList.add('ig-ready');
  });
  window.addEventListener('appinstalled', function () { deferred = null; showDone(); });

  function hidden() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  if (standalone || /play|auto|noinstall/.test(hash) || hidden()) return;

  // shield: はじめの画面・案内にふれても、うしろのアプリ(window で pointerup などを見ているもの)に伝えない。
  // 「このまま…」のボタン(igPlay / igHelpPlay)だけは伝える → そのタップで アプリが始まり、iPhone でも音を出せる
  if (C.shield) {
    ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'mousedown', 'mouseup'].forEach(function (t) {
      document.addEventListener(t, function (e) {
        var el = e.target;
        if (el && el.closest && el.closest('#igGate, #igHelp') && !el.closest('#igPlay, #igHelpPlay')) e.stopPropagation();
      });
    });
  }

  // ---------- 見た目 ----------
  var col = C.color || '#ff2e88';
  // ボタンの字の色: 背景(color)が明るいときは黒、暗いときは白(黄色などでも読めるように)
  var onCol = (function () {
    var m = /^#?([0-9a-f]{6})$/i.exec(col); if (!m) return '#fff';
    var n = parseInt(m[1], 16), r = n >> 16 & 255, g2 = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g2 + 0.114 * b) > 170 ? '#1a1300' : '#fff';
  })();
  var FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo","Noto Sans JP",system-ui,sans-serif';
  var css = '' +
    '#igGate{position:fixed;inset:0;z-index:2147483000;background:#0d0a16;color:#fff;text-align:left;line-height:1.5;letter-spacing:normal;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
    'font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo","Noto Sans JP",system-ui,sans-serif;' +
    'padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));' +
    '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}' +
    '#igGate *{box-sizing:border-box}' +
    '.ig-wrap{max-width:560px;margin:0 auto}' +
    '.ig-head{display:flex;gap:14px;align-items:center}' +
    '.ig-icon{width:76px;height:76px;border-radius:18px;flex:none;box-shadow:0 4px 18px rgba(0,0,0,.5);background:#222;object-fit:cover}' +
    '.ig-name{margin:0;font-size:22px;font-weight:900;line-height:1.25;color:#fff;font-family:inherit;text-shadow:none;letter-spacing:normal;text-align:left}' +
    '.ig-dev{margin:2px 0 0;font-size:13px;color:' + col + ';font-weight:700}' +
    '.ig-tag{margin:2px 0 0;font-size:12px;opacity:.75}' +
    '.ig-badges{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 0}' +
    '.ig-badges span{font-size:12px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18)}' +
    '.ig-btns{display:flex;gap:10px;margin:16px 0 0}' +
    '.ig-btn{flex:1;font:inherit;font-size:17px;font-weight:900;padding:14px 8px;border-radius:999px;border:0;cursor:pointer;touch-action:manipulation;white-space:nowrap;margin:0;line-height:1.3}' +
    '.ig-main{background:' + col + ';color:' + onCol + ';box-shadow:0 6px 22px ' + col + '66}' +
    '.ig-sub{background:rgba(255,255,255,.12);color:#fff;border:2px solid rgba(255,255,255,.35)}' +
    '.ig-btn:active{transform:scale(.97)}' +
    '.ig-note{margin:8px 0 0;font-size:11.5px;opacity:.65;text-align:center;line-height:1.6}' +
    '.ig-shots{display:flex;gap:8px;overflow-x:auto;margin:16px -16px 0;padding:0 16px 6px;scroll-snap-type:x mandatory;scroll-padding:0 16px}' +
    '.ig-shots img{height:150px;border-radius:10px;flex:none;scroll-snap-align:start;background:#222}' +
    '.ig-desc{margin:14px 0 0;font-size:14px;line-height:1.75;opacity:.9}' +
    '.ig-points{margin:10px 0 0;padding:0;list-style:none}' +
    '.ig-points li{position:relative;padding-left:16px;margin:4px 0;font-size:13px;line-height:1.6;opacity:.85}' +
    '.ig-points li:before{content:"";position:absolute;left:3px;top:.65em;width:6px;height:6px;border-radius:50%;background:' + col + '}' +
    '.ig-foot{margin:14px 0 0;text-align:center}' +
    '.ig-foot button{font:inherit;font-size:12px;background:none;border:0;color:rgba(255,255,255,.5);text-decoration:underline;padding:8px;cursor:pointer}' +
    /* 案内(iPhone / Android / LINE) */
    '#igHelp{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:' + FONT + ';line-height:1.5;letter-spacing:normal}' +
    '#igHelp *{box-sizing:border-box}' +
    '.ig-card{background:#1b1726;border:1px solid rgba(255,255,255,.15);border-radius:20px;max-width:420px;width:100%;padding:20px;text-align:center}' +
    '.ig-card h3{margin:0 0 12px;font-size:19px;color:#fff}' +
    '.ig-step{display:flex;gap:10px;align-items:center;text-align:left;margin:10px 0;font-size:15px;line-height:1.5}' +
    '.ig-num{width:28px;height:28px;border-radius:50%;background:' + col + ';flex:none;display:flex;align-items:center;justify-content:center;font-weight:900;color:' + onCol + '}' +
    '.ig-ico{display:inline-block;vertical-align:middle;width:22px;height:22px;margin:0 2px}' +
    '.ig-arrow{position:fixed;left:50%;bottom:max(8px,env(safe-area-inset-bottom));transform:translateX(-50%);font-size:40px;animation:igBob 1s ease-in-out infinite;z-index:2147483002}' +
    '.ig-arrow.top{bottom:auto;top:8px;left:auto;right:16px;transform:none}' +
    '@keyframes igBob{50%{margin-bottom:12px;margin-top:12px}}' +
    /* 横向きの低い画面(ゲーム)では、写真を小さく */
    '@media (max-height:460px) and (orientation:landscape){.ig-shots img{height:110px}.ig-icon{width:60px;height:60px}.ig-name{font-size:19px}.ig-wrap{max-width:640px}}' +
    '@media (max-width:359px){.ig-btn{font-size:15px}.ig-name{font-size:19px}.ig-btns{flex-direction:column}}' +
    '.ig-card .ig-btns{flex-wrap:wrap}.ig-card .ig-btn{min-width:150px}' +
    /* large: お年寄り向け(字を大きく・ボタンをたてに) */
    '.ig-large .ig-name{font-size:26px}.ig-large .ig-dev,.ig-large .ig-tag{font-size:16px}.ig-large .ig-badges span{font-size:15px;padding:6px 12px}' +
    '.ig-large .ig-btns{flex-direction:column;gap:12px}.ig-large .ig-btn{font-size:21px;padding:17px 10px}' +
    '.ig-large .ig-note{font-size:15px;opacity:.85}.ig-large .ig-desc{font-size:18px;line-height:1.8}.ig-large .ig-points li{font-size:17px;opacity:.95}' +
    '.ig-large .ig-foot button{font-size:15px}.ig-large .ig-shots img{height:190px}' +
    '@media (max-width:359px){.ig-large .ig-name{font-size:21px}.ig-large .ig-icon{width:64px;height:64px}}' +
    '#igHelp.ig-large .ig-step{font-size:18px}#igHelp.ig-large .ig-card h3{font-size:20px}#igHelp.ig-large .ig-btns{flex-direction:column}#igHelp.ig-large .ig-btn{font-size:19px}';

  var SHARE_SVG = '<svg class="ig-ico" viewBox="0 0 24 24" fill="none" stroke="#4da3ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/></svg>';
  var PLUS_SVG = '<svg class="ig-ico" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var g = document.createElement('div'); g.id = 'igGate'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-label', EN ? (C.name || '') + ' start screen' : (C.name || '') + ' のはじめの画面');
    if (EN) g.setAttribute('lang', 'en');
    if (C.large) g.className = 'ig-large';
    var shots = (C.shots || []).map(function (s) { return '<img src="' + esc(s) + '" alt="" loading="lazy">'; }).join('');
    var badges = (C.badges || (EN ? ['Free', 'No ads', 'No sign-up'] : ['無料', '広告なし', '登録なし'])).map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('');
    var pts = (C.points || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    g.innerHTML = '<div class="ig-wrap">' +
      '<div class="ig-head"><img class="ig-icon" src="' + esc(C.icon || 'icon-192.png') + '" alt="">' +
      '<div><h1 class="ig-name">' + esc(C.name || document.title) + '</h1><p class="ig-dev">ROGUE PINK</p>' +
      (C.tagline ? '<p class="ig-tag">' + esc(C.tagline) + '</p>' : '') + '</div></div>' +
      '<div class="ig-badges">' + badges + '</div>' +
      '<div class="ig-btns"><button id="igInstall" class="ig-btn ig-main" type="button">' + esc(C.installLabel || (EN ? '📲 Install' : '📲 インストール')) + '</button>' +
      '<button id="igPlay" class="ig-btn ig-sub" type="button">' + esc(C.playLabel || (EN ? '▶ Play now' : '▶ このまま遊ぶ')) + '</button></div>' +
      '<p class="ig-note">' + (EN ? 'Install it to open it from your home screen in one tap, even offline (free, a few MB).' : 'インストールすると、ホーム画面から すぐ開けて、電波がなくても使えます(無料・数MB)') + '</p>' +
      (shots ? '<div class="ig-shots">' + shots + '</div>' : '') +
      (C.desc ? '<p class="ig-desc">' + esc(C.desc) + '</p>' : '') +
      (pts ? '<ul class="ig-points">' + pts + '</ul>' : '') +
      '<div class="ig-foot"><button id="igHide" type="button">' + (EN ? "Don't show this again" : '次から この画面を出さない') + '</button></div>' +
      '</div>';
    document.body.appendChild(g);
    document.getElementById('igPlay').onclick = function () { close(); };
    document.getElementById('igInstall').onclick = function () { install(); };
    document.getElementById('igHide').onclick = function () { try { localStorage.setItem(KEY, '1'); } catch (e) {} close(); };
    if (deferred) document.getElementById('igInstall').classList.add('ig-ready');
  }

  function close() {
    var g = document.getElementById('igGate'); if (g) g.parentNode.removeChild(g);
    var h = document.getElementById('igHelp'); if (h) h.parentNode.removeChild(h);
    if (typeof C.onPlay === 'function') { try { C.onPlay(); } catch (e) {} }
  }

  // ---------- 「インストール」を押したとき ----------
  function install() {
    if (deferred) {                                   // Android の Chrome・パソコンの Chrome / Edge
      var d = deferred; deferred = null;
      try {
        d.prompt();
        d.userChoice.then(function (r) { if (r && r.outcome === 'accepted') showDone(); }, function () {});
      } catch (e) { help(); }
      return;
    }
    if (isInApp) return help(true);                   // LINE などの中: まず外のブラウザで開く案内
    help();
  }

  // LINE の中 → 外のブラウザで開きなおす(LINE は openExternalBrowser=1 を付けると外で開く)
  function openOutside() {
    if (isLine) {
      var u = location.href.split('#')[0];
      u += (u.indexOf('?') >= 0 ? '&' : '?') + 'openExternalBrowser=1';
      location.href = u;
      return;
    }
    help(true);
  }

  function help(inApp) {
    var steps, title = 'ホーム画面に入れる方法', arrow = '';
    if (EN) return helpEn(inApp);
    if (inApp) {
      title = 'まず ブラウザで開きます';
      steps = isLine ? ['下の「<b>ブラウザで開く</b>」を押す(' + (isIOS ? 'Safari' : 'Chrome') + ' で開きます)', '開いたら、もう一度「📲 インストール」を押す']
        : isIOS
        ? ['右下(または右上)の <b>…</b> か <b>⤴</b> を押す', '「<b>Safari で開く</b>」を押す', '開いたら、もう一度「📲 インストール」を押す']
        : ['右上の <b>︙</b> を押す', '「<b>他のアプリで開く</b>」→ <b>Chrome</b> を選ぶ', '開いたら、もう一度「📲 インストール」を押す'];
    } else if (isIOS) {
      steps = [(isIPad ? '画面の上の ' : '画面の下の ') + SHARE_SVG + ' <b>共有ボタン</b> を押す(見つからないときは「<b>…</b>」の中)', '下へ少しずらして「' + PLUS_SVG + ' <b>ホーム画面に追加</b>」を押す', '右上の「<b>追加</b>」を押す'];
      arrow = isIPad ? '<div class="ig-arrow top">⬆️</div>' : '<div class="ig-arrow">⬇️</div>';
    } else if (isAndroid) {
      steps = ['右上の <b>︙</b>(メニュー)を押す', '「<b>アプリをインストール</b>」か「<b>ホーム画面に追加</b>」を押す', '「<b>インストール</b>」を押す'];
      arrow = '<div class="ig-arrow top">⬆️</div>';
    } else {
      steps = ['アドレスバーの右はしの <b>インストール</b> のマーク(画面に＋)を押す', 'ない時は、メニューから「<b>アプリをインストール</b>」', '「<b>インストール</b>」を押す'];
    }
    var h = document.createElement('div'); h.id = 'igHelp'; if (C.large) h.className = 'ig-large';
    h.innerHTML = '<div class="ig-card"><h3>' + title + '</h3>' +
      steps.map(function (s, i) { return '<div class="ig-step"><span class="ig-num">' + (i + 1) + '</span><span>' + s + '</span></div>'; }).join('') +
      '<div class="ig-btns"><button id="igHelpPlay" class="ig-btn ig-sub" type="button">' + esc(C.laterLabel || ('あとで(' + String(C.playLabel || 'このまま遊ぶ').replace(/^[▶\s]+/, '') + ')')) + '</button>' +
      (inApp && isLine ? '<button id="igOpenOut" class="ig-btn ig-main" type="button">ブラウザで開く</button>' : '<button id="igHelpOk" class="ig-btn ig-main" type="button">わかった</button>') +
      '</div></div>' + arrow;
    var old = document.getElementById('igHelp'); if (old) old.parentNode.removeChild(old);
    document.body.appendChild(h);
    var ok = document.getElementById('igHelpOk'); if (ok) ok.onclick = function () { h.parentNode.removeChild(h); };
    var out = document.getElementById('igOpenOut'); if (out) out.onclick = function () { openOutside(); };
    document.getElementById('igHelpPlay').onclick = function () { close(); };
  }

  // 英語の案内(lang:'en' のときだけ。中身は help と同じ)
  function helpEn(inApp) {
    var steps, title = 'Add to your home screen', arrow = '';
    if (inApp) {
      title = 'First, open it in your browser';
      steps = isLine ? ['Tap "<b>Open in browser</b>" below (it opens in ' + (isIOS ? 'Safari' : 'Chrome') + ')', 'Then tap "📲 Install" again']
        : isIOS
        ? ['Tap <b>…</b> or <b>⤴</b> at the bottom (or top) right', 'Tap "<b>Open in Safari</b>"', 'Then tap "📲 Install" again']
        : ['Tap <b>︙</b> at the top right', 'Choose "<b>Open in…</b>" → <b>Chrome</b>', 'Then tap "📲 Install" again'];
    } else if (isIOS) {
      steps = ['Tap the ' + SHARE_SVG + ' <b>Share</b> button ' + (isIPad ? 'at the top' : 'at the bottom') + ' (or look inside "<b>…</b>")', 'Scroll down a little and tap "' + PLUS_SVG + ' <b>Add to Home Screen</b>"', 'Tap "<b>Add</b>" at the top right'];
      arrow = isIPad ? '<div class="ig-arrow top">⬆️</div>' : '<div class="ig-arrow">⬇️</div>';
    } else if (isAndroid) {
      steps = ['Tap <b>︙</b> (menu) at the top right', 'Tap "<b>Install app</b>" or "<b>Add to Home screen</b>"', 'Tap "<b>Install</b>"'];
      arrow = '<div class="ig-arrow top">⬆️</div>';
    } else {
      steps = ['Click the <b>install</b> icon (a screen with ＋) at the right end of the address bar', 'If it is not there, choose "<b>Install app</b>" from the menu', 'Click "<b>Install</b>"'];
    }
    var h = document.createElement('div'); h.id = 'igHelp'; if (C.large) h.className = 'ig-large'; h.setAttribute('lang', 'en');
    h.innerHTML = '<div class="ig-card"><h3>' + title + '</h3>' +
      steps.map(function (s, i) { return '<div class="ig-step"><span class="ig-num">' + (i + 1) + '</span><span>' + s + '</span></div>'; }).join('') +
      '<div class="ig-btns"><button id="igHelpPlay" class="ig-btn ig-sub" type="button">' + esc(C.laterLabel || 'Not now') + '</button>' +
      (inApp && isLine ? '<button id="igOpenOut" class="ig-btn ig-main" type="button">Open in browser</button>' : '<button id="igHelpOk" class="ig-btn ig-main" type="button">Got it</button>') +
      '</div></div>' + arrow;
    var old = document.getElementById('igHelp'); if (old) old.parentNode.removeChild(old);
    document.body.appendChild(h);
    var ok = document.getElementById('igHelpOk'); if (ok) ok.onclick = function () { h.parentNode.removeChild(h); };
    var out = document.getElementById('igOpenOut'); if (out) out.onclick = function () { openOutside(); };
    document.getElementById('igHelpPlay').onclick = function () { close(); };
  }

  function showDone() {
    var g = document.getElementById('igGate'); if (!g) return;
    var h = document.createElement('div'); h.id = 'igHelp'; if (C.large) h.className = 'ig-large';
    h.innerHTML = EN ? '<div class="ig-card" lang="en"><h3>✅ Added to your home screen</h3><div class="ig-step">Next time, open it from the icon on your home screen.</div>' +
      '<div class="ig-btns"><button id="igHelpOk" class="ig-btn ig-main" type="button">' + esc(C.playLabel || '▶ Play') + '</button></div></div>' :
      '<div class="ig-card"><h3>✅ ホーム画面に入りました</h3><div class="ig-step">次からは、ホーム画面の アイコンから開けます。</div>' +
      '<div class="ig-btns"><button id="igHelpOk" class="ig-btn ig-main" type="button">' + esc(C.playLabel || '▶ 遊ぶ') + '</button></div></div>';
    document.body.appendChild(h);
    document.getElementById('igHelpOk').onclick = function () { close(); };
  }

  window.InstallGate = { show: function () { if (!document.getElementById('igGate')) build(); }, close: close, install: install };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
