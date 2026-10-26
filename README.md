# ドミノ ラッシュ

走ると、うしろに ドミノが ならぶ。自分のドミノの「倒れる波」から にげきって、ゴールの大ドミノを倒そう!
全100ステージ(10ワールド × 10面)。無料・広告なし・登録なし。スマホのブラウザで遊べて、ホーム画面にも入れられる(電波がなくても遊べる)。

## 遊び方
- **画面の左がわを なぞる** = 左右に動く
- **画面の右がわを タップ** = ジャンプ(トゲ・転がる玉・穴をこえる。穴をこえると「橋ドミノ」がかかる)
- 前へは自動で走る。ドミノも自動で ならぶ。ドミノが なくなる・波に つかまる・穴に落ちる と負け
- ★1 クリア / ★2 金のドミノ 3つ / ★3 波に近づいて にげきる(セーフ!)
- パソコン: ← → / A D、スペース、Esc

## 作り
- ビルドなし。`index.html` + `css/` + `js/`(var・function の昔ながらの書き方)+ 3D は `js/render3d.js`(three.js r186 を `vendor/` に同梱)
- 3D が使えない古い端末では 2D の絵で遊べる
- 音はすべて WebAudio でその場で作る。画像・音のファイルは使わない(アイコン・紹介画像は `tools/make_art.py` で作る)
- チームの約束ごとは `CLAUDE.md`、設計は `docs/design.md`、市場調査は `docs/research.md`

## 確かめの道具
```
source ~/.local/venvs/ryokoshi/bin/activate
python3 tools/playtest.py --hash "play=1&auto" --secs 12 --shots 3 --size 390x844 --out _check/x   # 自動で遊んで写真
python3 tools/stagecheck.py --fast          # 100面を自動プレイで全部確かめる
python3 tools/qa_flow.py flow               # 画面の流れ(タイトル → クリア → つぎへ …)
```
