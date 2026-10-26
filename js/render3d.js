/* render3d.js — 3D の絵と演出(3D見た目・演出係)。このファイルだけ ES module。
 *
 *   export default { supported(), init(box), setSim(sim, stage), onEvents(list, sim), render(dt, realDt), resize(), replay(onDone), dispose() }
 *   main.js が 動的 import で読み、2D(render2d.js)の代わりに使う。計算(sim.js)は 読むだけ。
 *
 * 世界の向き: sim は x = 右、z = 前(ゴール)、y = 上。three.js では (x, y, -z) に置く(カメラは -Z を向くのが ふつうなので)。
 * 軽くするための工夫:
 *   - ドミノは InstancedMesh 1つ(見えている範囲のぶんだけ 行列を書く)。白い点は 形を増やさず シェーダーで描く
 *   - 影は 1つ(主人公のまわりだけ 追いかける)。ピクセル比は 最大 2。重いと 自動で下げる(→ 影を切る)
 *   - コースの床・かべは ステージごとに 1つの形にまとめる。景色は InstancedMesh で 少しだけ
 */
import * as THREE from '../vendor/three/build/three.module.min.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (k, dt) => 1 - Math.exp(-k * dt);
const rnd = (a, b) => a + Math.random() * (b - a);

let DOM = null, CFG = null;
let box = null, renderer = null, scene = null, camera = null;
let sim = null, stageObj = null, world = null;
let S = null;                     // ステージごとの物
let RP = null;                    // リプレイの状態
const R = {};                     // 共有の物(init で 1回)
const shared = new Set();         // ステージを片づけるときに 消さない物
let viewW = 1, viewH = 1, pixelRatio = 1, maxPR = 2;
let shakeAmp = 0, shakeT = 0;
let realClock = 0;
const Q = { level: 0, frames: 0, time: 0, since: 0 };   // 自動で画質を下げる
const cam = { pos: new THREE.Vector3(0, 10, 10), look: new THREE.Vector3(), baseDist: 18, ready: false, fit: 1 };

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3();

function share(o) { shared.add(o); return o; }
function hexToRGB(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }      // 線形
function srgb(hex) { const n = new THREE.Color(hex).getHex(THREE.SRGBColorSpace); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function settingShake() { try { const s = DOM.Save.data.settings; return !(s && s.shake === false); } catch (e) { return true; } }
function game() { return DOM && DOM.Game; }
function shake(amp, t) { if (!settingShake()) return; shakeAmp = Math.max(shakeAmp, amp); shakeT = Math.max(shakeT, t); }
function hitstop(s) { const G = game(); if (G && G.hitstop) G.hitstop(s); }
function slowmo(k, s) { const G = game(); if (G && G.slowmo) G.slowmo(k, s); }

// ---------------------------------------------------------------- canvas の絵
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function ctex(c, color = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
function starPath(g, cx, cy, r1, r2, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = -PI / 2 + i * PI / n; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.closePath();
}

function makeTextures() {
  // ドミノの目(白い点)の「型」。赤 = 点、緑 = ふちと まん中の線(少し暗く)。色は シェーダーで決める
  R.pipTex = share(ctex(canvas(64, 128, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgb(0,200,0)'; g.lineWidth = 3; g.strokeRect(4.5, 4.5, w - 9, h - 9);
    g.fillStyle = 'rgb(0,170,0)'; g.fillRect(10, 62, w - 20, 4);
    g.fillStyle = 'rgb(255,0,0)';
    const pip = (x, y) => { g.beginPath(); g.arc(x, y, 6.5, 0, TAU); g.fill(); };
    pip(19, 18); pip(45, 18); pip(19, 46); pip(45, 46);          // 上: 4
    pip(19, 82); pip(32, 96); pip(45, 110);                      // 下: 3
  }), false));
  R.pipTex.minFilter = THREE.LinearMipmapLinearFilter;

  const face = (kind) => share(ctex(canvas(128, 128, (g) => {
    const ink = '#1b1430';
    g.lineCap = 'round'; g.lineJoin = 'round';
    const eye = (x, y, rx, ry) => { g.fillStyle = ink; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x - rx * 0.3, y - ry * 0.38, rx * 0.4, 0, TAU); g.fill(); };
    const cheek = () => { g.fillStyle = 'rgba(255,110,150,.6)'; g.beginPath(); g.ellipse(22, 80, 12, 7, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(106, 80, 12, 7, 0, 0, TAU); g.fill(); };
    g.strokeStyle = ink; g.fillStyle = ink;
    if (kind === 'run') {
      eye(42, 56, 10, 14); eye(86, 56, 10, 14); cheek();
      g.lineWidth = 6; g.strokeStyle = ink; g.beginPath(); g.arc(64, 80, 13, 0.15 * PI, 0.85 * PI); g.stroke();
    } else if (kind === 'jump') {
      eye(42, 52, 10, 15); eye(86, 52, 10, 15); cheek();
      g.fillStyle = '#9b1d3c'; g.beginPath(); g.arc(64, 88, 12, 0, PI); g.closePath(); g.fill();
    } else if (kind === 'scared') {
      for (const x of [40, 88]) {
        g.fillStyle = '#fff'; g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.ellipse(x, 56, 17, 20, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = ink; g.beginPath(); g.arc(x + (x < 64 ? 4 : -4), 60, 6, 0, TAU); g.fill();
      }
      g.lineWidth = 6; g.beginPath(); g.moveTo(22, 32); g.lineTo(50, 22); g.moveTo(106, 32); g.lineTo(78, 22); g.stroke();
      g.fillStyle = '#7a1630'; g.beginPath(); g.ellipse(64, 100, 11, 14, 0, 0, TAU); g.fill(); g.lineWidth = 4; g.stroke();
      g.fillStyle = '#4fc0ff'; g.beginPath(); g.moveTo(116, 14); g.quadraticCurveTo(127, 38, 116, 42); g.quadraticCurveTo(105, 38, 116, 14); g.fill();
    } else if (kind === 'stun') {
      g.lineWidth = 4;
      for (const x of [42, 86]) { g.beginPath(); for (let a = 0; a < 14; a += 0.3) g.lineTo(x + Math.cos(a) * a * 1.1, 56 + Math.sin(a) * a * 1.1); g.stroke(); }
      g.lineWidth = 5; g.beginPath(); g.moveTo(44, 92); for (let i = 0; i <= 8; i++) g.lineTo(44 + i * 5, 92 + (i % 2 ? -5 : 5)); g.stroke();
    } else if (kind === 'happy') {
      g.lineWidth = 7; g.beginPath(); g.arc(42, 62, 11, 1.1 * PI, 1.9 * PI); g.stroke(); g.beginPath(); g.arc(86, 62, 11, 1.1 * PI, 1.9 * PI); g.stroke();
      cheek();
      g.fillStyle = '#9b1d3c'; g.beginPath(); g.arc(64, 78, 20, 0, PI); g.closePath(); g.fill();
      g.fillStyle = '#ff7a9a'; g.beginPath(); g.arc(64, 92, 9, 0, PI); g.fill();
    } else if (kind === 'dead') {
      g.lineWidth = 7;
      for (const x of [42, 86]) { g.beginPath(); g.moveTo(x - 10, 46); g.lineTo(x + 10, 66); g.moveTo(x + 10, 46); g.lineTo(x - 10, 66); g.stroke(); }
      g.lineWidth = 5; g.beginPath(); g.moveTo(48, 92); g.lineTo(80, 92); g.stroke();
    }
  })));
  R.faces = { run: face('run'), jump: face('jump'), scared: face('scared'), stun: face('stun'), happy: face('happy'), dead: face('dead') };

  R.backTex = share(ctex(canvas(64, 96, (g, w, h) => {
    g.fillStyle = 'rgba(30,20,48,.35)'; g.fillRect(8, h / 2 - 2, w - 16, 4);
    g.fillStyle = '#1b1430';
    const pip = (x, y) => { g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); };
    pip(32, 24); pip(18, 64); pip(46, 78);
  })));
  R.arrowTex = share(ctex(canvas(64, 64, (g) => {
    g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(14, 40); g.lineTo(32, 22); g.lineTo(50, 40); g.stroke();
  }), true, true));
  R.beltTex = share(ctex(canvas(64, 64, (g) => {
    g.fillStyle = '#4b4f5e'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#5c6172'; for (let i = 0; i < 4; i++) g.fillRect(i * 16, 0, 8, 64);
    g.strokeStyle = '#ffd84a'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(24, 16); g.lineTo(42, 32); g.lineTo(24, 48); g.stroke();
  }), true, true));
  R.noteTex = share(ctex(canvas(64, 64, (g) => {
    g.fillStyle = '#fff'; g.font = 'bold 50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', 32, 36);
  })));
  R.noteTile = share(ctex(canvas(64, 64, (g) => {
    g.fillStyle = '#9d6bff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#b994ff'; g.fillRect(4, 4, 56, 56);
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', 32, 34);
  })));
  R.crateTex = share(ctex(canvas(64, 64, (g) => {
    g.fillStyle = '#c98a4b'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#a86b33'; for (let i = 0; i < 4; i++) g.fillRect(0, i * 16 + 14, 64, 2);
    g.strokeStyle = '#7a4a1f'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58);
    g.beginPath(); g.moveTo(6, 6); g.lineTo(58, 58); g.stroke();
  })));
  R.starTex = share(ctex(canvas(64, 128, (g) => {
    g.fillStyle = '#ffcc33'; g.fillRect(0, 0, 64, 128);
    g.strokeStyle = '#fff2a8'; g.lineWidth = 4; g.strokeRect(4, 4, 56, 120);
    g.fillStyle = '#fff'; starPath(g, 32, 64, 24, 10); g.fill();
  })));
  R.crackTex = share(ctex(canvas(64, 64, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#d8d0c8';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.fillRect(c * 22 + (r % 2 ? 11 : 0) - 9, r * 16 + 2, 19, 12);
    g.strokeStyle = '#3a2e2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(30, 0); g.lineTo(26, 20); g.lineTo(38, 30); g.lineTo(28, 46); g.lineTo(34, 64); g.moveTo(38, 30); g.lineTo(54, 36); g.stroke();
  })));
  R.dotTex = share(ctex(canvas(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  })));
  R.stripeTex = share(ctex(canvas(128, 16, (g) => {
    const cs = ['#ff4f6d', '#ffd23f', '#3fd0ff', '#7bff6b', '#ff8a3f', '#c77dff'];
    for (let i = 0; i < 12; i++) { g.fillStyle = cs[i % cs.length]; g.fillRect(i * 128 / 12, 0, 128 / 12 + 1, 16); }
  })));
  R.ballTex = share(ctex(canvas(64, 32, (g) => {
    g.fillStyle = '#6b6f80'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#ff5a5a'; g.fillRect(0, 12, 64, 8);
  })));
}

function skyTexture(top, bottom, dark) {
  return ctex(canvas(8, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(0.62, bottom); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
    if (dark) { g.fillStyle = 'rgba(255,255,255,.8)'; }
  }));
}
function labelTexture(text, bg, small) {
  return ctex(canvas(256, 128, (g) => {
    g.fillStyle = bg; g.globalAlpha = 0.78; g.fillRect(0, 0, 256, 128); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 8; g.strokeRect(6, 6, 244, 116);
    g.font = '900 ' + (small ? 64 : 84) + 'px "Hiragino Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,.45)'; g.strokeText(text, 128, 70); g.fillStyle = '#fff'; g.fillText(text, 128, 70);
  }));
}

// ---------------------------------------------------------------- 形を まとめて作る道具
class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.ix = []; }
  quad(a, b, c, d, nrm, cols, uvs) {
    const o = this.p.length / 3;
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const flip = cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0;
    const vs = [a, b, c, d];
    for (let k = 0; k < 4; k++) {
      const v = vs[k], cc = Array.isArray(cols) ? cols[k] : cols, uv = uvs ? uvs[k] : [0, 0];
      this.p.push(v[0], v[1], v[2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(cc.r, cc.g, cc.b); this.u.push(uv[0], uv[1]);
    }
    if (flip) this.ix.push(o, o + 2, o + 1, o, o + 3, o + 2); else this.ix.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  // sim の座標で書く(x0..x1, z0..z1)
  top(x0, z0, x1, z1, y, cols, uvs) { this.quad([x0, y, -z0], [x1, y, -z0], [x1, y, -z1], [x0, y, -z1], [0, 1, 0], cols, uvs || [[0, 0], [1, 0], [1, 1], [0, 1]]); }
  sideX(x, z0, z1, y0, y1, nx, cT, cB) { this.quad([x, y1, -z0], [x, y1, -z1], [x, y0, -z1], [x, y0, -z0], [nx, 0, 0], [cT, cT, cB, cB]); }
  sideZ(z, x0, x1, y0, y1, nz, cT, cB) { this.quad([x0, y1, -z], [x1, y1, -z], [x1, y0, -z], [x0, y0, -z], [0, 0, -nz], [cT, cT, cB, cB]); }
  box(x0, y0, z0, x1, y1, z1, cTop, cSide, cBot) {
    const b = cBot || cSide;
    this.top(x0, z0, x1, z1, y1, cTop);
    this.sideX(x0, z0, z1, y0, y1, -1, cSide, b); this.sideX(x1, z0, z1, y0, y1, 1, cSide, b);
    this.sideZ(z0, x0, x1, y0, y1, -1, cSide, b); this.sideZ(z1, x0, x1, y0, y1, 1, cSide, b);
  }
  build() {
    if (!this.ix.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.ix); g.computeBoundingSphere();
    return g;
  }
}

function toothShape(r1, r2, n) {
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, b = (i + 0.5) / n * TAU;
    const pts = [[a, r2], [a + 0.08, r1], [b, r1], [b + 0.08, r2]];
    for (let k = 0; k < pts.length; k++) { const [ang, r] = pts[k]; if (i === 0 && k === 0) s.moveTo(Math.cos(ang) * r, Math.sin(ang) * r); else s.lineTo(Math.cos(ang) * r, Math.sin(ang) * r); }
  }
  s.closePath();
  return s;
}
function starShape(r1, r2) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? r2 : r1, a = PI / 2 + i * PI / 5; if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  s.closePath();
  return s;
}

// ---------------------------------------------------------------- ドミノの材料(白い点を シェーダーで)
function makeDomMat(look, pipHex, baseHex, glow) {
  const opt = { color: baseHex || 0xffffff, map: R.pipTex, shininess: 70, specular: 0x4a4a4a };
  if (look === 'wood') { opt.shininess = 6; opt.specular = 0x111111; }
  else if (look === 'gold') { opt.shininess = 90; opt.specular = 0xffe7a0; }
  else if (look === 'candy') { opt.shininess = 45; opt.specular = 0x999999; }
  else if (look === 'glass') { opt.shininess = 120; opt.specular = 0xffffff; opt.transparent = true; opt.opacity = 0.74; }
  else if (look === 'neon') { opt.shininess = 30; opt.specular = 0x333333; }
  const m = new THREE.MeshPhongMaterial(opt);
  const u = { pipCol: { value: new THREE.Color(pipHex || '#ffffff') }, uGlow: { value: glow || (look === 'neon' ? 0.55 : 0) } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.pipCol = u.pipCol; sh.uniforms.uGlow = u.uGlow;
    sh.fragmentShader = 'uniform vec3 pipCol;\nuniform float uGlow;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', 'vec4 pipS = vec4(0.0);\n#ifdef USE_MAP\n\tpipS = texture2D( map, vMapUv );\n#endif')
      .replace('#include <color_fragment>', [
        '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )',
        '\tdiffuseColor *= vColor;',
        '#endif',
        'diffuseColor.rgb *= 1.0 - 0.32 * pipS.g;',
        'diffuseColor.rgb = mix( diffuseColor.rgb, pipCol, pipS.r );',
        'totalEmissiveRadiance += diffuseColor.rgb * uGlow;'
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'dom3d' + (opt.transparent ? 't' : '');
  return m;
}
function domGeometry(w, h, t) {
  const g = new THREE.BoxGeometry(w, h, t);
  g.translate(0, h / 2, t / 2);               // 前の下の角(z = 0、y = 0)が 回る軸
  const uv = g.attributes.uv;
  for (let i = 0; i < 16; i++) uv.setXY(i, 0.012, 0.006);   // 横・上・下の面は 点なし
  uv.needsUpdate = true;
  return g;
}

// 着せかえ
function currentSkin() {
  let id = 'classic';
  try { id = DOM.Save.data.skin || 'classic'; } catch (e) {}
  const list = DOM.SKINS || [];
  let sk = null;
  for (const s of list) if (s.id === id) sk = s;
  return sk || list[0] || { id: 'classic', colors: 'rainbow', pip: '#ffffff', look: 'gloss' };
}

// ---------------------------------------------------------------- 粒(ほこり・光)
const PART_VS = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying vec3 vC; varying float vA; uniform float uScale;
void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aAlpha <= 0.0 ? 0.0 : aSize * uScale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }`;
const PART_FS = `
varying vec3 vC; varying float vA; uniform float uSoft;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;
  float a = vA * mix(1.0, 1.0 - r, uSoft) * (uSoft > 0.5 ? 1.0 : smoothstep(1.0, 0.7, r)); gl_FragColor = vec4(vC, a); }`;

class Parts {
  constructor(n, additive) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.grow = new Float32Array(n); this.a0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha);
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 400 }, uSoft: { value: additive ? 1 : 0 } }, vertexShader: PART_VS, fragmentShader: PART_FS,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5;
    this.live = 0;
  }
  // sim の座標で(z は前が +)
  emit(x, y, z, vx, vy, vz, life, size, rgb, grav = 0, drag = 0, grow = 0, alpha = 1) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = -z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = -vz;
    this.col[i * 3] = rgb[0]; this.col[i * 3 + 1] = rgb[1]; this.col[i * 3 + 2] = rgb[2];
    this.life[i] = life; this.max[i] = life; this.s0[i] = size; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.a0[i] = alpha;
    this.size[i] = size; this.alpha[i] = alpha; this.live = 2;
  }
  burst(x, y, z, n, speed, life, size, rgb, grav = 6, up = 2) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, e = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.6), h = Math.sqrt(1 - e * e);
      this.emit(x, y, z, Math.cos(a) * h * s, e * s + up, Math.sin(a) * h * s, life * (0.6 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.6), rgb, grav, 1.5);
    }
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.aAlpha.needsUpdate = true; }
  update(dt) {
    if (!this.live) return;
    let any = 0;
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      any = 1;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      V[i * 3] *= dr; V[i * 3 + 1] = (V[i * 3 + 1] - this.grav[i] * dt) * dr; V[i * 3 + 2] *= dr;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.alpha[i] = this.life[i] <= 0 ? 0 : this.a0[i] * Math.min(1, k * 3.5);
      this.size[i] = this.s0[i] * (this.grow[i] ? 1 + (1 - k) * this.grow[i] : 0.5 + 0.5 * k);
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
    if (!any) this.live = Math.max(0, this.live - 1);
  }
}

// 紙ふぶき・かけら(InstancedMesh)
class Bits {
  constructor(n, geo, mat, opts) {
    this.n = n; this.i = 0; this.o = opts;
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    this.mesh.castShadow = !!opts.shadow;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.r = new Float32Array(n * 3); this.w = new Float32Array(n * 3);
    this.s = new Float32Array(n * 3); this.life = new Float32Array(n); this.ph = new Float32Array(n);
    this.live = false;
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  }
  spawn(x, y, z, vx, vy, vz, sx, sy, sz, rgb, life) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.p.set([x, y, -z], i * 3); this.v.set([vx, vy, -vz], i * 3);
    this.r.set([rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)], i * 3); this.w.set([rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)], i * 3);
    this.s.set([sx, sy, sz], i * 3); this.life[i] = life; this.ph[i] = Math.random() * TAU;
    this.mesh.instanceColor.setXYZ(i, rgb[0], rgb[1], rgb[2]); this.mesh.instanceColor.needsUpdate = true;
    this.live = true;
  }
  clear() { this.life.fill(0); this.live = true; this.update(0); }
  update(dt, floorAt) {
    if (!this.live) return;
    let any = false;
    const P = this.p, V = this.v, Rr = this.r, W = this.w, o = this.o;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) { if (this.s[j] !== 0) { this.s[j] = 0; this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); } continue; }
      any = true;
      this.life[i] -= dt;
      if (o.flutter) {
        V[j + 1] = Math.max(V[j + 1] - 9 * dt, -1.6); V[j] *= 1 - 1.6 * dt; V[j + 2] *= 1 - 1.6 * dt;
        this.ph[i] += dt * 5; V[j] += Math.sin(this.ph[i]) * 3 * dt;
      } else V[j + 1] -= 16 * dt;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      Rr[j] += W[j] * dt; Rr[j + 1] += W[j + 1] * dt; Rr[j + 2] += W[j + 2] * dt;
      if (!o.flutter && P[j + 1] < this.s[j + 1] * 0.5 && V[j + 1] < 0 && (!floorAt || floorAt(P[j], -P[j + 2]))) {
        P[j + 1] = this.s[j + 1] * 0.5; V[j + 1] *= -0.3; V[j] *= 0.6; V[j + 2] *= 0.6; W[j] *= 0.5; W[j + 1] *= 0.5; W[j + 2] *= 0.5;
      }
      const k = this.life[i] < 0.4 ? Math.max(0, this.life[i] / 0.4) : 1;
      tmpE.set(Rr[j], Rr[j + 1], Rr[j + 2]); tmpQ.setFromEuler(tmpE);
      tmpP.set(P[j], P[j + 1], P[j + 2]); tmpS.set(this.s[j] * k + 1e-4, this.s[j + 1] * k + 1e-4, this.s[j + 2] * k + 1e-4);
      this.mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!any) this.live = false;
  }
}

// ---------------------------------------------------------------- 主人公「ドミくん」
function makePlayer() {
  const root = new THREE.Group();
  const legs = new THREE.Group(); root.add(legs);
  const body = new THREE.Group(); root.add(body);
  const bw = 0.56, bh = 0.84, bt = 0.3, legH = 0.26;
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60, specular: 0x3a3a3a, emissive: 0x000000 });
  const bm = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bt), bodyMat); bm.position.y = legH + bh / 2; bm.castShadow = true; body.add(bm);
  const faceMat = new THREE.MeshBasicMaterial({ map: R.faces.run, transparent: true });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), faceMat); face.rotation.y = PI; face.position.set(0, legH + bh * 0.62, -bt / 2 - 0.003); body.add(face);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.7), new THREE.MeshBasicMaterial({ map: R.backTex, transparent: true }));
  back.position.set(0, legH + bh / 2, bt / 2 + 0.003); body.add(back);
  const limbMat = new THREE.MeshPhongMaterial({ color: 0x2b2a55, shininess: 20 });
  const shoeMat = new THREE.MeshPhongMaterial({ color: 0xff4f6d, shininess: 40 });
  const legGeo = new THREE.CapsuleGeometry(0.065, 0.14, 3, 8);
  const shoeGeo = new THREE.BoxGeometry(0.16, 0.08, 0.22);
  const legL = new THREE.Group(), legR = new THREE.Group();
  for (const [lg, x] of [[legL, -0.13], [legR, 0.13]]) {
    lg.position.set(x, legH, 0);
    const m = new THREE.Mesh(legGeo, limbMat); m.position.y = -0.12; m.castShadow = true; lg.add(m);
    const s = new THREE.Mesh(shoeGeo, shoeMat); s.position.set(0, -0.23, -0.04); s.castShadow = true; lg.add(s);
    legs.add(lg);
  }
  const armGeo = new THREE.CapsuleGeometry(0.055, 0.2, 3, 8);
  const armL = new THREE.Group(), armR = new THREE.Group();
  for (const [ag, x] of [[armL, -bw / 2 - 0.06], [armR, bw / 2 + 0.06]]) {
    ag.position.set(x, legH + bh * 0.62, 0);
    const m = new THREE.Mesh(armGeo, bodyMat); m.position.y = -0.14; m.castShadow = true; ag.add(m);
    body.add(ag);
  }
  // しびれの星
  const stars = new THREE.Group(); stars.position.y = legH + bh + 0.28; body.add(stars);
  const sg = new THREE.ExtrudeGeometry(starShape(0.13, 0.055), { depth: 0.04, bevelEnabled: false });
  const sm = new THREE.MeshBasicMaterial({ color: 0xffe14a });
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(sg, sm); s.position.set(Math.cos(i * TAU / 3) * 0.36, 0, Math.sin(i * TAU / 3) * 0.36); stars.add(s); }
  stars.visible = false;
  // お助けの泡
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.78, 20, 14), new THREE.MeshBasicMaterial({ color: 0x7ff3ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  bubble.position.y = 0.66; bubble.visible = false; root.add(bubble);
  root.traverse((o) => { if (o.geometry) share(o.geometry); if (o.material) share(o.material); });
  return { root, legs, body, bodyMat, face, faceMat, legL, legR, armL, armR, stars, bubble, phase: 0, yaw: 0, look: 0, squash: 0, sx: 1, sy: 1, bounce: 0, faceKind: 'run', spin: 0 };
}

// ---------------------------------------------------------------- init
function supported() {
  try {
    if (!window.WebGL2RenderingContext) return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return !!gl;
  } catch (e) { return false; }
}

function init(b) {
  DOM = window.DOMINO; CFG = DOM.CONFIG;
  box = b;
  maxPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer = new THREE.WebGLRenderer({ antialias: maxPR < 1.5, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(maxPR); pixelRatio = maxPR;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const cv = renderer.domElement;
  cv.className = 'view3d';
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  box.appendChild(cv);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 220);
  makeTextures();

  R.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.9); scene.add(R.hemi);
  R.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  R.sun.castShadow = true;
  R.sun.shadow.mapSize.set(1024, 1024);
  const sc = R.sun.shadow.camera; sc.left = -11; sc.right = 11; sc.top = 13; sc.bottom = -13; sc.near = 1; sc.far = 50;
  R.sun.shadow.bias = -0.0015; R.sun.shadow.normalBias = 0.02;
  scene.add(R.sun); scene.add(R.sun.target);
  R.lamp = new THREE.PointLight(0xfff0c8, 0, 13, 1.4);     // 夜の遺跡で 主人公のまわりだけ明るく

  R.domGeo = share(domGeometry(CFG.DOM_W, CFG.DOM_H, CFG.DOM_T));
  R.player = makePlayer(); scene.add(R.player.root);
  R.dust = new Parts(420, false); scene.add(R.dust.pts);
  R.glow = new Parts(520, true); scene.add(R.glow.pts);
  R.confetti = new Bits(220, share(new THREE.PlaneGeometry(0.2, 0.11)), share(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })), { flutter: true });
  scene.add(R.confetti.mesh);
  R.debris = new Bits(180, share(new THREE.BoxGeometry(1, 1, 1)), share(new THREE.MeshLambertMaterial({ color: 0xffffff })), { shadow: true });
  scene.add(R.debris.mesh);
  R.notes = [];
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Sprite(share(new THREE.SpriteMaterial({ map: R.noteTex, color: 0xffffff, transparent: true, depthWrite: false })));
    sp.scale.set(0.8, 0.8, 1); sp.visible = false; sp.userData.t = 0; scene.add(sp); R.notes.push(sp);
  }
  R.noteI = 0;
  // 切れた所の印
  R.mark = new THREE.Mesh(share(new THREE.TorusGeometry(0.5, 0.07, 8, 28)), share(new THREE.MeshBasicMaterial({ color: 0xff3048 })));
  R.mark.rotation.x = -PI / 2; R.mark.visible = false; scene.add(R.mark);
  [R.dust.pts, R.glow.pts].forEach((o) => { share(o.geometry); share(o.material); });
  share(R.confetti.mesh); share(R.debris.mesh);
  scene.background = new THREE.Color('#9fdcff');
  resize();
}

// ---------------------------------------------------------------- ステージを作る
function disposeObj(o) {
  o.traverse((c) => {
    if (c.geometry && !shared.has(c.geometry)) c.geometry.dispose();
    if (c.material) {
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of ms) {
        if (shared.has(m)) continue;
        for (const k of ['map', 'emissiveMap', 'alphaMap']) if (m[k] && !shared.has(m[k])) m[k].dispose();
        m.dispose();
      }
    }
    if (c.isInstancedMesh && !shared.has(c)) c.dispose();
  });
}
function disposeStage() {
  if (!S) return;
  scene.remove(S.grp); disposeObj(S.grp);
  for (const t of S.texs) t.dispose();
  if (S.sky) S.sky.dispose();
  if (S.domMat) S.domMat.dispose();
  if (S.lampOn) scene.remove(R.lamp);
  S = null;
}

function setSim(s, st) {
  RP = null;
  sim = s; stageObj = st || (s && s.stage);
  if (!renderer || !sim) return;
  DOM = window.DOMINO; CFG = DOM.CONFIG;
  buildStage();
  R.dust.clear(); R.glow.clear(); R.confetti.clear(); R.debris.clear();
  R.mark.visible = false;
  for (const n of R.notes) n.visible = false;
  cam.ready = false; cam.fit = 1;
  Q.frames = 0; Q.time = 0;
}

function buildStage() {
  disposeStage();
  const L = sim.level, T = DOM.Level.T, cols = L.cols, rows = L.rows;
  world = (DOM.worldOf && stageObj) ? DOM.worldOf(stageObj) : (DOM.WORLDS ? DOM.WORLDS[0] : { floor: '#8fd16a', floor2: '#7cc35a', wall: '#c98b5a', sky: '#9fdcff', sky2: '#e9f7ff', accent: '#ff5a8a', finale: 'tower', en: 'park' });
  const grp = new THREE.Group(); scene.add(grp);
  S = { grp, texs: [], items: [], objs: [], specials: [], gates: [], switches: [], weak: [], sinks: [], spikes: null, born: new Float32Array(1024).fill(-9),
    broken: 0, giantHit: false, bigHit: {}, lastSkin: null, cap: 0, bombs: {}, goalConfetti: false, frontAcc: 0, sparkAcc: 0, windAcc: 0, sweatAcc: 0, trailAcc: 0,
    dark: !!world.dark, failShown: false };
  const sea = world.en === 'sea';
  const DEPTH = sea ? 1.6 : 3.2;
  const cF = new THREE.Color(world.floor), cF2 = new THREE.Color(world.floor2);
  const cSideT = cF2.clone().multiplyScalar(0.62), cSideB = cF2.clone().multiplyScalar(0.28);
  const cWall = new THREE.Color(world.wall), cWallT = cWall.clone().lerp(new THREE.Color('#ffffff'), 0.28);
  const cMud = new THREE.Color('#8a5a32'), cMud2 = new THREE.Color('#7a4c28');
  const cIce = new THREE.Color('#cfefff'), cBoost = new THREE.Color(world.accent).lerp(new THREE.Color('#ff9a2f'), 0.4);
  const cSpike = cF2.clone().lerp(new THREE.Color('#ff5a6a'), 0.35), cSpring = new THREE.Color('#6be36b');
  const cBlack = new THREE.Color('#1d1a26'), cWhite = new THREE.Color('#ffffff');
  const cRim = cF.clone().lerp(cWhite, 0.55);
  const gColors = [null, '#ffc21a', '#2fd5ff', '#ff4fd8'];
  const solid = (c, r) => { if (c < 0 || c >= cols || r < 0) return false; if (r >= rows) return c >= 0 && c < cols; const t = L.cell[r * cols + c]; return t !== T.HOLE && t !== T.SINK; };
  const gb = new GB(), gbWall = new GB(), gbIce = new GB(), gbBoost = new GB(), gbBelt = new GB(), gbNote = new GB();
  const gateGB = {}, spikePos = [];
  const noteCells = {};
  for (const sp of sim.specials) if (sp.t === 'note') noteCells[Math.floor(sp.z) * cols + Math.floor(sp.x + cols / 2)] = 1;

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, t = L.cell[i];
    if (!solid(c, r)) continue;
    const x0 = c - cols / 2, x1 = x0 + 1, z0 = r, z1 = r + 1;
    let col = ((r + c) % 2) ? cF : cF2;
    if (t === T.MUD) col = ((r + c) % 2) ? cMud : cMud2;
    else if (t === T.ICE) col = cIce;
    else if (t === T.BOOST) col = cBoost;
    else if (t === T.BELT_L || t === T.BELT_R) col = new THREE.Color('#4b4f5e');
    else if (t === T.SPIKE) col = cSpike;
    else if (t === T.SPRING) col = cSpring;
    if (r === L.goalZ) {
      for (let a = 0; a < 2; a++) for (let b2 = 0; b2 < 2; b2++) gb.top(x0 + a * 0.5, z0 + b2 * 0.5, x0 + a * 0.5 + 0.5, z0 + b2 * 0.5 + 0.5, 0, (a + b2 + c) % 2 ? cBlack : cWhite);
    } else gb.top(x0, z0, x1, z1, 0, col);
    if (!solid(c - 1, r)) gb.box(x0, 0, z0, x0 + 0.07, 0.035, z1, cRim, cRim, cRim);
    if (!solid(c + 1, r)) gb.box(x1 - 0.07, 0, z0, x1, 0.035, z1, cRim, cRim, cRim);
    if (!solid(c - 1, r)) gb.sideX(x0, z0, z1, -DEPTH, 0, -1, cSideT, cSideB);
    if (!solid(c + 1, r)) gb.sideX(x1, z0, z1, -DEPTH, 0, 1, cSideT, cSideB);
    if (!solid(c, r - 1)) gb.sideZ(z0, x0, x1, -DEPTH, 0, -1, cSideT, cSideB);
    if (!solid(c, r + 1)) gb.sideZ(z1, x0, x1, -DEPTH, 0, 1, cSideT, cSideB);
    if (t === T.WALL && !L.weak[i]) {
      const k = 0.92 + ((c * 7 + r * 13) % 5) * 0.03;
      gbWall.box(x0, 0, z0, x1, 1.15, z1, cWallT.clone().multiplyScalar(k), cWall.clone().multiplyScalar(k), cWall.clone().multiplyScalar(k * 0.6));
    } else if (t === T.WALL && L.weak[i]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.15, 0.98), new THREE.MeshLambertMaterial({ color: cWall.clone().lerp(cWhite, 0.45), map: R.crackTex }));
      m.position.set(x0 + 0.5, 0.575, -(z0 + 0.5)); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      S.weak.push({ mesh: m, i, x: x0 + 0.5, z: z0 + 0.5, gone: false });
    } else if (t === T.GATE) {
      const g = L.group[i];
      (gateGB[g] = gateGB[g] || new GB());
      const gc = new THREE.Color(gColors[g] || '#ff8f3f');
      gateGB[g].box(x0 + 0.04, 0, z0 + 0.12, x1 - 0.04, 1.15, z1 - 0.12, gc.clone().lerp(cWhite, 0.3), (c % 2) ? gc : gc.clone().multiplyScalar(0.55));
    } else if (t === T.SWITCH) {
      const g = L.group[i];
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.16, 18), new THREE.MeshPhongMaterial({ color: gColors[g] || '#ffd23f', emissive: gColors[g] || '#ffd23f', emissiveIntensity: 0.25, shininess: 60 }));
      m.position.set(x0 + 0.5, 0.06, -(z0 + 0.5)); m.castShadow = true; grp.add(m);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 18), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      base.position.set(x0 + 0.5, 0.02, -(z0 + 0.5)); grp.add(base);
      S.switches.push({ mesh: m, g });
    } else if (t === T.ICE) gbIce.top(x0 + 0.02, z0 + 0.02, x1 - 0.02, z1 - 0.02, 0.008, cWhite);
    else if (t === T.BOOST) gbBoost.top(x0 + 0.08, z0, x1 - 0.08, z1, 0.012, cWhite);
    else if (t === T.BELT_L) gbBelt.top(x0, z0, x1, z1, 0.008, cWhite, [[1, 0], [0, 0], [0, 1], [1, 1]]);
    else if (t === T.BELT_R) gbBelt.top(x0, z0, x1, z1, 0.008, cWhite);
    else if (t === T.SPIKE) { for (let a = 0; a < 2; a++) for (let b2 = 0; b2 < 2; b2++) spikePos.push([x0 + 0.27 + a * 0.46, z0 + 0.27 + b2 * 0.46]); }
    else if (t === T.SPRING) {
      const pad = new THREE.Group();
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 18), new THREE.MeshPhongMaterial({ color: 0xcfd6e0, shininess: 80 }));
      coil.rotation.x = PI / 2; coil.position.y = 0.08; pad.add(coil);
      const coil2 = coil.clone(); coil2.position.y = 0.18; pad.add(coil2);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 20), new THREE.MeshPhongMaterial({ color: 0xff4f6d, shininess: 50 }));
      plate.position.y = 0.26; pad.add(plate);
      pad.position.set(x0 + 0.5, 0, -(z0 + 0.5)); grp.add(pad);
      S.springs = S.springs || []; S.springs.push({ pad, plate, z: z0 + 0.5, x: x0 + 0.5, t: 9 });
    }
    if (noteCells[i]) gbNote.top(x0 + 0.06, z0 + 0.06, x1 - 0.06, z1 - 0.06, 0.01, cWhite);
  }
  // ゴールの先の広場
  const PZ = rows, PL = 26, PW = 7;
  for (let z = PZ; z < PZ + PL; z += 2) for (let x = -PW; x < PW; x += 2) gb.top(x, z, x + 2, z + 2, 0, ((x + z) / 2) % 2 ? cF : cF2);
  gb.sideX(-PW, PZ, PZ + PL, -DEPTH, 0, -1, cSideT, cSideB); gb.sideX(PW, PZ, PZ + PL, -DEPTH, 0, 1, cSideT, cSideB);
  gb.sideZ(PZ + PL, -PW, PW, -DEPTH, 0, 1, cSideT, cSideB);
  gb.sideZ(PZ, -PW, -cols / 2, -DEPTH, 0, -1, cSideT, cSideB); gb.sideZ(PZ, cols / 2, PW, -DEPTH, 0, -1, cSideT, cSideB);

  const floorMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const floor = new THREE.Mesh(gb.build(), floorMat); floor.receiveShadow = true; grp.add(floor);
  const wg = gbWall.build();
  if (wg) { const w = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ vertexColors: true })); w.castShadow = true; w.receiveShadow = true; grp.add(w); }
  const ig = gbIce.build();
  if (ig) grp.add(new THREE.Mesh(ig, new THREE.MeshPhongMaterial({ color: 0xe8f8ff, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.55 })));
  const bg = gbBoost.build();
  if (bg) { S.boostMat = new THREE.MeshBasicMaterial({ map: R.arrowTex, color: 0xfff3a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); grp.add(new THREE.Mesh(bg, S.boostMat)); }
  const blg = gbBelt.build();
  if (blg) { const m = new THREE.Mesh(blg, new THREE.MeshLambertMaterial({ map: R.beltTex })); m.receiveShadow = true; grp.add(m); }
  const ng = gbNote.build();
  if (ng) { S.noteMat = new THREE.MeshLambertMaterial({ map: R.noteTile, emissive: 0x6a3cff, emissiveIntensity: 0 }); const m = new THREE.Mesh(ng, S.noteMat); m.receiveShadow = true; grp.add(m); }
  for (const g in gateGB) {
    const m = new THREE.Mesh(gateGB[g].build(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: gColors[g] || '#ff8f3f', emissiveIntensity: 0.15 }));
    m.castShadow = true; grp.add(m); S.gates.push({ mesh: m, g: +g, dust: false });
  }
  if (spikePos.length) {
    const sm = new THREE.InstancedMesh(new THREE.ConeGeometry(0.13, 0.42, 6), new THREE.MeshPhongMaterial({ color: 0xd8dde8, shininess: 90, specular: 0xffffff }), spikePos.length);
    spikePos.forEach((p, k) => sm.setMatrixAt(k, tmpM.makeTranslation(p[0], 0.21, -p[1])));
    sm.castShadow = true; grp.add(sm);
  }
  // しずむ床(行ごとに 1つ)と 水
  const sinkRows = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (L.cell[r * cols + c] === T.SINK) (sinkRows[r] = sinkRows[r] || []).push(c);
  const cRaft = new THREE.Color('#d9a86a'), cRaft2 = new THREE.Color('#c48f52'), cRaftS = new THREE.Color('#8a5a2c');
  let wz0 = 1e9, wz1 = -1e9;
  for (const r in sinkRows) {
    const g2 = new GB();
    for (const c of sinkRows[r]) {
      const x0 = c - cols / 2;
      for (let k = 0; k < 3; k++) g2.box(x0 + 0.04, -0.22, +r + 0.04 + k * 0.31, x0 + 0.96, 0, +r + 0.04 + k * 0.31 + 0.29, k % 2 ? cRaft : cRaft2, cRaftS);
    }
    const m = new THREE.Mesh(g2.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true; m.castShadow = true; grp.add(m);
    S.sinks.push({ mesh: m, r: +r });
    wz0 = Math.min(wz0, +r); wz1 = Math.max(wz1, +r + 1);
  }
  if (S.sinks.length) {
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(cols, wz1 - wz0), new THREE.MeshPhongMaterial({ color: 0x2f9be0, shininess: 100, specular: 0xffffff, transparent: true, opacity: 0.85 }));
    wm.rotation.x = -PI / 2; wm.position.set(0, -0.32, -(wz0 + wz1) / 2); grp.add(wm); S.water = wm;
  }

  // 景色・空・光
  buildScenery(grp, L);
  applyWorldLook();

  // ドミノ
  const sk = currentSkin(); S.skin = sk;
  S.palette = sk.colors === 'rainbow' || !Array.isArray(sk.colors) ? 'rainbow' : sk.colors.map((h) => new THREE.Color(h));
  S.domMat = makeDomMat(sk.look || 'gloss', sk.pip || '#ffffff', 0xffffff, (sk.look === 'neon' ? 0.55 : 0) + (S.dark ? 0.32 : 0));
  makeDomMesh(1024);
  // 前から倒れてくる列
  if (sim.rivals.length) {
    const rm = makeDomMat('gloss', '#7cf3ff', '#3a2f5c', S.dark ? 0.25 : 0.05);
    const im = new THREE.InstancedMesh(R.domGeo, rm, sim.rivals.length);
    im.castShadow = true; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    grp.add(im); S.rivalMesh = im;
    S.rivalRest = sim.rivals.map((rv, k) => { const nx = sim.rivals[k + 1]; return nx && nx.o === rv.o ? 0.44 : PI / 2; });
  }

  buildItems(grp); buildObjs(grp); buildSpecials(grp);

  // ゴールの大ドミノ
  const gz = L.goalZ + CFG.GIANT_DZ;
  S.giantDef = { x: 0, z: gz, h: CFG.GIANT_H };
  const gW = CFG.DOM_W * 3, gH = CFG.GIANT_H, gT = CFG.DOM_T * 3;
  const giant = new THREE.Mesh(domGeometry(gW, gH, gT), makeDomMat('gloss', '#ffffff', world.accent || '#ff3d7f', 0.06));
  giant.castShadow = true; giant.receiveShadow = true; grp.add(giant); S.giant = giant;
  giant.position.z = -(gz + gT / 2);
  S.finale = buildFinale(world.finale || 'tower', gz);
  grp.add(S.finale.grp);
  // コースの横のはしの柵(sim 側では かべ。L.rail のとき)。はしのマスが床の行だけ、低い柵を置く
  if (L.rail) {
    const segs = [];
    for (let r = 0; r < rows; r++) for (const c of [0, cols - 1]) {
      const t = L.cell[r * cols + c];
      if (t !== T.HOLE) segs.push([c === 0 ? -cols / 2 - 0.08 : cols / 2 + 0.08, r + 0.5]);
    }
    if (segs.length) {
      const rm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.34, 1.0), new THREE.MeshLambertMaterial({ color: world.wall || '#c98b5a' }), segs.length);
      segs.forEach((q, k) => rm.setMatrixAt(k, tmpM.makeTranslation(q[0], 0.17, -q[1])));
      rm.castShadow = true; rm.receiveShadow = true; grp.add(rm);
    }
  }
  // ゴールの旗
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), poleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const flagTex = ctex(canvas(64, 40, (g) => { for (let a = 0; a < 8; a++) for (let b2 = 0; b2 < 5; b2++) { g.fillStyle = (a + b2) % 2 ? '#111' : '#fff'; g.fillRect(a * 8, b2 * 8, 8, 8); } }));
  S.texs.push(flagTex);
  const flagMat = new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide });
  S.flags = [];
  for (const x of [-cols / 2 - 0.25, cols / 2 + 0.25]) {
    const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(x, 1.3 - 0.2, -(L.goalZ + 0.5)); pole.castShadow = true; grp.add(pole);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56, 6, 1), flagMat); f.position.set(x + (x < 0 ? 0.45 : -0.45), 2.1, -(L.goalZ + 0.5)); grp.add(f);
    S.flags.push(f);
  }
}

function makeDomMesh(cap) {
  if (S.domMesh) { S.grp.remove(S.domMesh); S.domMesh.dispose(); }
  const m = new THREE.InstancedMesh(R.domGeo, S.domMat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
  S.grp.add(m); S.domMesh = m; S.cap = cap;
}

function domColor(n, out) {
  const P = S.palette;
  if (P === 'rainbow') return out.setHSL((((n * 0.012) % 1) + 1) % 1, 0.8, 0.56);
  const k = n * 0.05, i = Math.floor(k), f = k - i;
  return out.copy(P[i % P.length]).lerp(P[(i + 1) % P.length], f * f * (3 - 2 * f));
}

// ---------------------------------------------------------------- アイテム・仕掛け・特別なマス
function buildItems(grp) {
  const crateGeo = new THREE.BoxGeometry(0.62, 0.48, 0.62), crateMat = new THREE.MeshLambertMaterial({ map: R.crateTex });
  const miniGeo = new THREE.BoxGeometry(0.13, 0.34, 0.05);
  const miniMats = ['#ff5a5a', '#ffd23f', '#3fd0ff', '#7bff6b', '#c77dff'].map((h) => new THREE.MeshPhongMaterial({ color: h, shininess: 60 }));
  const starGeo = new THREE.BoxGeometry(0.4, 0.78, 0.1), starMat = new THREE.MeshPhongMaterial({ map: R.starTex, color: 0xffffff, emissive: 0x7a5200, shininess: 100, specular: 0xfff0b0 });
  const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.06, 20), coinMat = new THREE.MeshPhongMaterial({ color: 0xffc21a, emissive: 0x5a3a00, shininess: 100, specular: 0xffffff });
  const haloMat = new THREE.SpriteMaterial({ map: R.dotTex, color: 0xffd23f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  sim.items.forEach((it, i) => {
    const g = new THREE.Group();
    let y = 0;
    if (it.t === 'box' || it.t === 'bigbox') {
      const big = it.t === 'bigbox';
      const c = new THREE.Mesh(crateGeo, crateMat); c.position.y = 0.24; c.castShadow = true; g.add(c);
      const n = big ? 5 : 3;
      for (let k = 0; k < n; k++) { const d = new THREE.Mesh(miniGeo, miniMats[k % miniMats.length]); d.position.set(-0.2 + k * (0.4 / (n - 1)), 0.55, 0.05 * (k % 2)); d.rotation.z = (k - (n - 1) / 2) * 0.12; g.add(d); }
      if (big) g.scale.setScalar(1.45);
    } else if (it.t === 'star') {
      const m = new THREE.Mesh(starGeo, starMat); m.position.y = 0.7; m.castShadow = true; g.add(m);
      const h = new THREE.Sprite(haloMat); h.scale.set(1.8, 1.8, 1); h.position.y = 0.7; g.add(h);
      y = 0;
    } else {
      const m = new THREE.Mesh(coinGeo, coinMat); m.rotation.x = PI / 2; m.position.y = 0.5; m.castShadow = true; g.add(m);
    }
    g.position.set(it.x, y, -it.z); grp.add(g);
    S.items.push({ g, it, spin: Math.random() * TAU, gone: false });
  });
}

function buildObjs(grp) {
  const metal = new THREE.MeshPhongMaterial({ color: 0xd0d6e2, shininess: 100, specular: 0xffffff });
  const red = new THREE.MeshPhongMaterial({ color: 0xe8324a, shininess: 40 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2833 });
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a32 });
  sim.objs.forEach((o, i) => {
    const e = { o, kind: o.t };
    if (o.t === 'saw') {
      const g = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(toothShape(0.58, 0.46, 14), { depth: 0.06, bevelEnabled: false }), metal);
      blade.geometry.translate(0, 0, -0.03); blade.castShadow = true; g.add(blade);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 12), red); hub.rotation.x = PI / 2; g.add(hub);
      grp.add(g); e.g = g; e.blade = blade;
      const slot = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(o.x2 - o.x) + 1.2, 0.02, 0.16), dark);
      slot.position.set((o.x + o.x2) / 2, 0.01, -(o.z + 0.5)); grp.add(slot);
    } else if (o.t === 'ball') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 12), new THREE.MeshPhongMaterial({ map: R.ballTex, shininess: 50 }));
      m.castShadow = true; grp.add(m); e.g = m;
    } else if (o.t === 'hammer') {
      const len = o.len || 3, R0 = Math.max(len, 1) + 0.5, py = R0 + 0.62;
      const frame = new THREE.Group();
      const postGeo = new THREE.BoxGeometry(0.2, py + 0.2, 0.2);
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(postGeo, wood); p.position.set(o.x + sx * (len + 1.0), (py + 0.2) / 2, 0); p.castShadow = true; frame.add(p); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * (len + 1.0) + 0.2, 0.2, 0.2), wood); bar.position.set(o.x, py + 0.1, 0); frame.add(bar);
      frame.position.z = -(o.z + 0.5); grp.add(frame);
      const arm = new THREE.Group(); arm.position.set(o.x, py, -(o.z + 0.5));
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.09, R0, 0.09), metal); rod.position.y = -R0 / 2; arm.add(rod);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 16), red); head.rotation.x = PI / 2; head.position.y = -R0; head.castShadow = true; arm.add(head);
      const cap1 = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.1, 16), metal); cap1.rotation.x = PI / 2; cap1.position.set(0, -R0, 0.5); arm.add(cap1);
      const cap2 = cap1.clone(); cap2.position.z = -0.5; arm.add(cap2);
      grp.add(arm); e.g = arm; e.R = R0;
    } else if (o.t === 'gate' || o.t === 'split') {
      const w = o.w || 3;
      const good = o.t === 'split' ? true : o.op !== '-';
      const text = o.t === 'split' ? '2れつ' : (o.op === 'x' ? '×' : o.op === '+' ? '+' : '−') + o.n;
      const tx = labelTexture(text, o.t === 'split' ? '#a24bff' : good ? '#1f8bff' : '#ff3048', o.t === 'split'); S.texs.push(tx);
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.15, (w - 0.15) * 0.5), new THREE.MeshBasicMaterial({ map: tx, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      panel.position.y = 0.2 + (w - 0.15) * 0.25 + 0.15; g.add(panel);
      const postGeo = new THREE.BoxGeometry(0.14, 1.9, 0.14), postMat = new THREE.MeshLambertMaterial({ color: good ? 0xd6ecff : 0xffd6dc });
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(postGeo, postMat); p.position.set(sx * (w / 2 - 0.07), 0.95, 0); p.castShadow = true; g.add(p); }
      g.position.set(o.x, 0, -(o.z + 0.7)); grp.add(g);
      e.g = g; e.panel = panel; e.good = good; e.fade = 1;
    } else if (o.t === 'wind') {
      // 風: 粒で見せる(updateFX)。横に 小さな のぼり旗
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), new THREE.MeshLambertMaterial({ color: 0x9ad8ff, side: THREE.DoubleSide }));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      const g = new THREE.Group(); pole.position.y = 0.9; g.add(pole); fl.position.set(0.35, 1.6, 0); g.add(fl);
      g.position.set(-DOM.CONFIG.COLS / 2 - 0.3, 0, -(o.z + 0.5)); grp.add(g); e.g = g; e.flag = fl;
    }
    S.objs[i] = e;
  });
}

function buildSpecials(grp) {
  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.34, 0.7, 16);
  const barrelMat = new THREE.MeshPhongMaterial({ color: 0xd8342f, shininess: 40 });
  const bandMat = new THREE.MeshLambertMaterial({ color: 0x2a2228 });
  const bandGeo = new THREE.CylinderGeometry(0.345, 0.345, 0.07, 16);
  sim.specials.forEach((sp, i) => {
    const e = { sp };
    if (sp.t === 'bomb') {
      const g = new THREE.Group();
      const b = new THREE.Mesh(barrelGeo, barrelMat); b.position.y = 0.35; b.castShadow = true; g.add(b);
      for (const y of [0.15, 0.55]) { const bd = new THREE.Mesh(bandGeo, bandMat); bd.position.y = y; g.add(bd); }
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), bandMat); fuse.position.y = 0.8; fuse.rotation.z = 0.3; g.add(fuse);
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: R.dotTex, color: 0xffc04a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      spark.position.set(0.04, 0.92, 0); spark.scale.set(0.4, 0.4, 1); g.add(spark);
      g.position.set(sp.x, 0, -sp.z); grp.add(g); e.g = g; e.spark = spark;
    } else if (sp.t === 'big') {
      const W = 1.0, H = 2.3, Tt = 0.3;
      const m = new THREE.Mesh(domGeometry(W, H, Tt), makeDomMat('gloss', '#ffffff', world.accent || '#ff4f8b', 0.05));
      m.position.set(sp.x, 0, -(sp.z + Tt / 2)); m.castShadow = true; grp.add(m); e.g = m;
    }
    S.specials[i] = e;
  });
}

// ---------------------------------------------------------------- 景色
const PROP = {};
function propGeos() {
  if (PROP.ready) return PROP;
  const sh = (g) => share(g);
  PROP.box = sh(new THREE.BoxGeometry(1, 1, 1)); PROP.box.translate(0, 0.5, 0);
  PROP.sphere = sh(new THREE.SphereGeometry(1, 12, 8));
  PROP.cone = sh(new THREE.ConeGeometry(1, 1, 8)); PROP.cone.translate(0, 0.5, 0);
  PROP.cone4 = sh(new THREE.ConeGeometry(1, 1, 4)); PROP.cone4.translate(0, 0.5, 0); PROP.cone4.rotateY(PI / 4);
  PROP.cyl = sh(new THREE.CylinderGeometry(1, 1, 1, 10)); PROP.cyl.translate(0, 0.5, 0);
  PROP.mount = sh(new THREE.ConeGeometry(1, 1, 7)); PROP.mount.translate(0, 0.5, 0);
  PROP.lit = sh(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  PROP.basic = sh(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  PROP.ready = true;
  return PROP;
}
function buildScenery(grp, L) {
  const P = propGeos();
  const w = world, kind = w.en || 'park';
  const rand = rng((stageObj && stageObj.id || 1) * 977 + 13);
  const r = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const bags = new Map();
  const put = (geo, mat, x, y, z, sx, sy, sz, ry, hex) => {
    const key = geo.uuid + mat.uuid;
    if (!bags.has(key)) bags.set(key, { geo, mat, list: [] });
    bags.get(key).list.push([x, y, z, sx, sy, sz, ry || 0, hex]);
  };
  const z0 = -30, z1 = L.rows + 60;
  const sea = kind === 'sea', sky = kind === 'sky';
  const groundY = sea ? -1.3 : -14;
  // 地面(遠くの下)
  const gcol = { park: '#6fb85a', toy: '#ffd0e4', factory: '#7d8796', sky: '#ffffff', forest: '#2e5a3a', snow: '#eef6ff', festival: '#3a1f4a', sea: '#2a9fd0', ruins: '#1a1c33', castle: '#5a3b7a' }[kind] || w.floor2;
  const gm = sea ? new THREE.MeshPhongMaterial({ color: gcol, shininess: 90, specular: 0x88ccff }) : new THREE.MeshLambertMaterial({ color: gcol });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, z1 - z0 + 300), gm);
  ground.rotation.x = -PI / 2; ground.position.set(0, groundY, -(z0 + z1) / 2); grp.add(ground);
  // 横の だんだん畑(低い台)と 飾り
  const terr = { park: '#7cc35a', toy: '#ffe9a8', factory: '#9aa4b2', forest: '#4f7f3f', snow: '#f7fbff', festival: '#5a2f5e', sea: '#f2dca6', ruins: '#5a5548', castle: '#d6cbe3' }[kind];
  for (let side = -1; side <= 1; side += 2) {
    let z = z0;
    while (z < z1) {
      const len = r(6, 12), wid = r(4, 9);
      if (!sky && terr) {
        const top = sea ? r(-1.1, -0.6) : r(-10, -6);
        const x = side * (L.cols / 2 + 3 + wid / 2 + r(0, 5));
        put(P.box, P.lit, x, groundY, -(z + len / 2), wid, top - groundY, len, 0, new THREE.Color(terr).multiplyScalar(r(0.5, 0.62)).getHex());
        decorate(x, top, z + len / 2, wid, len, side);
      } else if (sky && rand() < 0.5) {
        // 空の島: 浮かぶ小島
        const x = side * r(8, 20), y = r(-8, -2), s = r(1.5, 3.5);
        put(P.cone, P.lit, x, y - s * 1.6, -(z + len / 2), s, s * 1.6, s, 0, 0x9a7a5a);
        put(P.cyl, P.lit, x, y, -(z + len / 2), s, 0.4, s, 0, 0x8fd16a);
        if (rand() < 0.7) tree(x, y + 0.4, z + len / 2, 0.7);
      }
      z += len + r(0.5, 3);
    }
  }
  function tree(x, y, z, s) {
    put(P.cyl, P.lit, x, y, -z, 0.18 * s, 1.4 * s, 0.18 * s, 0, 0x7a4f2a);
    put(P.sphere, P.lit, x, y + 1.9 * s, -z, 1.0 * s, 1.0 * s, 1.0 * s, 0, new THREE.Color(pick(['#5fbf4a', '#4fae3e', '#78cf55'])).getHex());
  }
  function pine(x, y, z, s, snow) {
    put(P.cyl, P.lit, x, y, -z, 0.15 * s, 0.8 * s, 0.15 * s, 0, 0x5a3a20);
    put(P.cone, P.lit, x, y + 0.6 * s, -z, 0.9 * s, 1.6 * s, 0.9 * s, 0, snow ? 0x3f7a55 : 0x2f6b3f);
    put(P.cone, P.lit, x, y + 1.6 * s, -z, 0.65 * s, 1.3 * s, 0.65 * s, 0, snow ? 0xffffff : 0x3a7f4a);
  }
  function decorate(x, top, zc, wid, len) {
    const n = Math.max(1, Math.floor(len / 3.5));
    for (let k = 0; k < n; k++) {
      const px = x + r(-wid / 2 + 0.8, wid / 2 - 0.8), pz = zc - len / 2 + (k + 0.5) * len / n + r(-0.6, 0.6);
      if (kind === 'park') { if (rand() < 0.75) tree(px, top, pz, r(0.8, 1.3)); else put(P.sphere, P.lit, px, top, -pz, 0.7, 0.45, 0.7, 0, 0x5ab84a); }
      else if (kind === 'toy') {
        if (rand() < 0.5) { const h = r(1.5, 3.5), c = pick(['#7f8cff', '#ff7a9a', '#5fd3c8', '#ffb03a']); put(P.box, P.lit, px, top, -pz, 1.6, h, 1.6, 0, new THREE.Color(c).getHex()); put(P.cone4, P.lit, px, top + h, -pz, 1.3, 1.1, 1.3, 0, 0xff5a5a); }
        else put(P.box, P.lit, px, top, -pz, 0.8, 0.8, 0.8, r(0, 1), new THREE.Color(pick(['#ff5a5a', '#ffd23f', '#3fd0ff', '#7bff6b'])).getHex());
      } else if (kind === 'factory') {
        if (rand() < 0.5) put(P.cyl, P.lit, px, top, -pz, 0.4, r(3, 6), 0.4, 0, 0x6b7380);
        else put(P.box, P.lit, px, top, -pz, r(1.5, 3), r(1.2, 2.5), r(1.5, 3), 0, 0x8a93a3);
      } else if (kind === 'forest') { pine(px, top, pz, r(1.2, 2.0), false); if (rand() < 0.5) pine(px + r(-1, 1), top, pz + r(-1, 1), r(0.8, 1.4), false); }
      else if (kind === 'snow') { pine(px, top, pz, r(1.0, 1.8), true); }
      else if (kind === 'festival') {
        put(P.cyl, P.lit, px, top, -pz, 0.05, 2.2, 0.05, 0, 0x332233);
        put(P.sphere, P.basic, px, top + 2.2, -pz, 0.3, 0.38, 0.3, 0, new THREE.Color(pick(['#ff8a3f', '#ffcf5c', '#ff3df0'])).getHex());
        if (rand() < 0.4) { put(P.box, P.lit, px + 1, top, -pz, 1.4, 1.2, 1.0, 0, 0xffffff); put(P.cone4, P.lit, px + 1, top + 1.2, -pz, 1.1, 0.6, 0.9, 0, 0xd94f3d); }
      } else if (kind === 'sea') {
        put(P.cyl, P.lit, px, top, -pz, 0.12, 2.4, 0.12, 0, 0x8a6a43);
        put(P.sphere, P.lit, px, top + 2.4, -pz, 0.9, 0.3, 0.9, 0, 0x4fae3e);
      } else if (kind === 'ruins') {
        const h = rand() < 0.4 ? r(0.6, 1.4) : r(2.4, 3.6);
        put(P.cyl, P.lit, px, top, -pz, 0.35, h, 0.35, 0, 0x8a8270);
      } else if (kind === 'castle') {
        if (rand() < 0.5) { const h = r(3, 6); put(P.cyl, P.lit, px, top, -pz, 0.7, h, 0.7, 0, 0xe8e0f0); put(P.cone, P.lit, px, top + h, -pz, 0.9, 1.6, 0.9, 0, 0x7a4fb3); }
        else tree(px, top, pz, 0.9);
      }
    }
  }
  // 遠くの山
  const mcol = { park: '#7fb0d8', toy: '#f7b6d2', factory: '#8f9bb0', sky: '#ffffff', forest: '#2f5a48', snow: '#dfeefc', festival: '#2a1840', sea: '#3d8fb3', ruins: '#141733', castle: '#4a2c6e' }[kind] || '#88a';
  for (let z = z0; z < z1 + 40; z += r(14, 26)) for (const side of [-1, 1]) {
    const h = r(18, 42), s = r(14, 26);
    put(P.mount, P.lit, side * r(45, 80), groundY - 2, -z, s, h, s, r(0, 3), new THREE.Color(mcol).multiplyScalar(r(0.9, 1.1)).getHex());
  }
  // 雲
  if (kind !== 'ruins' && kind !== 'festival' && kind !== 'factory') {
    for (let z = z0; z < z1 + 30; z += r(9, 18)) {
      const side = rand() < 0.5 ? -1 : 1, x = side * r(10, 34), y = sky ? r(-9, 9) : r(5, 14), s = r(1.2, 2.6);
      for (let k = 0; k < 4; k++) put(P.sphere, P.lit, x + (k - 1.5) * s * 0.9, y + (k % 2) * s * 0.3, -(z + r(-1, 1)), s * r(0.8, 1.2), s * 0.7, s * 0.9, 0, 0xffffff);
    }
  }
  for (const b of bags.values()) {
    if (!b.list.length) continue;
    const im = new THREE.InstancedMesh(b.geo, b.mat, b.list.length);
    b.list.forEach((e, k) => {
      tmpE.set(0, e[6], 0); tmpQ.setFromEuler(tmpE); tmpP.set(e[0], e[1], e[2]); tmpS.set(e[3] || 1e-4, e[4] || 1e-4, e[5] || 1e-4);
      im.setMatrixAt(k, tmpM.compose(tmpP, tmpQ, tmpS)); im.setColorAt(k, tmpC.setHex(e[7]));
    });
    im.computeBoundingSphere();
    grp.add(im);
  }
  // 夜空の星
  if (w.dark || kind === 'festival' || kind === 'castle') {
    const n = 400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = rand() * PI - PI / 2, e = r(0.15, 1.2), d = 150; pos[i * 3] = Math.sin(a) * Math.cos(e) * d; pos[i * 3 + 1] = Math.sin(e) * d * 0.6; pos[i * 3 + 2] = -Math.cos(a) * Math.cos(e) * d; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const st = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    st.frustumCulled = false; S.starsSky = st; grp.add(st);
  }
}

function applyWorldLook() {
  const w = world, dark = !!w.dark;
  if (S.sky) S.sky.dispose();
  S.sky = skyTexture(w.sky, w.sky2, dark);
  scene.background = S.sky;
  const fogCol = new THREE.Color(w.sky2).lerp(new THREE.Color(w.sky), 0.35);
  scene.fog = dark ? new THREE.Fog(new THREE.Color(w.sky).getHex(), 10, 42) : new THREE.Fog(fogCol, 38, 120);
  if (w.en === 'festival' || w.en === 'castle') scene.fog = new THREE.Fog(new THREE.Color(w.sky).lerp(new THREE.Color(w.sky2), 0.3), 30, 100);
  R.hemi.color.set(dark ? '#5a6aa8' : '#ffffff'); R.hemi.groundColor.set(dark ? '#1a1830' : new THREE.Color(w.floor2).multiplyScalar(0.7));
  R.hemi.intensity = dark ? 0.32 : w.en === 'festival' ? 1.5 : 1.9;
  R.sun.color.set(dark ? '#9fb4ff' : w.en === 'festival' ? '#ffc8a0' : '#fff4e0');
  R.sun.intensity = dark ? 0.35 : 2.3;
  if (dark) { scene.add(R.lamp); R.lamp.intensity = 45; R.lamp.distance = 15; R.lamp.decay = 1.2; S.lampOn = true; }
}

// ---------------------------------------------------------------- ゴールの大仕掛け
function buildFinale(kind, gz) {
  const grp = new THREE.Group();
  const FZ = gz + 2.8;                   // 大仕掛けの手前のふち(sim の z)
  grp.position.set(0, 0, -FZ);
  const F = { grp, kind, pieces: [], hideOnHit: [], showOnHit: [], spin: [], hit: false, t: 0, smokeT: 0, beam: null, FZ };
  const mats = new Map();
  const M = (hex, opt) => { const k = hex + JSON.stringify(opt || {}); if (!mats.has(k)) mats.set(k, new THREE.MeshPhongMaterial(Object.assign({ color: hex, shininess: 35 }, opt || {}))); return mats.get(k); };
  const mesh = (geo, mat, x, y, zf, o = {}) => {
    const m = new THREE.Mesh(geo, typeof mat === 'string' ? M(mat, o.mat) : mat);
    m.position.set(x, y, -zf); if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.shadow !== false; (o.parent || grp).add(m);
    if (o.piece !== false && !o.parent) piece(m, o);
    return m;
  };
  const piece = (obj, o = {}) => {
    const u = obj.userData;
    u.p0 = obj.position.clone(); u.r0 = obj.rotation.clone(); u.v = new THREE.Vector3(); u.w = new THREE.Vector3();
    u.on = false; u.r = o.r != null ? o.r : 0.3; u.mode = o.mode || 'fly'; u.kick = o.kick || 1; u.delay = o.delay;
    F.pieces.push(obj);
    return obj;
  };
  const group = (x, y, zf, o = {}) => { const g = new THREE.Group(); g.position.set(x, y, -zf); grp.add(g); if (o.piece !== false) piece(g, o); return g; };
  const RB = ['#ff5a5a', '#ffb03a', '#ffe14a', '#5ad15a', '#4ab8ff', '#9a6bff'];
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r1, r2, h, n = 16) => new THREE.CylinderGeometry(r1, r2, h, n);
  const sph = (r, n = 16) => new THREE.SphereGeometry(r, n, Math.max(8, n * 0.6 | 0));

  if (kind === 'tower') {
    const g = box(2.4, 0.6, 0.76), g2 = box(0.76, 0.6, 2.4);
    for (let l = 0; l < 9; l++) for (let k = 0; k < 3; k++) {
      const c = RB[(l * 3 + k) % 6];
      if (l % 2 === 0) mesh(g, c, 0, 0.3 + l * 0.6, 1.2 + (k - 1) * 0.8, { r: 0.3 });
      else mesh(g2, c, (k - 1) * 0.8, 0.3 + l * 0.6, 1.2, { r: 0.3 });
    }
    const st = mesh(new THREE.ExtrudeGeometry(starShape(0.6, 0.26), { depth: 0.18, bevelEnabled: false }), '#ffd23f', 0, 6.0, 1.2, { mat: { emissive: 0x6a4a00 }, r: 0.4 });
    F.spin.push([st, 'y', 1.5]);
  } else if (kind === 'train') {
    const rail = box(12, 0.08, 0.12), railMat = M('#8a8f9a');
    for (const zf of [0.9, 2.1]) mesh(rail, railMat, 0, 0.04, zf, { piece: false, shadow: false });
    const wheel = cyl(0.36, 0.36, 0.16, 14);
    const car = (x, col, engine) => {
      const g = group(x, 0, 1.5, { r: 0.7, kick: 1.2 });
      mesh(box(engine ? 2.6 : 2.4, 0.5, 1.4), '#333040', 0, 0.62, 0, { parent: g });
      if (engine) {
        mesh(cyl(0.62, 0.62, 2.0, 18), col, -0.2, 1.4, 0, { parent: g, rz: PI / 2 });
        mesh(box(1.0, 1.5, 1.4), col, 0.9, 1.55, 0, { parent: g });
        mesh(box(1.2, 0.14, 1.6), '#222', 0.9, 2.35, 0, { parent: g });
        mesh(cyl(0.2, 0.28, 0.8, 12), '#222', -0.8, 2.2, 0, { parent: g });
        mesh(cyl(0.12, 0.12, 0.1, 10), '#ffe14a', -1.24, 1.4, 0, { parent: g, rz: PI / 2, mat: { emissive: 0x806000 } });
        F.chimney = { g, x: -0.8, y: 2.65 };
      } else {
        mesh(box(2.3, 1.0, 1.4), col, 0, 1.35, 0, { parent: g });
      }
      for (const wx of [-0.8, 0.8]) for (const wz of [-0.62, 0.62]) mesh(wheel, '#1e1c26', wx, 0.36, wz, { parent: g, rx: PI / 2 });
      return g;
    };
    car(-3.3, '#e8324a', true); car(-0.4, '#3a7bff'); car(2.3, '#ffb03a');
    for (let k = 0; k < 6; k++) mesh(box(0.5, 0.5, 0.5), RB[k], -0.9 + (k % 3) * 0.55 + (k > 2 ? 2.7 : 0), 2.12, 1.4 + (k % 2) * 0.3, { r: 0.25 });
  } else if (kind === 'machine') {
    const frameM = M('#5b6b80');
    for (const x of [-2.6, 2.6]) mesh(box(0.3, 5, 0.3), frameM, x, 2.5, 1.5, { r: 0.15 });
    mesh(box(5.5, 0.3, 0.3), frameM, 0, 5.0, 1.5, { r: 0.15 });
    const gear = (r, x, y, c, sp) => { const g = mesh(new THREE.ExtrudeGeometry(toothShape(r, r * 0.82, Math.round(r * 12)), { depth: 0.22, bevelEnabled: false }), c, x, y, 1.6, { r: r * 0.5, mat: { shininess: 80 } }); F.spin.push([g, 'z', sp]); return g; };
    gear(1.0, -1.2, 3.4, '#ffb400', 1.2); gear(0.7, 0.55, 3.95, '#ff7a2f', -1.7); gear(0.55, 1.6, 2.6, '#ffd23f', 2.2);
    mesh(box(3.2, 0.14, 0.6), '#9aa4b2', -0.4, 1.2, 1.0, { rz: -0.25, r: 0.1 });
    mesh(sph(0.35), '#e8324a', -1.8, 1.75, 1.0, { r: 0.35, kick: 1.6 });
    for (let k = 0; k < 4; k++) mesh(box(0.55, 0.55, 0.55), RB[k + 1], 1.4 + (k % 2) * 0.6, 0.28 + Math.floor(k / 2) * 0.56, 0.9, { r: 0.28 });
    mesh(cyl(0.25, 0.25, 2.4, 12), '#c0c8d4', 2.0, 1.2, 2.2, { r: 0.25 });
  } else if (kind === 'balloon') {
    const bal = group(0, 0, 1.8, { mode: 'rise', r: 1 });
    const env = mesh(sph(2.0, 24), new THREE.MeshPhongMaterial({ map: R.stripeTex, shininess: 40 }), 0, 5.4, 0, { parent: bal });
    env.scale.set(1, 1.12, 1);
    mesh(cyl(0.6, 0.35, 0.7, 12), '#ffffff', 0, 3.4, 0, { parent: bal });
    mesh(box(1.1, 0.8, 1.1), '#a8743c', 0, 2.2, 0, { parent: bal });
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) mesh(cyl(0.025, 0.025, 1.4, 4), '#5a4030', x * 0.9, 3.0, z * 0.9, { parent: bal });
    const ropeM = M('#e8e0d0');
    for (const x of [-1.6, 1.6]) { const rp = mesh(cyl(0.03, 0.03, 2.6, 4), ropeM, x * 0.5, 1.2, 1.8, { rz: x > 0 ? -0.55 : 0.55, piece: false }); F.hideOnHit.push(rp); }
    for (let k = 0; k < 4; k++) mesh(sph(0.26, 10), '#c9a06a', -1.4 + k * 0.95, 0.26, 0.6 + (k % 2) * 2.2, { r: 0.26 });
  } else if (kind === 'tree') {
    const tr = group(0, 0, 1.4, { mode: 'topple' });
    mesh(cyl(0.42, 0.62, 3.6, 12), '#7a4f2a', 0, 1.8, 0, { parent: tr });
    for (const [x, y, z, s] of [[0, 4.6, 0, 1.9], [-1.1, 3.9, 0.3, 1.3], [1.1, 4.0, -0.2, 1.4], [0.2, 5.6, 0.2, 1.2]]) mesh(sph(s, 14), '#3fa84a', x, y, z, { parent: tr });
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; mesh(sph(0.2, 10), '#ff3b3b', Math.cos(a) * 1.7, 4.0 + Math.sin(k * 1.7) * 0.8, 1.4 + Math.sin(a) * 1.4, { r: 0.2, kick: 1.3 }); }
  } else if (kind === 'snowman') {
    const snow = M('#ffffff', { shininess: 10 });
    mesh(sph(1.25, 20), snow, 0, 1.2, 1.8, { r: 1.2, kick: 0.8 });
    mesh(sph(0.9, 18), snow, 0, 2.95, 1.8, { r: 0.9 });
    mesh(sph(0.62, 16), snow, 0, 4.25, 1.8, { r: 0.62, kick: 1.2 });
    mesh(cyl(0.45, 0.45, 0.7, 14), '#222', 0, 5.15, 1.8, { r: 0.35 });
    mesh(cyl(0.7, 0.7, 0.08, 16), '#222', 0, 4.82, 1.8, { r: 0.05 });
    mesh(new THREE.ConeGeometry(0.12, 0.6, 8), '#ff7a1a', 0, 4.2, 1.2, { rx: -PI / 2, r: 0.1 });
    mesh(new THREE.TorusGeometry(0.62, 0.14, 8, 18), '#e8324a', 0, 3.6, 1.8, { rx: PI / 2, r: 0.14 });
    for (const sx of [-1, 1]) mesh(cyl(0.05, 0.05, 1.6, 5), '#6b4a2f', sx * 1.4, 3.3, 1.8, { rz: sx * 1.0, r: 0.05 });
    for (const sx of [-0.22, 0.22]) mesh(sph(0.07, 8), '#111', sx, 4.4, 1.25, { r: 0.07 });
  } else if (kind === 'fireworks') {
    mesh(box(5, 0.5, 2.4), '#5a2f5e', 0, 0.25, 1.6, { r: 0.25 });
    for (let k = 0; k < 6; k++) {
      const x = -2 + k * 0.8;
      mesh(cyl(0.22, 0.26, 1.2, 12), RB[k], x, 1.1, 1.6 + (k % 2) * 0.5, { r: 0.24 });
      const rk = mesh(new THREE.ConeGeometry(0.18, 0.5, 10), RB[(k + 3) % 6], x, 1.9, 1.6 + (k % 2) * 0.5, { mode: 'rocket', r: 0.2, delay: 0.15 + k * 0.16 });
      rk.userData.col = RB[(k + 2) % 6];
    }
  } else if (kind === 'lighthouse') {
    mesh(cyl(2.2, 2.6, 0.7, 18), '#6b6f80', 0, 0.35, 2.4, { piece: false });
    const segs = 5;
    for (let k = 0; k < segs; k++) { const r1 = 1.2 - (k + 1) * 0.09, r0 = 1.2 - k * 0.09; mesh(cyl(r1, r0, 1.1, 16), k % 2 ? '#ffffff' : '#e8324a', 0, 0.7 + 0.55 + k * 1.1, 2.4, { r: 0.55 }); }
    const topY = 0.7 + segs * 1.1;
    mesh(cyl(1.05, 1.05, 0.12, 16), '#333', 0, topY + 0.06, 2.4, { r: 0.1 });
    const lamp = mesh(cyl(0.5, 0.5, 0.8, 12), new THREE.MeshBasicMaterial({ color: 0xfff2a8 }), 0, topY + 0.5, 2.4, { r: 0.4 });
    mesh(new THREE.ConeGeometry(0.75, 0.8, 16), '#e8324a', 0, topY + 1.3, 2.4, { r: 0.4 });
    const beamG = new THREE.ConeGeometry(1.4, 14, 16, 1, true); beamG.translate(0, -7, 0); beamG.rotateZ(PI / 2);
    const beam = new THREE.Mesh(beamG, new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(0, topY + 0.5, -2.4); grp.add(beam); F.beam = beam; F.hideOnHit.push(beam);
    F.lamp = lamp;
  } else if (kind === 'statue') {
    const stone = M('#8a8270', { shininess: 5 }), stone2 = M('#9a927e', { shininess: 5 });
    mesh(box(3.0, 0.8, 2.4), stone, 0, 0.4, 2.0, { r: 0.4 });
    for (const sx of [-0.5, 0.5]) mesh(box(0.7, 1.6, 0.8), stone2, sx, 1.6, 2.0, { r: 0.4 });
    mesh(box(2.0, 1.8, 1.1), stone, 0, 3.3, 2.0, { r: 0.55 });
    for (const sx of [-1.3, 1.3]) mesh(box(0.55, 1.6, 0.6), stone2, sx, 3.2, 2.0, { r: 0.3 });
    mesh(box(1.3, 1.5, 1.2), stone2, 0, 5.0, 2.0, { r: 0.6 });
    for (const sx of [-0.3, 0.3]) mesh(box(0.22, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0x7cf3ff }), sx, 5.2, 1.38, { r: 0.07 });
    mesh(box(1.5, 0.3, 1.4), stone, 0, 5.9, 2.0, { r: 0.15 });
  } else {   // castle
    const wallM = M('#e8e0f0', { shininess: 10 }), roofM = M('#7a4fb3'), flagM = M('#ffd700', { side: THREE.DoubleSide });
    for (const x of [-2.6, 2.6]) for (const zf of [0.8, 4.0]) {
      mesh(cyl(0.7, 0.75, 3.6, 14), wallM, x, 1.8, zf, { r: 0.7 });
      mesh(new THREE.ConeGeometry(0.95, 1.5, 14), roofM, x, 4.35, zf, { r: 0.5 });
      mesh(new THREE.PlaneGeometry(0.6, 0.35), flagM, x + 0.3, 5.4, zf, { r: 0.1 });
    }
    mesh(box(4.4, 2.4, 0.5), wallM, 0, 1.2, 0.8, { r: 0.25 });
    mesh(box(1.4, 1.5, 0.52), '#3a2a50', 0, 0.75, 0.78, { r: 0.25 });
    mesh(box(2.6, 4.2, 2.2), wallM, 0, 2.1, 2.5, { r: 1.0 });
    mesh(new THREE.ConeGeometry(1.8, 2.2, 4), roofM, 0, 5.3, 2.5, { ry: PI / 4, r: 0.6 });
    for (let k = 0; k < 4; k++) { const rk = mesh(new THREE.ConeGeometry(0.16, 0.45, 8), RB[k], -1.5 + k, 1.0, 2.5, { mode: 'rocket', r: 0.2, delay: 0.3 + k * 0.25 }); rk.visible = false; rk.userData.col = RB[(k * 2) % 6]; F.showOnHit.push(rk); }
  }
  grp.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });

  F.toSim = (v) => ({ x: v.x + grp.position.x, y: v.y, z: -(v.z + grp.position.z) });
  F.reset = () => {
    F.hit = false; F.t = 0;
    for (const o of F.pieces) { const u = o.userData; o.position.copy(u.p0); o.rotation.copy(u.r0); u.v.set(0, 0, 0); u.w.set(0, 0, 0); u.on = false; u.burst = false; u.ang = 0; u.angV = 0; o.visible = true; }
    for (const o of F.hideOnHit) o.visible = true;
    for (const o of F.showOnHit) o.visible = false;
  };
  F.trigger = () => {
    if (F.hit) return;
    F.hit = true; F.t = 0;
    for (const o of F.hideOnHit) o.visible = false;
    for (const o of F.showOnHit) o.visible = true;
    for (const o of F.pieces) { const u = o.userData; u.on = false; u.wait = u.delay != null ? u.delay : Math.max(0, (-o.position.z) * 0.05 + o.position.y * 0.025); }
  };
  F.update = (dt, t) => {
    for (const [o, ax, sp] of F.spin) if (!F.hit || !o.userData.on) o.rotation[ax] += sp * dt;
    if (F.beam && !F.hit) { F.beam.rotation.y = t * 1.4; }
    if (F.chimney && !F.hit) {
      F.smokeT -= dt;
      if (F.smokeT <= 0) { F.smokeT = 0.3; const p = F.chimney.g.position; const s = F.toSim(tmpV.set(p.x + F.chimney.x, F.chimney.y, p.z)); R.dust.emit(s.x, s.y, s.z, rnd(-0.2, 0.2), 1.4, 0.2, 1.6, 0.5, [0.95, 0.95, 0.95], -0.2, 0.6, 2.2, 0.8); }
    }
    if (!F.hit) return;
    F.t += dt;
    for (const o of F.pieces) {
      const u = o.userData;
      if (!u.on) {
        if (F.t < u.wait) continue;
        u.on = true;
        const k = u.kick;
        if (u.mode === 'fly') { u.v.set(o.position.x * 0.7 + rnd(-1.6, 1.6), (2.5 + rnd(0, 4) + o.position.y * 0.35) * k, -(3 + rnd(0, 4.5)) * k); u.w.set(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)); }
        else if (u.mode === 'rise') { u.v.set(rnd(-0.3, 0.3), 1.2, -0.3); }
        else if (u.mode === 'rocket') { u.v.set(rnd(-1.5, 1.5), 15 + rnd(0, 3), rnd(-1.2, 0.6)); u.fuse = 0.75 + rnd(0, 0.3); o.visible = true; }
        else if (u.mode === 'topple') { u.ang = 0; u.angV = 0.4; }
        continue;
      }
      if (u.mode === 'rise') {
        u.v.y += 1.6 * dt; o.position.addScaledVector(u.v, dt); o.rotation.z = Math.sin(F.t * 1.3) * 0.08; continue;
      }
      if (u.mode === 'topple') {
        if (u.ang < 1.45) { u.angV += 3.2 * dt; u.ang = Math.min(1.45, u.ang + u.angV * dt); if (u.ang >= 1.45) { const s = F.toSim(tmpV.set(0, 0.5, o.position.z - 4)); shake(0.18, 0.22); R.dust.burst(s.x, 0.4, s.z, 20, 4, 1.0, 0.7, srgb('#c8e6a0'), 1, 1); for (let k2 = 0; k2 < 26; k2++) R.glow.emit(s.x + rnd(-2, 2), rnd(0.5, 3), s.z + rnd(-1, 1), rnd(-2, 2), rnd(1, 4), rnd(-2, 2), 1.4, 0.35, srgb('#7bff6b'), 3, 1); } }
        o.rotation.x = u.r0.x - u.ang; continue;
      }
      if (u.mode === 'rocket' && !u.burst) {
        o.position.addScaledVector(u.v, dt); u.v.y -= 5 * dt; u.fuse -= dt;
        const s = F.toSim(o.position);
        R.glow.emit(s.x, s.y - 0.2, s.z, rnd(-0.5, 0.5), -2, rnd(-0.5, 0.5), 0.35, 0.35, [1, 0.8, 0.4], 0, 1);
        if (u.fuse <= 0) {
          u.burst = true; o.visible = false;
          const c = srgb(u.col || '#ffd23f'), c2 = srgb('#ffffff');
          for (let k2 = 0; k2 < 70; k2++) { const a = Math.random() * TAU, e = Math.random() * 2 - 1, h = Math.sqrt(1 - e * e), sp = rnd(5, 8); R.glow.emit(s.x, s.y, s.z, Math.cos(a) * h * sp, e * sp, Math.sin(a) * h * sp, rnd(1.0, 1.6), 0.5, k2 % 5 ? c : c2, 2.5, 1.6); }
          shake(0.08, 0.15);
        }
        continue;
      }
      if (u.mode === 'rocket') continue;
      u.v.y -= 15 * dt;
      o.position.addScaledVector(u.v, dt);
      o.rotation.x += u.w.x * dt; o.rotation.y += u.w.y * dt; o.rotation.z += u.w.z * dt;
      if (o.position.y < u.r) { o.position.y = u.r; if (u.v.y < 0) u.v.y *= -0.3; u.v.x *= 0.75; u.v.z *= 0.75; u.w.multiplyScalar(0.7); }
    }
  };
  return F;
}

// ---------------------------------------------------------------- 出来事 → 演出
function onEvents(list, s) {
  if (!S || !sim || s !== sim) return;
  const d = sim.doms;
  for (const e of list) {
    switch (e.type) {
      case 'lay': {
        if (S.born.length <= e.i) { const nb = new Float32Array(S.born.length * 2).fill(-9); nb.set(S.born); S.born = nb; }
        S.born[e.i] = sim.t;
        break;
      }
      case 'topple': {
        if (e.combo && e.combo % 100 === 0) { const dm = d[e.i]; if (dm) R.glow.burst(dm.x, 1.0, dm.z, 26, 4, 0.8, 0.4, srgb('#fff2a8'), 2, 2); }
        break;
      }
      case 'wavestart': { const dm = d[0]; if (dm) R.dust.burst(dm.x, 0.3, dm.z, 10, 2, 0.8, 0.45, dustCol(), 1, 1); break; }
      case 'pick': {
        const it = e.item, c = it.t === 'star' ? '#ffd23f' : it.t === 'coin' ? '#ffc21a' : '#ffe0a0';
        R.glow.burst(it.x, 0.7, it.z, it.t === 'star' ? 40 : 18, it.t === 'star' ? 5 : 3.5, 0.7, it.t === 'star' ? 0.45 : 0.3, srgb(c), 3, 2);
        if (it.t === 'box' || it.t === 'bigbox') for (let k = 0; k < 6; k++) R.debris.spawn(it.x, 0.5, it.z, rnd(-3, 3), rnd(3, 6), rnd(-1, 3), 0.18, 0.05, 0.28, hexToRGB('#c98a4b'), 1.2);
        break;
      }
      case 'jump': { const p = sim.p; R.dust.burst(p.x, 0.1, p.z, e.big ? 12 : 6, 1.6, 0.5, 0.35, dustCol(), 1, 0.5); R.player.bounce = 0.25; for (const sp of S.springs || []) if (Math.abs(sp.z - p.z) < 1 && Math.abs(sp.x - p.x) < 1) sp.t = 0; break; }
      case 'land': { const p = sim.p; R.dust.burst(p.x, 0.05, p.z, 8, 2, 0.45, 0.35, dustCol(), 0.5, 0.2); R.player.squash = 0.22; break; }
      case 'bump': R.player.squash = 0.18; break;
      case 'gate': { for (const gg of S.gates) if (gg.g === e.g) gg.dust = true; break; }
      case 'bomb': explode(e.x, e.z); if (S.specials[e.i]) S.specials[e.i].g.visible = false; break;
      case 'note': {
        const sp = sim.specials[e.i]; if (!sp) break;
        const n = R.notes[R.noteI++ % R.notes.length];
        n.position.set(sp.x, 0.6, -sp.z); n.visible = true; n.userData.t = 0;
        n.material.color.setHSL((e.k * 0.13) % 1, 0.9, 0.6);
        R.glow.burst(sp.x, 0.3, sp.z, 10, 2, 0.5, 0.3, srgb(n.material.color.getStyle()), 2, 1.5);
        break;
      }
      case 'opgate': case 'split': {
        const ob = S.objs[e.id]; if (!ob) break;
        const o = ob.o, good = e.type === 'split' ? true : e.ok;
        const c = srgb(e.type === 'split' ? '#c77dff' : good ? '#5ab0ff' : '#ff4058');
        for (let k = 0; k < 40; k++) R.glow.emit(o.x + rnd(-(o.w || 3) / 2, (o.w || 3) / 2), rnd(0.3, 2.2), o.z + 0.7, rnd(-1, 1), rnd(0, 3), rnd(1, 4), rnd(0.5, 0.9), 0.35, c, 2, 1);
        if (!good) shake(0.1, 0.15);
        break;
      }
      case 'bridge': { const dm = d[e.i]; if (dm) R.glow.burst(dm.x, (dm.tall || 1) * 0.6, dm.z, 22, 3, 0.7, 0.35, srgb('#9ff3ff'), 1, 1); break; }
      case 'bigfall': break;
      case 'goal': { const L = sim.level; for (let k = 0; k < 50; k++) R.confetti.spawn(rnd(-4, 4), rnd(2.5, 4), L.goalZ + rnd(0, 2), rnd(-2, 2), rnd(1, 4), rnd(-1, 2), 1, 1, 1, confCol(), rnd(2, 3.5)); break; }
      case 'giant': slowmo(0.35, 0.8); break;
      case 'clear': {
        const g = sim.giant || S.giantDef;
        for (let k = 0; k < 140; k++) R.confetti.spawn(rnd(-6, 6), rnd(5, 9), g.z + rnd(-3, 8), rnd(-2, 2), rnd(-1, 3), rnd(-2, 2), 1, 1, 1, confCol(), rnd(3, 5));
        break;
      }
      case 'fail': {
        if (e.why === 'caught') { slowmo(0.4, 0.55); shake(0.12, 0.2); R.player.squash = 0; }
        break;
      }
      case 'revive': { const p = sim.p; R.glow.burst(p.x, 0.8, p.z, 30, 3, 0.8, 0.4, srgb('#9ff3ff'), 0, 1); R.mark.visible = false; break; }
      case 'stun': R.player.squash = 0.2; break;
    }
  }
}
function dustCol() {
  if (S && S.dustRGB) return S.dustRGB;
  const c = new THREE.Color(world ? world.floor2 : '#ddd').lerp(new THREE.Color('#ffffff'), 0.45), v = srgb('#' + c.getHexString(THREE.SRGBColorSpace));
  if (S) S.dustRGB = v;
  return v;
}
const CONF = ['#ff5a5a', '#ffd23f', '#3fd0ff', '#7bff6b', '#ff7ad9', '#ffffff', '#ff9a2f'];
function confCol() { return hexToRGB(CONF[Math.floor(Math.random() * CONF.length)]); }
function explode(x, z) {
  for (let k = 0; k < 45; k++) R.glow.emit(x, rnd(0.3, 1.2), z, rnd(-5, 5), rnd(1, 7), rnd(-5, 5), rnd(0.35, 0.7), rnd(0.5, 0.9), k % 3 ? [1, 0.6, 0.15] : [1, 0.95, 0.5], 4, 2.5);
  R.glow.emit(x, 0.8, z, 0, 0, 0, 0.22, 5, [1, 0.85, 0.5], 0, 0);
  for (let k = 0; k < 10; k++) R.dust.emit(x + rnd(-0.5, 0.5), rnd(0.3, 1), z + rnd(-0.5, 0.5), rnd(-1.5, 1.5), rnd(1.5, 3), rnd(-1.5, 1.5), rnd(0.7, 1.0), 0.45, [0.55, 0.52, 0.55], -0.5, 1.2, 1.6, 0.6);
  for (let k = 0; k < 8; k++) R.debris.spawn(x, 0.6, z, rnd(-4, 4), rnd(4, 8), rnd(-4, 4), 0.16, 0.16, 0.16, k % 2 ? hexToRGB('#d8342f') : hexToRGB('#2a2228'), 1.4);
  shake(0.25, 0.3); hitstop(0.05);
}

// ---------------------------------------------------------------- 1コマ
function render(dt, realDt) {
  if (!renderer) return;
  realDt = Math.min(0.1, realDt || 0);
  dt = Math.min(0.1, dt || 0);
  realClock += realDt;
  autoQuality(realDt);
  if (!sim || !S) { renderer.render(scene, camera); return; }
  const t = sim.t;
  let tv = null;
  if (RP) tv = stepReplay(realDt);
  // 見える範囲(z)
  const focusZ = cam.look ? -cam.look.z : sim.p.z;
  let zMin = focusZ - 22, zMax = focusZ + 40;
  if (RP) { zMin = RP.fz - 45; zMax = RP.fz + 45; }
  updateDominoes(t, zMin, zMax, tv);
  updateRivals(t, zMin, zMax);
  updateCourse(t, dt);
  updateItemsObjs(t, dt, zMin, zMax);
  updateGiantFinale(t, dt);
  updatePlayer(dt, realDt, t);
  updateFX(dt, t);
  updateCamera(realDt);
  if (S.starsSky) S.starsSky.position.copy(camera.position);
  R.dust.update(dt); R.glow.update(dt);
  R.confetti.update(dt); R.debris.update(dt, floorAt);
  renderer.render(scene, camera);
  window.__r3d = { q: Q.level, pr: pixelRatio, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, doms: S.domMesh.count, replay: !!RP };
}
function floorAt(x, z) { if (!sim) return true; const t = sim.cellAt(x, z); return t !== DOM.Level.T.HOLE || (z >= sim.level.rows && Math.abs(x) < 7); }

function updateDominoes(t, zMin, zMax, tv) {
  const d = sim.doms, H = CFG.DOM_H, TT = CFG.DOM_T;
  if (d.length * 2 > S.cap) makeDomMesh(Math.max(S.cap * 2, d.length * 2 + 256));
  const m = S.domMesh, arr = m.instanceMatrix.array, carr = m.instanceColor.array;
  const replay = tv != null;
  const rFall = replay ? RP.fall : 0;
  let k = 0;
  for (let i = 0; i < d.length; i++) {
    const dm = d[i];
    if (dm.z < zMin || dm.z > zMax) continue;
    const hs = dm.tall ? dm.tall / H : 1;
    let a = 0;
    if (replay) { if (dm.st && dm.t0 <= tv) { const u = Math.min(1, (tv - dm.t0) / (rFall * Math.sqrt(hs))); a = dm.rest * u * u; } }
    else if (dm.st > 0) { const u = Math.min(1, (t - dm.t0) / (CFG.FALL_TIME * Math.sqrt(hs))); a = dm.rest * u * u; }
    let pop = 1, drop = 0;
    if (!replay && i < S.born.length) { const bu = (t - S.born[i]) / 0.14; if (bu < 1 && bu >= 0) { pop = 0.55 + 0.45 * bu; drop = (1 - bu) * 0.35; } }
    const sh = Math.sin(dm.h), ch = Math.cos(dm.h);
    const fx = sh, fz = -ch;                         // 前向き(three)
    tmpE.set(-a, -dm.h, 0); tmpQ.setFromEuler(tmpE);
    tmpS.set(pop, hs * pop, pop);
    domColor(dm.n, tmpC);
    const n = dm.twin ? 2 : 1;
    for (let q = 0; q < n; q++) {
      const off = n === 2 ? (q ? 0.3 : -0.3) : 0;
      tmpP.set(dm.x + fx * TT / 2 + ch * off, drop, -dm.z + fz * TT / 2 + sh * off);
      tmpM.compose(tmpP, tmpQ, tmpS);
      tmpM.toArray(arr, k * 16);
      carr[k * 3] = tmpC.r; carr[k * 3 + 1] = tmpC.g; carr[k * 3 + 2] = tmpC.b;
      k++;
    }
  }
  m.count = k;
  m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
  if (m.instanceMatrix.addUpdateRange) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, Math.max(1, k) * 16); m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, Math.max(1, k) * 3); }
}

function updateRivals(t, zMin, zMax) {
  if (!S.rivalMesh) return;
  const m = S.rivalMesh, TT = CFG.DOM_T;
  sim.rivals.forEach((rv, i) => {
    let a = 0;
    if (rv.t0 >= 0) { const u = Math.min(1, (t - rv.t0) / CFG.FALL_TIME); a = S.rivalRest[i] * u * u; }
    tmpE.set(-a, PI, 0); tmpQ.setFromEuler(tmpE);
    tmpP.set(rv.x, 0, -rv.z + TT / 2); tmpS.set(1, 1, 1);
    if (rv.z < zMin || rv.z > zMax) tmpS.set(0, 0, 0);
    m.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
  });
  m.instanceMatrix.needsUpdate = true;
}

function updateCourse(t, dt) {
  R.arrowTex.offset.y = -(realClock * 1.6) % 1;
  R.beltTex.offset.x = -(realClock * 1.2) % 1;
  if (S.boostMat) S.boostMat.opacity = 0.55 + 0.45 * Math.sin(realClock * 8);
  for (const gg of S.gates) {
    const open = sim.gateOpen[gg.g];
    const u = open ? clamp((t - sim.gateT[gg.g]) / 0.6, 0, 1) : 0;
    gg.mesh.position.y = -1.16 * u * u;
    gg.mesh.visible = u < 1;
    if (gg.dust) { gg.dust = false; gg.mesh.geometry.computeBoundingBox(); const bb = gg.mesh.geometry.boundingBox; for (let k = 0; k < 24; k++) R.dust.emit(rnd(bb.min.x, bb.max.x), 0.1, -rnd(bb.min.z, bb.max.z), rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1), 0.9, 0.5, dustCol(), 0.5, 1, 1.2); }
  }
  for (const sw of S.switches) sw.mesh.position.y = sim.gateOpen[sw.g] ? -0.02 : 0.06;
  // こわれるかべ
  if (sim.broken.length !== S.broken) {
    S.broken = sim.broken.length;
    for (const w of S.weak) {
      if (w.gone || sim.broken.indexOf(w.i) < 0) continue;
      w.gone = true; w.mesh.visible = false;
      const c = hexToRGB('#' + w.mesh.material.color.getHexString());
      for (let k = 0; k < 7; k++) R.debris.spawn(w.x + rnd(-0.4, 0.4), rnd(0.2, 1.1), w.z + rnd(-0.4, 0.4), rnd(-3, 3), rnd(2, 6), rnd(1, 6), rnd(0.2, 0.35), rnd(0.15, 0.3), rnd(0.2, 0.35), c, 1.6);
      R.dust.burst(w.x, 0.6, w.z, 8, 2, 1, 0.7, [0.75, 0.7, 0.65], 0.5, 0.5);
    }
  }
  // しずむ床
  if (S.sinks.length) {
    const per = sim.cfg.sinkPeriod;
    for (const sk of S.sinks) {
      const u = ((t / per + sk.r * 0.07) % 1 + 1) % 1;
      let y;
      if (u < 0.5) y = Math.sin(t * 2.4 + sk.r) * 0.02;
      else if (u < 0.62) { const k = (u - 0.5) / 0.12; y = -0.07 * k + Math.sin(t * 40 + sk.r) * 0.02 * k; }
      else if (u < 0.67) y = lerp(-0.07, -0.62, (u - 0.62) / 0.05);
      else if (u < 0.94) y = -0.62;
      else y = lerp(-0.62, 0, (u - 0.94) / 0.06);
      sk.mesh.position.y = y;
    }
    if (S.water) S.water.position.y = -0.32 + Math.sin(t * 1.6) * 0.03;
  }
  for (const sp of S.springs || []) { sp.t += dt; const k = sp.t < 0.3 ? Math.sin(sp.t / 0.3 * PI) : 0; sp.plate.position.y = 0.26 + k * 0.25; }
  if (S.flags) for (const f of S.flags) f.rotation.y = Math.sin(realClock * 3 + f.position.x) * 0.25;
  if (S.noteMat) S.noteMat.emissiveIntensity = 0.15 + 0.1 * Math.sin(realClock * 4);
}

function updateItemsObjs(t, dt, zMin, zMax) {
  for (const e of S.items) {
    const it = e.it;
    if (it.taken) { if (!e.gone) { e.gone = true; e.g.visible = false; } continue; }
    if (e.gone) { e.gone = false; e.g.visible = true; }
    if (it.z < zMin || it.z > zMax) { e.g.visible = false; continue; }
    e.g.visible = true;
    e.spin += dt * (it.t === 'star' ? 2.2 : it.t === 'coin' ? 3.2 : 0.6);
    if (it.t === 'star' || it.t === 'coin') { e.g.children[0].rotation.y = e.spin; e.g.position.y = Math.sin(e.spin * 1.3) * 0.12; }
    else e.g.rotation.y = Math.sin(e.spin) * 0.25;
  }
  for (const e of S.objs) {
    if (!e) continue;
    const o = e.o;
    if (o.t === 'saw') { e.g.position.set(o.hx, 0.58, -o.hz); e.blade.rotation.z -= dt * 14; }
    else if (o.t === 'ball') { e.g.position.set(o.hx, 0.45, -o.hz); e.g.rotation.z = -o.hx / 0.45; }
    else if (o.t === 'hammer') { const s = clamp((o.hx - o.x) / e.R, -0.99, 0.99); e.g.rotation.z = Math.asin(s); }
    else if (o.t === 'gate' || o.t === 'split') {
      if (o.used) {
        e.fade = Math.max(0, e.fade - dt * (o.t0 >= 0 ? 4 : 2));
        const s = o.t0 >= 0 ? 1 + (1 - e.fade) * 0.4 : 1;
        e.panel.scale.set(s, s, 1);
        e.panel.material.opacity = o.t0 >= 0 ? e.fade : 0.25 + 0.75 * e.fade;
        if (o.t0 >= 0 && e.fade <= 0) e.g.visible = false;
      } else { e.fade = 1; e.g.visible = true; e.panel.material.opacity = 1; e.panel.scale.set(1, 1, 1); e.panel.position.y = 0.2 + ((o.w || 3) - 0.15) * 0.25 + 0.15 + Math.sin(realClock * 2.5 + o.x) * 0.05; }
    } else if (o.t === 'wind') { const dir = o.per ? (Math.floor(t / o.per) % 2 ? -1 : 1) : 1; const f = (o.f || 2.5) * dir; e.flag.rotation.y = f > 0 ? 0 : PI; e.flag.scale.x = 0.9 + Math.sin(realClock * 12) * 0.1; }
  }
  for (const e of S.specials) {
    if (!e || !e.g) continue;
    const sp = e.sp;
    if (sp.t === 'bomb' && !sp.done) { e.spark.scale.setScalar(0.3 + Math.random() * 0.2); }
    if (sp.t === 'big') {
      let a = 0;
      if (sp.done) {
        const u = Math.min(1, (t - sp.t0) / 0.75); a = u * u * PI / 2;
        if (u >= 1 && !S.bigHit[sp.x + ',' + sp.z]) { S.bigHit[sp.x + ',' + sp.z] = 1; shake(0.18, 0.22); hitstop(0.05); R.dust.burst(sp.x, 0.2, sp.z + 2.3, 22, 4, 0.9, 0.7, dustCol(), 0.5, 0.6); }
      }
      e.g.rotation.set(-a, 0, 0, 'YXZ');
    }
  }
}

function updateGiantFinale(t, dt) {
  const g = sim.giant;
  let a = 0;
  if (RP && RP.phase === 2) a = RP.ga;
  else if (g && g.t0 >= 0) { const u = Math.min(1, (t - g.t0) / 1.0); a = u * u * PI / 2; }
  S.giant.rotation.set(-a, 0, 0, 'YXZ');
  if (!RP && a > 1.18 && !S.finale.hit) { finaleImpact(); }
  S.finale.update(RP && RP.phase === 2 ? dt * 0 + RP.fdt : dt, realClock);
}
function finaleImpact() {
  S.finale.trigger();
  hitstop(0.06); shake(0.35, 0.35);
  const F = S.finale, z = F.FZ;
  R.dust.burst(0, 0.3, z - 0.3, 30, 5, 1.2, 0.9, dustCol(), 0.5, 1);
  R.glow.burst(0, 1.5, z + 1, 50, 6, 1.0, 0.45, srgb('#fff2a8'), 3, 3);
  for (let k = 0; k < 90; k++) R.confetti.spawn(rnd(-4, 4), rnd(2, 5), z + rnd(-1, 4), rnd(-4, 4), rnd(3, 8), rnd(-2, 4), 1, 1, 1, confCol(), rnd(2.5, 4.5));
}

// ---------------------------------------------------------------- 主人公
function updatePlayer(dt, realDt, t) {
  const P = R.player, p = sim.p, st = sim.state;
  const failed = st === 'fail', why = sim.failReason;
  P.root.visible = !(failed && why === 'fall' && p.y < -12);
  P.root.position.set(p.x, p.y, -p.z);
  // 向き(なめらかに)
  let target = -p.heading;
  let dy = target - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  P.yaw += dy * ease(14, dt || realDt * 0.2);
  P.root.rotation.y = P.yaw;
  // こわさ
  const fear = st === 'run' && sim.wave.started ? clamp((3.4 - sim.danger) / 2.4, 0, 1) : 0;
  const lookTarget = (st === 'run' && fear > 0.35 && p.stun <= 0) || (failed && why === 'caught') ? 2.5 : 0;
  P.look = lerp(P.look, lookTarget, ease(8, dt || 0));
  P.body.rotation.y = P.look;
  // 走る
  const running = (st === 'run' && p.stun <= 0 && !p.air) || (st === 'goal' && !p.done);
  const spd = st === 'run' ? (p.boost > 0 ? 1.6 : 1) : 1;
  if (running) P.phase += dt * 15 * spd;
  const sw = running ? Math.sin(P.phase) : 0;
  P.legL.rotation.x = sw * 0.8; P.legR.rotation.x = -sw * 0.8;
  P.armL.rotation.x = -sw * 0.9; P.armR.rotation.x = sw * 0.9;
  P.armL.rotation.z = 0; P.armR.rotation.z = 0;
  let bob = running ? Math.abs(Math.sin(P.phase)) * 0.07 : 0;
  let lean = running ? (p.boost > 0 ? -0.28 : -0.12) : 0;
  if (p.air) { P.legL.rotation.x = 0.6; P.legR.rotation.x = -0.3; P.armL.rotation.z = -2.2; P.armR.rotation.z = 2.2; }
  // しびれ
  P.stars.visible = p.stun > 0 && !failed;
  if (P.stars.visible) { P.stars.rotation.y += dt * 6; P.body.rotation.z = Math.sin(t * 18) * 0.08; } else P.body.rotation.z = 0;
  // お助け
  P.bubble.visible = p.safe > 0;
  if (P.bubble.visible) { P.bubble.material.opacity = 0.16 + 0.1 * Math.sin(realClock * 10); }
  P.bodyMat.emissive.setRGB(p.safe > 0 ? 0.25 : p.boost > 0 ? 0.12 : 0, p.safe > 0 ? 0.6 : p.boost > 0 ? 0.08 : 0, p.safe > 0 ? 0.7 : 0);
  // つぶれ・ぴょん
  P.squash = Math.max(0, P.squash - dt);
  P.bounce = Math.max(0, P.bounce - dt);
  let sy = 1 - P.squash * 1.2 + P.bounce * 0.6, sx = 1 + P.squash * 0.8 - P.bounce * 0.3;
  // ゴール
  if (st === 'goal' || st === 'clear') {
    if (p.done) {
      const cheer = sim.giant && sim.giant.t0 >= 0;
      lean = 0;
      if (cheer) {
        const k = Math.abs(Math.sin(realClock * 7));
        P.root.position.y = k * 0.45; P.armL.rotation.z = -2.6 + Math.sin(realClock * 14) * 0.3; P.armR.rotation.z = 2.6 - Math.sin(realClock * 14) * 0.3;
        sy = 1 + (1 - k) * -0.08; sx = 1 + (1 - k) * 0.05;
      }
    }
  }
  // 負け
  if (failed) {
    lean = 0;
    if (why === 'caught') { P.root.position.y = 0; sy = Math.max(0.5, 1 - sim.endT * 3); sx = 1 + (1 - sy) * 0.7; }
    else if (why === 'fall') { P.spin += dt * 6; P.body.rotation.x = P.spin; P.armL.rotation.z = -2.6; P.armR.rotation.z = 2.6; }
  } else { P.spin = 0; P.body.rotation.x = lean; }
  P.body.position.y = bob;
  P.root.scale.set(sx * 1.22, Math.max(0.2, sy) * 1.22, sx * 1.22);
  // 顔
  let fk = 'run';
  if (failed) fk = why === 'caught' ? 'dead' : 'scared';
  else if (st === 'clear' || (st === 'goal' && p.done)) fk = sim.giant && sim.giant.t0 >= 0 ? 'happy' : 'jump';
  else if (p.stun > 0) fk = 'stun';
  else if (fear > 0.35) fk = 'scared';
  else if (p.air) fk = 'jump';
  if (fk !== P.faceKind) { P.faceKind = fk; P.faceMat.map = R.faces[fk]; }
  // 夜の灯り
  if (S.lampOn) {
    if (RP || st === 'goal' || st === 'clear') { R.lamp.position.set(cam.look.x + 1, 5, cam.look.z + 2); R.lamp.distance = 26; }
    else { R.lamp.position.set(p.x, Math.max(p.y, -3) + 2.4, -p.z + 0.5); R.lamp.distance = 15; }
  }
  // 汗
  if (fear > 0.35 && st === 'run') {
    S.sweatAcc += dt * 5;
    while (S.sweatAcc > 1) { S.sweatAcc -= 1; R.dust.emit(p.x + rnd(-0.3, 0.3), p.y + 1.1, p.z, rnd(-1.2, 1.2), rnd(1.2, 2.2), rnd(-0.5, 0.5), 0.45, 0.16, [0.4, 0.8, 1], 9, 0); }
  }
  if (p.boost > 0 && st === 'run') {
    S.trailAcc += dt * 30;
    while (S.trailAcc > 1) { S.trailAcc -= 1; R.glow.emit(p.x + rnd(-0.25, 0.25), p.y + rnd(0.2, 1), p.z - 0.3, 0, 0, -2, 0.3, 0.22, [1, 0.8, 0.35], 0, 0); }
  }
}

// ---------------------------------------------------------------- 波の先頭の粒・風
function updateFX(dt, t) {
  if (!dt) return;
  const d = sim.doms, H = CFG.DOM_H;
  if (!RP) {
    for (const fr of sim.fronts) {
      if (fr.dead || fr.i <= 0) continue;
      const dm = d[Math.min(d.length - 1, fr.i - 1)];
      if (!dm || !dm.st || t - dm.t0 > 0.6) continue;
      const fx = Math.sin(dm.h), fz = Math.cos(dm.h);
      const v = sim.wave.v || 4;
      S.frontAcc += dt * v * 3.2;
      while (S.frontAcc > 1) { S.frontAcc -= 1; R.dust.emit(dm.x + fx * H * 0.9 + rnd(-0.3, 0.3), 0.05, dm.z + fz * H * 0.9 + rnd(-0.2, 0.2), rnd(-1, 1), rnd(0.4, 1.2), fz * rnd(0, 1), rnd(0.5, 0.8), rnd(0.35, 0.55), dustCol(), 0.6, 1.5, 1.3, 0.7); }
      S.sparkAcc += dt * v * 2.4;
      while (S.sparkAcc > 1) { S.sparkAcc -= 1; R.glow.emit(dm.x + fx * 0.6 + rnd(-0.3, 0.3), rnd(0.2, 0.8), dm.z + fz * 0.6, rnd(-1.5, 1.5), rnd(1, 3), fz * rnd(0.5, 2), rnd(0.3, 0.55), rnd(0.18, 0.3), [1, 0.92, 0.6], 3, 1); }
    }
    // 前から倒れてくる列の先頭
    for (const e of S.objs) {
      if (!e || e.o.t !== 'rival' || e.o.t0 < 0) continue;
      const o = e.o; if (o.hz < o.z - 1) continue;
      S.frontAcc += dt * 6;
      if (Math.random() < dt * 14) R.dust.emit(o.x + rnd(-0.3, 0.3), 0.05, o.hz - 0.8, rnd(-1, 1), rnd(0.4, 1), -rnd(0, 1), 0.6, 0.45, dustCol(), 0.5, 1.5, 1.2, 0.7);
    }
  }
  // 風
  const pz = sim.p.z, kind = world.en;
  for (const e of S.objs) {
    if (!e || e.o.t !== 'wind') continue;
    const o = e.o; if (o.z2 < pz - 15 || o.z > pz + 30) continue;
    const dir = (o.per ? (Math.floor(t / o.per) % 2 ? -1 : 1) : 1) * Math.sign(o.f || 2.5);
    S.windAcc += dt * 26;
    while (S.windAcc > 1) { S.windAcc -= 1; R.dust.emit(-dir * 5.5, rnd(0.2, 2.2), rnd(o.z, o.z2 + 1), dir * rnd(7, 10), rnd(-0.2, 0.2), 0, 1.2, rnd(0.12, 0.2), kind === 'snow' ? [0.55, 0.72, 0.95] : [1, 1, 1], 0, 0, 0, 0.75); }
  }
  // 音のドミノ
  for (const n of R.notes) { if (!n.visible) continue; n.userData.t += dt; const k = n.userData.t; n.position.y += dt * 1.6; n.material.opacity = Math.max(0, 1 - k / 1.0); const s = 0.6 + Math.min(1, k * 5) * 0.4; n.scale.set(s, s, 1); if (k > 1) n.visible = false; }
  // 切れた所の印
  if (sim.state === 'fail' && (sim.failReason === 'broken' || sim.failReason === 'empty') && sim.brokenAt != null) {
    const dm = d[sim.brokenAt];
    if (dm) {
      const fx = Math.sin(dm.h), fz = Math.cos(dm.h);
      R.mark.position.set(dm.x + fx * 1.25, 0.06, -(dm.z + fz * 1.25));
      R.mark.visible = true; const s = 1 + Math.sin(realClock * 9) * 0.15; R.mark.scale.set(s, s, s);
    }
  } else if (sim.state !== 'fail') R.mark.visible = false;
}

// ---------------------------------------------------------------- カメラ
function camFit() {
  const aspect = viewW / Math.max(1, viewH);
  const vfov = aspect < 1 ? 62 : 50;
  camera.fov = vfov; camera.aspect = aspect; camera.updateProjectionMatrix();
  const tanH = Math.tan(vfov * PI / 360) * aspect;
  cam.baseDist = clamp(5.1 / tanH, 11, 26);     // 主人公のところで コースのはば(9m)+少し が横に入る
  const sc = viewH * pixelRatio / (2 * Math.tan(vfov * PI / 360));
  R.dust.mat.uniforms.uScale.value = sc; R.glow.mat.uniforms.uScale.value = sc;
}
const PITCH = 0.72;   // 見下ろす角度(ラジアン)
function updateCamera(rdt) {
  const p = sim.p, st = sim.state;
  const look = new THREE.Vector3(), pos = new THREE.Vector3();
  let kPos = 4.5, kLook = 6;
  const D = cam.baseDist;
  if (RP) {
    if (RP.phase === 1) {
      look.set(RP.fx * 0.4, 0, -(RP.fz + 5));
      pos.set(RP.fx * 0.4 + 3, 25, -(RP.fz - 9));
      kPos = 3; kLook = 4;
    } else goalCam(look, pos, D);
  } else if (st === 'goal' || st === 'clear') {
    goalCam(look, pos, D); kPos = 2.2; kLook = 2.6;
  } else if (st === 'fail' && sim.failReason === 'fall') {
    look.set(p.x * 0.6, Math.max(-5, p.y * 0.4), -(p.z + 2));
    pos.copy(cam.pos); pos.y = Math.max(cam.pos.y - rdt * 2, 6);
  } else if (st === 'fail' && (sim.failReason === 'broken' || sim.failReason === 'empty') && R.mark.visible) {
    const mz = -R.mark.position.z;
    look.set(R.mark.position.x * 0.6, 0, -(mz + 1.5));
    const dd = D * 0.75;
    pos.set(look.x, Math.sin(PITCH + 0.1) * dd, look.z + Math.cos(PITCH + 0.1) * dd);
  } else {
    const fear = sim.wave.started && st === 'run' ? clamp((3.4 - sim.danger) / 2.6, 0, 1) : 0;
    // 波の先頭が 画面の下に入るように 少し引く(遠すぎる波は 追わない)
    let want = 1;
    const fy = frontScreenY();
    if (fy != null && st === 'run') { if (fy > 0.9) want = Math.min(1.3, cam.fit + 0.5); else if (fy < 0.8) want = Math.max(1, cam.fit - 0.5); else want = cam.fit; }
    cam.fit = lerp(cam.fit, want, ease(want < cam.fit ? 2.6 : 1.6, rdt));
    const dd = (st === 'fail' && sim.failReason === 'caught') ? D * 0.72 : D * (1 + 0.1 * fear) * cam.fit;
    const ahead = 3.2 - (cam.fit - 1) * 3;
    look.set(p.x * 0.35, 0.4, -(p.z + ahead));
    pos.set(look.x, look.y + Math.sin(PITCH) * dd, look.z + Math.cos(PITCH) * dd);
  }
  if (!cam.ready) { cam.pos.copy(pos); cam.look.copy(look); cam.ready = true; }
  cam.pos.lerp(pos, ease(kPos, rdt)); cam.look.lerp(look, ease(kLook, rdt));
  camera.position.copy(cam.pos);
  if (shakeT > 0) {
    shakeT -= rdt; const a = shakeAmp * clamp(shakeT / 0.25, 0, 1);
    camera.position.x += rnd(-a, a); camera.position.y += rnd(-a, a) * 0.6; camera.position.z += rnd(-a, a) * 0.5;
    if (shakeT <= 0) shakeAmp = 0;
  }
  camera.lookAt(cam.look);
  if (window.__camOverride) { const o = window.__camOverride; camera.position.set(o[0], o[1], -o[2]); camera.lookAt(o[3], o[4], -o[5]); }
  // 影は 見ている所のまわりだけ
  const fz = -cam.look.z;
  R.sun.target.position.set(cam.look.x, 0, -(fz - 1));
  R.sun.position.set(cam.look.x + 5, 14, -(fz - 1) + 6);
  const sc = R.sun.shadow.camera, big = RP && RP.phase === 1 ? 2.2 : (st === 'goal' || st === 'clear') ? 1.4 : 1;
  if (sc.userData.big !== big) { sc.userData.big = big; sc.left = -11 * big; sc.right = 11 * big; sc.top = 14 * big; sc.bottom = -14 * big; sc.updateProjectionMatrix(); }
}
function frontScreenY() {
  if (!sim.wave.started || sim.danger > 13) return null;
  const d = sim.doms; let best = null;
  for (const fr of sim.fronts) if (!fr.dead && fr.i > 0) { const dm = d[Math.min(d.length - 1, fr.i - 1)]; if (!best || dm.s > best.s) best = dm; }
  if (!best) return null;
  tmpV.set(best.x, 0, -best.z).project(camera);
  return (1 - tmpV.y) / 2;
}
function goalCam(look, pos, D) {
  const g = sim.giant || S.giantDef;
  const portrait = viewW < viewH;
  look.set(0.4, 2.0, -(g.z + 2.8));
  const dd = portrait ? D * 0.95 : D * 0.85;
  pos.set(dd * 0.34, 2.0 + dd * 0.5, -(g.z + 2.8) + dd * 0.8);
}

// ---------------------------------------------------------------- 空からのリプレイ
function replay(onDone) {
  const done = typeof onDone === 'function' ? onDone : () => {};
  if (!sim || !S || !renderer || sim.state !== 'clear' || sim.doms.length < 2) { setTimeout(done, 0); return; }
  const d = sim.doms;
  let t0 = Infinity, t1 = -Infinity;
  for (const dm of d) if (dm.st) { if (dm.t0 < t0) t0 = dm.t0; if (dm.t0 > t1) t1 = dm.t0; }
  if (!isFinite(t0)) { setTimeout(done, 0); return; }
  const span = Math.max(0.5, t1 - t0);
  const dur = clamp(span / 7, 2.6, 3.4);
  const speed = span / dur;
  RP = { done, t: 0, t0, t1, dur, speed, fall: Math.max(CFG.FALL_TIME, speed * 0.17), phase: 1, k: 0, fx: d[0].x, fz: d[0].z, ga: 0, gt: 0, fdt: 0, called: false };
  S.finale.reset();
  cam.pos.set(d[0].x * 0.4 + 3, 25, -(d[0].z - 9));
  cam.look.set(d[0].x * 0.4, 0, -(d[0].z + 5));
}
function stepReplay(rdt) {
  const P = RP, d = sim.doms;
  P.t += rdt;
  if (P.phase === 1) {
    const tv = P.t0 - 0.35 * P.speed + (P.t / P.dur) * (P.t1 - P.t0 + 0.35 * P.speed);
    while (P.k < d.length - 1 && d[P.k + 1].t0 <= tv && d[P.k + 1].st) P.k++;
    const dm = d[P.k];
    P.fx = lerp(P.fx, dm.x, ease(6, rdt)); P.fz = lerp(P.fz, dm.z, ease(8, rdt));
    // 先頭に 光の粒
    const fx = Math.sin(dm.h), fz = Math.cos(dm.h);
    for (let q = 0; q < 2; q++) R.glow.emit(dm.x + fx * 0.8 + rnd(-0.4, 0.4), 0.4, dm.z + fz * 0.8, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), 0.5, 0.45, [1, 0.9, 0.6], 2, 1);
    if (P.t >= P.dur + 0.25) { P.phase = 2; P.t2 = 0; }
    return tv;
  }
  // 2: 大ドミノと 大仕掛けを 少しゆっくり
  P.t2 += rdt;
  P.fz = (sim.giant || S.giantDef).z;
  const gt = Math.max(0, P.t2 - 0.5);
  const u = Math.min(1, gt / 1.25); P.ga = u * u * PI / 2;
  P.fdt = S.finale.hit ? rdt * 0.6 : 0;
  if (P.ga > 1.18 && !S.finale.hit) { S.finale.trigger(); shake(0.3, 0.3); R.glow.burst(0, 1.5, S.finale.FZ + 1, 40, 6, 1, 0.45, srgb('#fff2a8'), 3, 3); for (let k = 0; k < 70; k++) R.confetti.spawn(rnd(-4, 4), rnd(2, 5), S.finale.FZ + rnd(-1, 4), rnd(-4, 4), rnd(3, 8), rnd(-2, 4), 1, 1, 1, confCol(), rnd(2.5, 4)); }
  if (P.t2 > 0.5 + 1.25 + 1.4) {
    RP = null;
    if (!P.called) { P.called = true; try { P.done(); } catch (e) { console.error(e); } }
    return null;
  }
  return Infinity;   // ドミノは 全部 倒れたまま
}

// ---------------------------------------------------------------- 大きさ・画質
function resize() {
  if (!renderer || !box) return;
  viewW = box.clientWidth || window.innerWidth; viewH = box.clientHeight || window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(viewW, viewH, false);
  camFit();
}
function autoQuality(rdt) {
  if (!rdt) return;
  Q.frames++; Q.time += rdt; Q.since += rdt;
  if (Q.time < 2.5) return;
  const fps = Q.frames / Q.time;
  Q.frames = 0; Q.time = 0;
  if (fps < 45 && Q.since > 3 && Q.level < 4) {
    Q.level++; Q.since = 0;
    if (Q.level === 1) pixelRatio = Math.min(maxPR, 1.5);
    else if (Q.level === 2) { pixelRatio = Math.min(maxPR, 1.2); R.sun.shadow.mapSize.set(512, 512); if (R.sun.shadow.map) { R.sun.shadow.map.dispose(); R.sun.shadow.map = null; } }
    else if (Q.level === 3) { renderer.shadowMap.enabled = false; R.sun.castShadow = false; scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } }); }
    else if (Q.level === 4) pixelRatio = 1;
    resize();
  }
}

// UI が「とばす」を押したとき: 終わりの形(大仕掛けは くずれたまま)にして やめる。onDone は呼ばない
function stopReplay() {
  if (!RP) return;
  RP.called = true; RP = null;
  if (S && S.finale && !S.finale.hit) { S.finale.trigger(); for (let k = 0; k < 120; k++) S.finale.update(1 / 30, realClock); }
}
function dispose() {
  if (RP && !RP.called) { const f = RP.done; RP.called = true; RP = null; setTimeout(f, 0); }
  RP = null;
  disposeStage();
  if (renderer) { renderer.dispose(); if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
  renderer = null; sim = null;
}

export default { supported, init, setSim, onEvents, render, resize, replay, stopReplay, dispose,
  _trigger() { if (S && S.finale) { S.finale.reset(); S.giantDbg = realClock; S.finale.trigger(); } },
  _finaleZ() { return S && S.finale ? S.finale.FZ : 0; },
  _debug() {
    if (!sim || !camera) return null;
    const v = new THREE.Vector3(sim.p.x, 0.6, -sim.p.z).project(camera);
    return { playerScreenY: +((1 - v.y) / 2).toFixed(3), playerScreenX: +((v.x + 1) / 2).toFixed(3), dist: +cam.baseDist.toFixed(2), q: Q.level, pr: pixelRatio };
  } };
