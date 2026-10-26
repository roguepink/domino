/* ui.js — 画面(まとめ役の仮。UI・UX係が 作りかえる) */
var DOMINO = window.DOMINO = window.DOMINO || {};
DOMINO.UI = (function () {
  var G, hud, msg;
  function el(id) { return document.getElementById(id); }
  return {
    init: function (game) { G = game; hud = el('hud'); msg = el('msg');
      msg.addEventListener('click', function () { if (G.state === 'intro') G.go(); else if (G.state === 'result') { if (G.lastResult.clear) G.next(); else G.retry(); } else if (G.state === 'menu') G.play(DOMINO.Save.unlocked()); }); },
    showMenu: function () { msg.style.display = 'flex'; msg.textContent = 'ドミノ ラッシュ — タップ'; },
    showIntro: function (st) { msg.style.display = 'flex'; msg.textContent = 'ステージ ' + st.id + ' ' + st.name + ' — タップでスタート'; },
    showHud: function () { msg.style.display = 'none'; },
    showPause: function () { msg.style.display = 'flex'; msg.textContent = 'ポーズ'; },
    showResult: function (r) { msg.style.display = 'flex'; msg.textContent = r.clear ? ('クリア! ★' + r.stars + ' ' + r.score + '点') : ('しっぱい: ' + r.reason); },
    onEvents: function () {},
    update: function (s) { hud.textContent = 'ドミノ ' + s.stock + '  波まで ' + (s.danger > 50 ? '-' : s.danger.toFixed(1)) + 'm  ' + s.score + '点'; }
  };
})();
