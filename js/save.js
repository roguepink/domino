/* save.js — 進み具合を端末に覚える(localStorage)。LINE の中・シークレットで失敗しても 止まらない。
 *   DOMINO.Save.data = { v:1, stars:{ id: 0..3 }, best:{ id: 点 }, fails:{ id: 回 }, skipped:{ id:true },
 *                        coins: 0, skin: 'classic', skins:{ classic:true }, settings:{ sound:true, music:true, shake:true } }
 *   DOMINO.Save.unlocked()   いま遊べる いちばん先のステージ番号(クリアかスキップした次まで)
 *   DOMINO.Save.totalStars() 星の合計
 *   DOMINO.Save.write()      覚える
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Save = (function () {
  var KEY = (DOMINO.CONFIG && DOMINO.CONFIG.SAVE_KEY) || 'domino-save-v1';
  var def = function () {
    return { v: 1, stars: {}, best: {}, fails: {}, skipped: {}, coins: 0, skin: 'classic', skins: { classic: true },
      settings: { sound: true, music: true, shake: true }, seenTips: {} };
  };
  var data = def();
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) { var o = JSON.parse(raw); var d = def(); for (var k in d) if (o[k] != null) d[k] = o[k]; data = d; }
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
