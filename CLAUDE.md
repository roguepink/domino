# ドミノ ラッシュ(repo roguepink/domino)

ノブさんの依頼(2026-10-27): ドミノをイメージした、やみつきになるスマホゲーム。操作はかんたん(タップ・左側で左右)、
スリリング、ステージ約100。市場調査をして、はやりのゲームを参考に良くする。チーム(まとめ役・調べ役・作り役・UI/UX・チェック役)で、
別々の目線でチェックを入れて作る。**ドミノのイメージは絶対。**時間はかけてよい。
公開リポジトリ。**写真・映画素材・個人情報・API キーは置かない。**公開(GitHub Pages)は ノブさんに見せて OK をもらってから。

- 市場調査: `docs/research.md`(調べ役)
- ゲームの設計: `docs/design.md`(まとめ役 + ステージ設計係)
- 遊び方の中心: 主人公が走ると うしろにドミノが並ぶ → うしろから「倒れる波」が追ってくる → ゴールで大ドミノを倒す

## 作り(ビルドなし・外部サービスなし)
- `index.html` に `<script src>` を この順で並べる(ES modules は使わない。古い iPhone でも動かすため):
  `config.js → level.js → sim.js → worlds.js → stages.js → save.js → input.js → audio.js → render2d.js → ui.js → bot.js → main.js`
  最後に `DOMINO.Game.boot()`。
- 3D は `js/render3d.js` だけが ES module(`import * as THREE from '../vendor/three/build/three.module.min.js'`)。
  main.js が動的 import で読む。**importmap は使わない**。読めない端末(iOS 16.4 未満など)では 2D の絵(render2d.js)で遊べる
- 全部の部品は `window.DOMINO` の下にある。var・function の書き方(render3d.js だけは class や const を使ってよい)
- 画像・音のファイルは使わない(three.js の形・canvas で描く・WebAudio で作る)
- 確認: `source ~/.local/venvs/ryokoshi/bin/activate && python3 tools/playtest.py --hash "play=1&auto" --secs 12 --shots 3 --size 390x844 --out _check/x`
  → `_check/x-*.png` を **必ず目で見る**。音は出ない(--mute-audio)。**Mac の画面をつけない・音を出さない**(ノブさんのルール)
  - アドレスの印: `#play=番号`(そのステージ)/ `&go`(すぐ走る)/ `&auto`(ボットが遊ぶ)/ `&2d`(2Dの絵)/ `#noinstall`
- js ファイルを足したら `sw.js` の FILES に足して VERSION を上げる

## 係とファイル(自分の係のファイルだけ書く。ほかの係のファイルは読むだけ。困ったら まとめ役へ)
| 係 | ファイル |
|---|---|
| まとめ役 | `js/config.js` `js/level.js` `js/sim.js` `js/main.js` `js/save.js` `js/worlds.js` `CLAUDE.md` `docs/design.md` |
| 3D見た目・演出係 | `js/render3d.js`(と `vendor/`) |
| UI・UX係 | `index.html` `css/style.css` `js/ui.js` `js/input.js` `install.js` の設定 |
| 音係 | `js/audio.js` |
| ステージ設計係 | `js/stages.js` `js/bot.js` `tools/stagecheck.py` |
| 2D(代わりの絵) | `js/render2d.js`(まとめ役) |

sim.js に新しい仕掛けが要るときは、まとめ役に頼む(勝手に書きかえない)。

## 部品のつなぎ方(約束)
### 計算(sim.js) — 読むだけ
- `new DOMINO.Sim(stage)` / `sim.step({steer, jump})` 1/60秒 / `sim.clone()` / `sim.revive()` / `sim.starResult()`
- `sim.state` 'run'|'goal'|'clear'|'fail'、`sim.failReason` 'caught'(つかまった)|'broken'(切れた)|'empty'(ドミノ切れ)|'fall'(落ちた)
- `sim.p` 主人公 {x, z, y, vx, heading, air, stun, boost, safe(お助け中), twin(2列の残り m), done}
- `sim.doms[]` ドミノ {x, z, h(向き), s(列にそった長さ), st 0立つ/1倒れた, t0 倒れはじめた時刻, rest 倒れきった角度, tall 橋ドミノの高さ(0=ふつう), twin 2列, n 番号}
  倒れる角度の目安: `u = (sim.t - t0) / CONFIG.FALL_TIME` → `角度 = rest * min(1,u)^2`(橋ドミノは tall の分ゆっくり)
- `sim.fronts[]` 倒れる波の先頭 {s, i, dead}。`sim.wave.v` 速さ。`sim.danger` 波から主人公までの長さ(m)
- `sim.items[]` {t:'box'|'bigbox'|'star'|'coin', x, z, n, taken}。star = 金のドミノ(1面に3つ)
- `sim.specials[]` {t:'bomb'|'big'|'note', x, z, done, t0}。`sim.objs[]` 仕掛け(sim.js の _stepObjs の説明)。`hx, hz` = 今の位置
- `sim.rivals[]` 前から倒れてくる列のドミノ {x, z, t0}(ゴール側 → 手前へ倒れる)
- `sim.giant` ゴールの大ドミノ {x, z, h, t0}(位置は goalZ + CONFIG.GIANT_DZ、高さ CONFIG.GIANT_H)。`sim.brokenAt` 列が切れた所のドミノ番号。`sim.level` 地図(level.js)。`sim.cellAt(x,z)` マスの種類(DOMINO.Level.T)
- `sim.gateOpen[g]` `sim.gateT[g]` 門 / `sim.broken[]` こわれたかべのマス番号 / `sim.sunk(z)` しずむ床が今しずんでいるか
- `sim.score` `sim.stock` `sim.combo` `sim.stars`(取った金のドミノ) `sim.starsTotal` `sim.nearCount` `sim.cfg.nearGoal` `sim.progress` 0..1
- `sim.events[]` その1/60秒に起きたこと。main が1コマ分をまとめて、各係の `onEvents(list, sim)` に渡す(種類は sim.js の先頭)

### main.js(DOMINO.Game)
- `Game.play(id)` → UI.showIntro → (タップ)`Game.go()` → UI.showHud → 終わったら UI.showResult(res)
- `Game.retry() next() revive() skip() toMenu() pause() resume()`、`Game.slowmo(scale, sec)` `Game.hitstop(sec)`、`Game.state`、`Game.sim`、`Game.lastResult`
- res = {stage, clear, stars, prevStars, score, best, newRecord, reason, canRevive, fails, canSkip, goldGot, goldTotal, near, nearGoal, dominoes, progress, unlockedNew}

### 絵(render3d.js / render2d.js)
- 3D: `export default { supported(), init(box), setSim(sim, stage), onEvents(list, sim), render(dt, realDt), resize(), replay(onDone), dispose() }`
  - `replay(onDone)`: クリアのあと「空からのリプレイ」(列が全部倒れるのを早送り)。終わったら onDone()。UI が結果画面の前に呼ぶ
- 2D: `DOMINO.Render2D` 同じ形(replay はすぐ onDone)
- `DOMINO.Render` = 今使っている方

### 画面(ui.js)
- `DOMINO.UI = { init(game), showMenu(), showIntro(stage, sim), showHud(sim), showPause(), showResult(res, sim), onEvents(list, sim), update(sim, state, dt) }`

### 音(audio.js)
- `DOMINO.Audio = { unlock(), stage(stage), start(stage), stop(), pause(on), onEvents(list, sim), update(sim, dt, state), setSound(on), setMusic(on) }`
- `unlock()` は UI が 最初のタップのときに呼ぶ(iPhone は タップの中で AudioContext.resume() しないと鳴らない)

### 着せかえ(ui.js が決める・render3d.js が読む)
- `DOMINO.SKINS = [{ id:'classic', name:'にじいろ', cost:0(★の合計がいくつで手に入るか), colors:'rainbow' か ['#hex', ...], pip:'#fff', look:'gloss'|'wood'|'neon'|'gold'|'candy'|'glass' }, ...]`
- 今の着せかえ = `DOMINO.Save.data.skin`。render3d は setSim のときに読む

### 保存(save.js)
- `DOMINO.Save.data` {stars, best, fails, skipped, coins, skin, skins, settings{sound, music, shake}, seenTips}、`write()` `unlocked()` `totalStars()`

## 守ること
- 1面 30〜60秒。負けたら 1タップ・1秒以内でやり直し。3回負けたら「とばす」。お助けは1面に1回
- ゆれ・スローは 大事な場面だけ。演出を盛りすぎない
- スマホで軽く(ドミノは InstancedMesh、影は1つ、遠くは描かない)。古い iPhone は 2D で遊べる
- 文字は日本語・やさしく。小さい画面(幅 320)でも 文字が折れない
