/* save.js — 進み具合を端末に覚える(localStorage)。LINE の中・シークレットで失敗しても 止まらない。
 *   DOMINO.Save.data = { v:1, stars:{ id: 0..3 }, best:{ id: 点 }, fails:{ id: 回 }, skipped:{ id:true },
 *                        coins: 0, skin: 'classic', skins:{ classic:true }, hat: 'none', hats:{ none:true }, settings:{ sound:true, music:true, shake:true } }
 *   DOMINO.Save.unlocked()   いま遊べる いちばん先のステージ番号(クリアかスキップした次まで)
 *   DOMINO.Save.totalStars() 星の合計
 *   DOMINO.Save.write()      覚える
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Save = (function () {
  var KEY = (DOMINO.CONFIG && DOMINO.CONFIG.SAVE_KEY) || 'domino-save-v1';
  var def = function () {
    return { v: 1, stars: {}, best: {}, fails: {}, skipped: {}, coins: 0, skin: 'classic', skins: { classic: true }, hat: 'none', hats: { none: true },
      settings: { sound: true, music: true, shake: true }, seenTips: {} };
  };
  var data = def();
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var o = JSON.parse(raw), d = def();
      if (o && typeof o === 'object') for (var k in d) {
        var v = o[k];
        if (v == null || typeof v !== typeof d[k] || Array.isArray(v) !== Array.isArray(d[k])) continue;   // 形がちがうものは 使わない
        d[k] = v;
      }
      // 中身の点検(数でないものは 消す)
      ['stars', 'best', 'fails'].forEach(function (key) { var m = d[key]; for (var id in m) { var n = +m[id]; if (!(n >= 0) || !isFinite(n)) delete m[id]; else m[id] = n; } });
      d.coins = +d.coins >= 0 ? +d.coins : 0;
      var st = def().settings; for (var sk in st) if (typeof d.settings[sk] !== 'boolean') d.settings[sk] = st[sk];
      if (typeof d.skin !== 'string') d.skin = 'classic';
      if (typeof d.hat !== 'string') d.hat = 'none';
      data = d;
    }
  } catch (e) {}

  return {
    data: data,
    write: function () { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} },
    unlocked: function () {
      var n = 1;
      while ((data.stars[n] > 0 || data.skipped[n]) && n < 1000) n++;
      return n;
    },
    totalStars: function () { var s = 0; for (var k in data.stars) s += data.stars[k] || 0; return s; },
    reset: function () { var d = def(); for (var k in d) data[k] = d[k]; this.write(); }
  };
})();
