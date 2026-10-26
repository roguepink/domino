# iPhone・Android で開けるか  2026-10-27 02:50
対象: .

○ iPhone_SE            ?a=1#noinstall OK
○ iPhone_SE            ?a=2#play=1&go OK
○ iPhone_SE            ?a=3           OK
○ iPhone_8_SE2         ?a=1#noinstall OK
○ iPhone_8_SE2         ?a=2#play=1&go OK
○ iPhone_8_SE2         ?a=3           OK
○ iPhone_15            ?a=1#noinstall OK
○ iPhone_15            ?a=2#play=1&go OK
○ iPhone_15            ?a=3           OK
○ iPhone_15_ProMax     ?a=1#noinstall OK
○ iPhone_15_ProMax     ?a=2#play=1&go OK
○ iPhone_15_ProMax     ?a=3           OK
○ iPhone_LINE          ?a=1#noinstall OK
○ iPhone_LINE          ?a=2#play=1&go OK
○ iPhone_LINE          ?a=3           OK
○ iPhone_保存できない        ?a=1#noinstall OK
○ iPhone_保存できない        ?a=2#play=1&go OK
○ iPhone_保存できない        ?a=3           OK
✗ Android_Pixel7       ?a=1#noinstall エラー 1
      console: Failed to load resource: the server responded with a status of 404 (File not found)
○ Android_Pixel7       ?a=2#play=1&go OK
○ Android_Pixel7       ?a=3           OK
○ Android_LINE         ?a=1#noinstall OK
○ Android_LINE         ?a=2#play=1&go OK
○ Android_LINE         ?a=3           OK
○ iPhone_古い(iOS15)     ?a=1#noinstall OK
      動かないファイル: vendor/three/build/three.core.js(エラーは出てよい。画面が使えるかを見る → 画像を目で見る)
○ iPhone_古い(iOS15)     ?a=2#play=1&go OK
      動かないファイル: vendor/three/build/three.core.js(エラーは出てよい。画面が使えるかを見る → 画像を目で見る)
○ iPhone_古い(iOS15)     ?a=3           OK
      動かないファイル: vendor/three/build/three.core.js(エラーは出てよい。画面が使えるかを見る → 画像を目で見る)

古い iPhone(iOS 15.4 以上)で動かない書き方: 1 件
  ✗ vendor/three/build/three.core.js:12 [class-static-block] (同梱の部品) class の static { } は iOS 16.4 から
確かめたほうがよい所: 0 件

画像: /Users/nobu/claude-work/domino/_check/iphone  ← かならず目で見る(まっ白・くずれ)