/* level.js — ステージの地図(文字の絵)を、計算で使える形にする。
 *
 * ステージの書き方(stages.js):
 *   { id:1, name:'はじめの一歩', theme:'toy',
 *     map: [               ← 上がゴール側(遠く)、下がスタート側。1行 = 1マス(1m)。横は CONFIG.COLS 文字
 *       '....G....',
 *       '.........',
 *       '....S....' ],
 *     wave:{ delay, v0, acc, max }, run, stock,   ← 書かなければ CONFIG の数字
 *     obj:[ { t:'saw', z:20, x:-3, x2:3, v:2 }, ... ] }   ← 動くじゃま物など(sim.js の OBJ を見る)
 *
 * マスの文字:
 *   .  床            _ (またはスペース)  穴(落ちたら負け。1マスの穴ならドミノの波は渡れる。2マス以上だと切れる)
 *   #  かべ          b  ドミノの箱(+CONFIG.BOX)   B  大きい箱(+CONFIG.BIGBOX)
 *   *  星(1ステージ3つ)   c  コイン
 *   ~  ぬかるみ(おそくなる)   ^  ダッシュ板(しばらく速くなる)   i  氷(すべる)
 *   <  >  ベルト(左/右へ流される)   x  トゲ(地面にいると しびれて止まる。ジャンプでこえる)
 *   k / K   スイッチ と 門。ドミノの波が k の上のドミノを倒すと、K の門(かべ)が開く。
 *   p / P、q / Q も同じ(別の組)
 *   W  こわれるかべ(近くの爆弾 o が倒れる波で爆発すると こわれる)   o  爆弾(床の上に置いてある)
 *   D  巨大ドミノ(床の上。倒れる波が近くを通ると ドーンと倒れる。見せ場)   n  音のドミノの床(倒れると ドレミが鳴る)
 *   f  しずむ床(ときどき水にしずむ。しずんでいる間に乗ると落ちる)   J  ジャンプ台(のると 大きく飛ぶ)
 *   S  スタートの位置(床)   G  ゴールの行(床。この行をこえたらゴール)
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.Level = (function () {
  var T = { FLOOR: 0, HOLE: 1, WALL: 2, MUD: 3, BOOST: 4, ICE: 5, BELT_L: 6, BELT_R: 7, SPIKE: 8, SWITCH: 9, GATE: 10, SINK: 11, SPRING: 12 };

  function parse(stage) {
    var C = DOMINO.CONFIG, cols = C.COLS;
    var src = stage.map.slice().reverse();          // [0] = スタート側
    var rows = src.length;
    var cell = new Uint8Array(cols * rows);
    var group = new Int8Array(cols * rows);          // スイッチ・門の組(0 = なし、1 = k、2 = p、3 = q)
    var weak = new Uint8Array(cols * rows);          // 1 = こわれるかべ(W)
    var items = [];                                  // 箱・星・コイン
    var start = { x: 0, z: 1.5 }, goalZ = rows - 2;
    var gid = { k: 1, p: 2, q: 3 };
    for (var r = 0; r < rows; r++) {
      var line = src[r] || '';
      for (var c = 0; c < cols; c++) {
        var ch = line.charAt(c) || '_';
        var i = r * cols + c, x = c - cols / 2 + 0.5, z = r + 0.5;
        var t = T.FLOOR;
        switch (ch) {
          case '_': case ' ': t = T.HOLE; break;
          case '#': t = T.WALL; break;
          case 'W': t = T.WALL; weak[i] = 1; break;
          case 'f': t = T.SINK; break;
          case 'J': t = T.SPRING; break;
          case 'o': case 'D': case 'n': break;        // 床(sim.js が 特別なマスとして 読む)
          case '~': t = T.MUD; break;
          case '^': t = T.BOOST; break;
          case 'i': t = T.ICE; break;
          case '<': t = T.BELT_L; break;
          case '>': t = T.BELT_R; break;
          case 'x': t = T.SPIKE; break;
          case 'b': items.push({ t: 'box', x: x, z: z, n: C.BOX }); break;
          case 'B': items.push({ t: 'bigbox', x: x, z: z, n: C.BIGBOX }); break;
          case '*': items.push({ t: 'star', x: x, z: z }); break;
          case 'c': items.push({ t: 'coin', x: x, z: z }); break;
          case 'S': start = { x: x, z: z }; break;
          case 'G': goalZ = r; break;
          default:
            if (gid[ch]) { t = T.SWITCH; group[i] = gid[ch]; }
            else if (gid[ch.toLowerCase()]) { t = T.GATE; group[i] = gid[ch.toLowerCase()]; }
        }
        cell[i] = t;
      }
    }
    return {
      stage: stage, cols: cols, rows: rows, cell: cell, group: group, weak: weak, items: items,
      start: start, goalZ: goalZ,
      // コースの横のはしの柵(空の島 W4 と stage.edge === 'open' の面には ない = 落ちる)
      rail: stage.edge ? stage.edge !== 'open' : (stage.world || Math.ceil(stage.id / 10)) !== 4,
      halfW: cols / 2,
      // (x, z) のマスの番号。コースの外は -1
      index: function (x, z) {
        var c = Math.floor(x + cols / 2), r = Math.floor(z);
        if (c < 0 || c >= cols || r < 0 || r >= rows) return -1;
        return r * cols + c;
      },
      at: function (x, z) {
        var i = this.index(x, z);
        if (i >= 0) return this.cell[i];
        if (z >= rows) return T.FLOOR;                 // ゴールの先は広場(床)
        return this.rail && z >= 0 ? T.WALL : T.HOLE;  // 横の外: 柵がある面は かべ、ない面(空の島)は 穴
      }
    };
  }

  return { T: T, parse: parse };
})();
