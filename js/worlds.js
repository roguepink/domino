/* worlds.js — 10 のワールド(10面ずつ)。名前・新しい仕掛け・ゴールの大仕掛け・色。
 * どの係も読む。色は 絵の係・画面の係が使う(sky 空 / floor 床 / floor2 床のもよう / wall かべ / accent 目立つ色)。
 * ステージは world = 1..10、ステージ番号 id = (world-1)*10 + 1..10。
 */
var DOMINO = window.DOMINO = window.DOMINO || {};

DOMINO.WORLDS = [
  { id: 1, name: 'はじまりの公園', en: 'park', news: '走る・ならべる・にげる / 箱 / 金のドミノ / 巨大ドミノ', finale: 'tower',
    sky: '#9fdcff', sky2: '#e9f7ff', floor: '#8fd16a', floor2: '#7cc35a', wall: '#c98b5a', accent: '#ff5a8a' },
  { id: 2, name: 'おもちゃの町', en: 'toy', news: '+20 ×2 の門 / ダッシュ板 / ぬかるみ', finale: 'train',
    sky: '#ffd6ec', sky2: '#fff3fa', floor: '#ffe9a8', floor2: '#ffd97a', wall: '#7f8cff', accent: '#ff7a2f' },
  { id: 3, name: 'からくり工場', en: 'factory', news: 'スイッチと門 / ベルトコンベア', finale: 'machine',
    sky: '#c9d3e0', sky2: '#eef2f7', floor: '#b8c2cf', floor2: '#a9b4c2', wall: '#5b6b80', accent: '#ffb400' },
  { id: 4, name: '空の島', en: 'sky', news: '穴とジャンプ(橋ドミノ) / ジャンプ台', finale: 'balloon',
    sky: '#7fc8ff', sky2: '#ffffff', floor: '#f4f0e6', floor2: '#e7e0cf', wall: '#9aa9ff', accent: '#3fd0ff' },
  { id: 5, name: 'あぶない森', en: 'forest', news: 'のこぎり・転がる玉・ハンマー / トゲ', finale: 'tree',
    sky: '#2f6b4f', sky2: '#a7d9a0', floor: '#5c8f4a', floor2: '#4f7f3f', wall: '#6b4a2f', accent: '#ffd23f' },
  { id: 6, name: '雪山', en: 'snow', news: '氷の道 / 強い風', finale: 'snowman',
    sky: '#8fb8e6', sky2: '#e8f3ff', floor: '#eef5fc', floor2: '#d3e3f3', wall: '#5f86b8', accent: '#3a7bff' },
  { id: 7, name: 'お祭り', en: 'festival', news: '爆弾ドミノ・こわれるかべ / 音のドミノ / 2列の門', finale: 'fireworks',
    sky: '#2a1b4d', sky2: '#ff8a5c', floor: '#d94f3d', floor2: '#c4402f', wall: '#ffcf5c', accent: '#ff3df0' },
  { id: 8, name: '海', en: 'sea', news: 'しずむ床 / うず(ベルト)', finale: 'lighthouse',
    sky: '#5ec8e8', sky2: '#e9fbff', floor: '#f2dca6', floor2: '#e8cd8c', wall: '#3d8fb3', accent: '#ff6b4a' },
  { id: 9, name: '夜の遺跡', en: 'ruins', news: '暗やみ / 前から倒れてくる列', finale: 'statue',
    sky: '#0c0f2a', sky2: '#2b2f5e', floor: '#7a7466', floor2: '#6b6558', wall: '#4a4438', accent: '#7cf3ff', dark: true },
  { id: 10, name: 'ドミノ城', en: 'castle', news: 'これまでの全部', finale: 'castle',
    sky: '#3b1f5e', sky2: '#ffb3d9', floor: '#e8e0f0', floor2: '#d6cbe3', wall: '#7a4fb3', accent: '#ffd700' }
];

DOMINO.worldOf = function (stage) { return DOMINO.WORLDS[Math.max(0, Math.min(9, (stage.world || Math.ceil(stage.id / 10)) - 1))]; };
