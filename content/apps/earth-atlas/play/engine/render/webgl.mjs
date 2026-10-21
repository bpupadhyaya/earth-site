// @ts-check
// WebGL2 drawing layer. Thin on purpose: it uploads the typed arrays scene.mjs prepared and draws them with the shaders of
// shaders.mjs. All decisions (what is visible, at which detail, where things are) are made before this file is reached.
import { R_EARTH, DEG, clamp, smooth, wrap180, rgba } from './geo.mjs';
import { PATCH_STRIDE, LC_RGB } from './surface.mjs';
import { RIBBON_STRIDE, RUNWAY_STRIDE, MESH_STRIDE } from './shapes.mjs';
import { CLOUD_INDICES, CLOUD_FLOATS } from './scene.mjs';
import { FONT } from './draw2d.mjs';
import * as S from './shaders.mjs';

const ATLAS = 1024, MASK = 1024, BASE = 2048;

/**
 * @param {any} gl WebGL2RenderingContext @param {{ log?: (m: any) => void, createCanvas?: (w: number, h: number) => any, baseMap?: any }} o
 *   baseMap: the built-in base map of engine/world (createBaseMap) when it is the world: land, lakes and ice are then drawn from its areas
 */
export function createGL(gl, o = {}) {
  const log = o.log || (() => {});
  const newCanvas = o.createCanvas || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  /** @type {Record<string, any>} */
  let progs = {};
  /** @type {any} */
  let cur = null, noise = null, maskTex = null, maskKey = '', baseTex = null, baseKey = '', baseBox = null, baseCanvas = null, atlasTex = null, atlasCtx = null, fbo = null, cloudVao = null, cloudVbo = null, ovVao = null, ovVbo = null, skyVao = null;
  let glyphs = new Map(), penX = 1, penY = 1, rowH = 0, atlasDirty = false, atlasFull = false;
  let ovBuf = new ArrayBuffer(24 * 6 * 4096), ovF = new Float32Array(ovBuf), ovU = new Uint32Array(ovBuf), ovN = 0;
  const stats = { drawCalls: 0, triangles: 0, uploads: 0, patchUploads: 0 };
  const BASE_COL = (LC_RGB[o.baseMap && o.baseMap.info ? o.baseMap.info().landClass ?? 5 : 5] || LC_RGB[5]).map(v => v / 255);
  /** Changes whenever the context is (re)built: shared vehicle shapes uploaded before are then uploaded again. */
  let owner = {};
  const v3 = new Float32Array(3), m9 = new Float32Array(9);

  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
  /** Compile on first use. @param {string} name @param {string} vs @param {string} fs @param {string} [define] */
  const use = (name, vs, fs, define) => {
    let p = progs[name];
    if (!p) {
      const head = define ? `#define ${define}\n` : '', ins = src => src.replace('\n', '\n' + head), prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, ins(vs))); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, ins(fs))); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program ' + name + ': ' + gl.getProgramInfoLog(prog));
      p = progs[name] = { prog, loc: {} };
    }
    gl.useProgram(p.prog); cur = p;
    return p;
  };
  const U = name => (name in cur.loc ? cur.loc[name] : (cur.loc[name] = gl.getUniformLocation(cur.prog, name)));
  const f1 = (n, a) => gl.uniform1f(U(n), a), f2 = (n, a, b) => gl.uniform2f(U(n), a, b), f3 = (n, a) => gl.uniform3f(U(n), a[0], a[1], a[2]), f4 = (n, a, b, c, d) => gl.uniform4f(U(n), a, b, c, d);

  /** A vertex array over one interleaved buffer. attrs: [location, size, type, normalized, offset] */
  const vao = (data, stride, attrs, indices, usage = gl.STATIC_DRAW) => {
    const va = gl.createVertexArray(), vb = gl.createBuffer();
    gl.bindVertexArray(va); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    for (const a of attrs) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], a[2], a[3], stride, a[4]); }
    let ib = null;
    if (indices) { ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW); }
    gl.bindVertexArray(null); stats.uploads++;
    return { va, vb, ib, type: indices && indices.BYTES_PER_ELEMENT === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  };
  const free = g => { if (!g) return; if (g.va) gl.deleteVertexArray(g.va); if (g.vb) gl.deleteBuffer(g.vb); if (g.ib) gl.deleteBuffer(g.ib); if (g.tex) gl.deleteTexture(g.tex); };
  const F = gl.FLOAT, B = gl.BYTE, UB = gl.UNSIGNED_BYTE;
  const draw = (g, count, type = g.type) => { gl.bindVertexArray(g.va); gl.drawElements(gl.TRIANGLES, count, type, 0); stats.drawCalls++; stats.triangles += count / 3; };

  function init() {
    owner = {}; progs = {}; glyphs = new Map(); penX = penY = 1; rowH = 0; maskKey = ''; fbo = null;
    // tileable 3D noise, four independent channels, smoothed once so that trilinear filtering shows no lattice
    const N = 32, raw = new Uint8Array(N * N * N * 4), out = new Uint8Array(N * N * N * 4);
    let s = 0x9e3779b9;
    for (let i = 0; i < raw.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; raw[i] = s & 255; }
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += raw[((((z + dz) & 31) * N + ((y + dy) & 31)) * N + ((x + dx) & 31)) * 4 + c];
      out[((z * N + y) * N + x) * 4 + c] = clamp(127.5 + (sum / 27 - 127.5) * 3.6, 0, 255);
    }
    noise = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, noise);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, UB, out); gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const tex2 = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    maskTex = tex2(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, UB, new Uint8Array(4));
    baseTex = tex2(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, UB, new Uint8Array(4)); baseKey = ''; baseBox = null;
    atlasTex = tex2(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS, ATLAS, 0, gl.RGBA, UB, null);
    if (!atlasCtx) atlasCtx = newCanvas(ATLAS, ATLAS).getContext('2d', { willReadFrequently: false });
    if (atlasCtx) atlasCtx.clearRect(0, 0, ATLAS, ATLAS);
    cloudVbo = gl.createBuffer(); cloudVao = gl.createVertexArray();
    gl.bindVertexArray(cloudVao); gl.bindBuffer(gl.ARRAY_BUFFER, cloudVbo); gl.bufferData(gl.ARRAY_BUFFER, (1 + 14 * 40) * CLOUD_FLOATS * 4, gl.DYNAMIC_DRAW);
    [[0, 3, 0], [1, 3, 12], [2, 1, 24]].forEach(a => { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], F, false, CLOUD_FLOATS * 4, a[2]); });
    const cib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CLOUD_INDICES, gl.STATIC_DRAW);
    ovVbo = gl.createBuffer(); ovVao = gl.createVertexArray();
    gl.bindVertexArray(ovVao); gl.bindBuffer(gl.ARRAY_BUFFER, ovVbo); gl.bufferData(gl.ARRAY_BUFFER, ovBuf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, F, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, F, false, 24, 8); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, UB, true, 24, 20);
    skyVao = gl.createVertexArray();
    gl.bindVertexArray(null);
  }

  /** Off-screen target for the 3D picture when it is drawn smaller than the canvas. */
  const target = (w, h) => {
    if (fbo && fbo.w === w && fbo.h === h) return fbo;
    if (fbo) { gl.deleteFramebuffer(fbo.fb); gl.deleteRenderbuffer(fbo.col); gl.deleteRenderbuffer(fbo.dep); }
    const fb = gl.createFramebuffer(), col = gl.createRenderbuffer(), dep = gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.bindRenderbuffer(gl.RENDERBUFFER, col); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, col);
    gl.bindRenderbuffer(gl.RENDERBUFFER, dep); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dep);
    return (fbo = { fb, col, dep, w, h });
  };

  /** Filled highlight regions as a small picture over their bounding box; the terrain shader tints the ground with it. */
  const mask = hl => {
    if (!hl) { maskKey = ''; return; }
    if (maskKey === hl.key) return;
    maskKey = hl.key;
    const b = hl.box, hDeg = b.north - b.south, w = MASK, h = clamp(Math.round(MASK * hDeg / b.width), 16, MASK), cv = newCanvas(w, h), c = cv.getContext('2d');
    if (!c) return;
    for (const s of hl.shapes) {
      if (!s.fill) continue;
      c.beginPath();
      for (const r of s.rings) { for (let i = 0; i + 1 < r.length; i += 2) { const x = (((r[i + 1] - b.west) % 360) + 360) % 360 / b.width * w, y = (b.north - r[i]) / hDeg * h; if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.closePath(); }
      c.fillStyle = `rgba(${s.colour >>> 24},${(s.colour >>> 16) & 255},${(s.colour >>> 8) & 255},${(s.colour & 255) / 255})`; c.fill('evenodd');
    }
    gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, UB, cv); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); stats.uploads++;
  };

  /**
   * The base map's areas as a picture over the part of the planet in view (land red, lakes green, ice blue, edges antialiased), at
   * about the canvas resolution; the terrain shader colours the ground from it, so coasts are as sharp as the data at any zoom.
   * Drawn again only when the view leaves the box it was drawn for or the scale changes by more than a factor of 1.4.
   */
  const baseMask = view => {
    if (!o.baseMap || !o.baseMap.areas) return null;
    // the box in view: a grid of canvas points, the planet's visible cap when space shows, the poles when they are in the picture
    let s = 90, nn = -90, w = 180, e = -180, miss = false;
    for (let j = 0; j <= 12; j++) for (let i = 0; i <= 12; i++) {
      const p = view.ground(view.w * i / 12, view.h * j / 12);
      if (!p) { miss = true; continue; }
      const d = wrap180(p.lon - view.lon);
      if (p.lat < s) s = p.lat; if (p.lat > nn) nn = p.lat; if (d < w) w = d; if (d > e) e = d;
    }
    if (miss && !view.map) { const cap = Math.acos(clamp(R_EARTH / (R_EARTH + Math.max(view.altM, 1)), -1, 1)) * DEG; s = Math.min(s, view.lat - cap); nn = Math.max(nn, view.lat + cap); const hw = Math.abs(view.lat) + cap >= 89 ? 180 : Math.asin(clamp(Math.sin(cap / DEG) / Math.cos(view.lat / DEG), -1, 1)) * DEG; w = Math.min(w, -hw); e = Math.max(e, hw); }
    for (const pole of [90, -90]) { const p = view.project(pole, 0, 0); if (p.visible && p.x >= 0 && p.y >= 0 && p.x <= view.w && p.y <= view.h) { if (pole > 0) nn = 90; else s = -90; w = -180; e = 180; } }
    if (s > nn) return null;
    // snapped and padded, so that small moves reuse the picture
    const span = Math.max(e - w, (nn - s) * 0.5, 0.05), q = 2 ** (Math.ceil(Math.log2(span * 1.2) * 2) / 2), step = q / 16;
    let west = Math.floor((view.lon + w) / step - 1) * step, width = Math.min(360, Math.ceil((view.lon + e) / step + 1) * step - west);
    if (width >= 300) { width = 360; west = -180; }
    const south = Math.max(-90, Math.floor(s / step - 1) * step), north = Math.min(90, Math.ceil(nn / step + 1) * step);
    const key = `${west},${width},${south},${north}`;
    if (key === baseKey) return baseBox;
    baseKey = key;
    const hDeg = north - south, cosMid = Math.max(0.25, Math.cos((south + north) / 2 / DEG)), W = BASE, H = clamp(Math.round(BASE * hDeg / (width * cosMid)), 64, BASE);
    if (!baseCanvas || baseCanvas.width !== W || baseCanvas.height !== H) baseCanvas = newCanvas(W, H);
    const c = baseCanvas.getContext('2d');
    if (!c) return (baseBox = null);
    c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, W, H); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
    const kx = W / width, ky = H / hDeg;
    for (const [id, colour] of [['land', '#f00'], ['lake', '#0f0'], ['ice', '#00f']]) {
      c.beginPath();
      for (const r of o.baseMap.areas(id)) for (const shift of [-360, 0, 360]) {
        if (r.east + shift < west || r.west + shift > west + width) continue;
        const ll = r.ll;
        for (let i = 0; i + 1 < ll.length; i += 2) { const x = (ll[i + 1] + shift - west) * kx, y = (north - ll[i]) * ky; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
        c.closePath();
      }
      c.fillStyle = colour; c.fill('evenodd');
    }
    gl.bindTexture(gl.TEXTURE_2D, baseTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, UB, baseCanvas); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); stats.uploads++;
    return (baseBox = { west, south, width, height: hDeg });
  };

  // ---- overlay batch -----------------------------------------------------------------------------------------------------
  const vert = (x, y, u, v, k, colour) => {
    if ((ovN + 1) * 24 > ovBuf.byteLength) { const nb = new ArrayBuffer(ovBuf.byteLength * 2); new Uint8Array(nb).set(new Uint8Array(ovBuf)); ovBuf = nb; ovF = new Float32Array(nb); ovU = new Uint32Array(nb); }
    const q = ovN * 6; ovF[q] = x; ovF[q + 1] = y; ovF[q + 2] = u; ovF[q + 3] = v; ovF[q + 4] = k; ovU[q + 5] = colour; ovN++;
  };
  /** 0xRRGGBBAA to the little-endian word whose bytes are r, g, b, a. */
  const abgr = c => (((c & 255) << 24) | (((c >>> 8) & 255) << 16) | (((c >>> 16) & 255) << 8) | (c >>> 24)) >>> 0;
  const glyph = (str, px, bold) => {
    const key = (bold ? 'b' : 'n') + px + str;
    let g = glyphs.get(key);
    if (g || !atlasCtx) return g;
    const c = atlasCtx, pad = Math.ceil(px * 0.12) + 2;
    c.font = `${bold ? '600 ' : ''}${px}px ${FONT}`;
    const adv = c.measureText(str).width, w = Math.ceil(adv) + 2 * pad, h = Math.ceil(px * 1.3) + 2 * pad;
    if (penX + w + 1 > ATLAS) { penX = 1; penY += rowH + 1; rowH = 0; }
    if (penY + h + 1 > ATLAS) { atlasFull = true; return null; }
    c.textBaseline = 'middle'; c.textAlign = 'left'; c.lineJoin = 'round';
    c.lineWidth = Math.max(2, px * 0.2); c.strokeStyle = '#00ff00'; c.strokeText(str, penX + pad, penY + h / 2);
    c.fillStyle = '#ff0000'; c.fillText(str, penX + pad, penY + h / 2);
    g = { x: penX, y: penY, w, h, adv, pad };
    glyphs.set(key, g); penX += w + 1; rowH = Math.max(rowH, h); atlasDirty = true;
    return g;
  };
  const flush = () => {
    if (!ovN) return;
    if (atlasDirty && atlasCtx) { gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, UB, atlasCtx.canvas); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); atlasDirty = false; stats.uploads++; }
    gl.bindVertexArray(ovVao); gl.bindBuffer(gl.ARRAY_BUFFER, ovVbo);
    if (ovN * 24 > gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)) gl.bufferData(gl.ARRAY_BUFFER, ovBuf.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Uint8Array(ovBuf, 0, ovN * 24));
    gl.drawArrays(gl.TRIANGLES, 0, ovN); stats.drawCalls++; stats.triangles += ovN / 3; ovN = 0;
  };
  /** @param {import('./overlays.mjs').Op[]} ops */
  const overlays = (ops, W, H) => {
    if (!ops.length) return;
    use('overlay', S.OVERLAY_VS, S.OVERLAY_FS);
    f2('uInv', 2 / W, 2 / H); gl.uniform1i(U('uAtlas'), 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (atlasFull) { glyphs = new Map(); penX = penY = 1; rowH = 0; atlasFull = false; if (atlasCtx) atlasCtx.clearRect(0, 0, ATLAS, ATLAS); }
    for (const op of ops) {
      const k = op.colour === undefined ? 0 : abgr(op.colour), p = op.pts;
      if (op.op === 'fill' && p) { for (let i = 2; i + 3 < p.length; i += 2) { vert(p[0], p[1], 0, 0, 0, k); vert(p[i], p[i + 1], 0, 0, 0, k); vert(p[i + 2], p[i + 3], 0, 0, 0, k); } }
      else if (op.op === 'line' && p) {
        const hw = Math.max(0.5, (op.width || 1) / 2), n = p.length / 2, segs = op.closed ? n : n - 1, ext = Math.min(hw, 2) * 0.5, e = hw + 1;
        for (let i = 0; i < segs; i++) {
          const a = 2 * i, b = 2 * ((i + 1) % n);
          let dx = p[b] - p[a], dy = p[b + 1] - p[a + 1]; const l = Math.hypot(dx, dy);
          if (!(l > 1e-6)) continue;
          dx /= l; dy /= l;
          const ax = p[a] - dx * ext, ay = p[a + 1] - dy * ext, bx = p[b] + dx * ext, by = p[b + 1] + dy * ext, nx = -dy * e, ny = dx * e;
          vert(ax + nx, ay + ny, e, hw, 2, k); vert(ax - nx, ay - ny, -e, hw, 2, k); vert(bx + nx, by + ny, e, hw, 2, k);
          vert(ax - nx, ay - ny, -e, hw, 2, k); vert(bx - nx, by - ny, -e, hw, 2, k); vert(bx + nx, by + ny, e, hw, 2, k);
        }
      } else if (op.op === 'text' && op.text) {
        const px = Math.min(96, Math.max(8, Math.round((op.size || 12) / 2) * 2)), bold = Boolean(op.bold), str = op.text;
        // letters one by one from the atlas; text in a script that needs shaping is kept whole
        let whole = false; for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) > 0x24f) { whole = true; break; }
        const parts = whole ? [str] : [...str], gs = parts.map(ch => glyph(ch, px, bold));
        let width = 0; for (const g of gs) if (g) width += g.adv;
        let x = (op.x || 0) - width * (op.align ?? 0.5);
        for (const g of gs) {
          if (!g) continue;
          const x0 = Math.round(x) - g.pad, y0 = Math.round((op.y || 0) - g.h / 2), x1 = x0 + g.w, y1 = y0 + g.h, u0 = g.x / ATLAS, v0 = g.y / ATLAS, u1 = (g.x + g.w) / ATLAS, v1 = (g.y + g.h) / ATLAS;
          vert(x0, y0, u0, v0, 1, k); vert(x1, y0, u1, v0, 1, k); vert(x1, y1, u1, v1, 1, k); vert(x0, y0, u0, v0, 1, k); vert(x1, y1, u1, v1, 1, k); vert(x0, y1, u0, v1, 1, k);
          x += g.adv;
        }
      } else if (op.op === 'clip') { flush(); gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.round(op.x || 0), Math.round(H - (op.y || 0) - (op.h || 0)), Math.max(0, Math.round(op.w || 0)), Math.max(0, Math.round(op.h || 0))); }
      else if (op.op === 'unclip') { flush(); gl.disable(gl.SCISSOR_TEST); }
    }
    flush(); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
  };

  // ---- shared uniforms ---------------------------------------------------------------------------------------------------
  const fogU = (L, view) => { f4('uFog', view.map ? 0 : L.fogSea, 1 / L.hazeScaleM, L.inCloud * 0.03, Math.max(0, view.altM)); f3('uFogCol', L.fog); };
  const mapU = view => { f4('uMapA', view.k, view.cosScale, view.s0, view.stereo ? 1 : 0); f4('uMapB', view.cr, view.sr, 2 / view.w, 2 / view.h); f1('uMapC', view.c0); };
  const frameU = (view, fr, rot) => {
    if (!rot) { for (let i = 0; i < 9; i++) m9[i] = fr[i]; rot = m9; }
    gl.uniformMatrix3fv(U('uRot'), false, rot);
    if (view.map) { v3[0] = fr[9]; v3[1] = fr[10]; v3[2] = fr[11]; } else view.offset(fr, v3);
    gl.uniform3fv(U('uOff'), v3);
  };

  /**
   * Draw one frame. @param {any} n normalised handle @param {any} view @param {any} L frame light @param {any} P prepared scene @param {import('./overlays.mjs').Op[]} ops @param {any} tier
   */
  function frame(n, view, L, P, ops, tier) {
    stats.drawCalls = 0; stats.triangles = 0; stats.uploads = 0; stats.patchUploads = 0;
    const W = view.w, H = view.h, map = view.map, sc = Math.min(tier.scale, Math.sqrt(tier.maxPixels / (W * H))), direct = sc > 0.97, sw = direct ? W : Math.max(16, Math.round(W * sc)), sh = direct ? H : Math.max(16, Math.round(H * sc));
    gl.bindFramebuffer(gl.FRAMEBUFFER, direct ? null : target(sw, sh).fb);
    gl.viewport(0, 0, sw, sh); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true);
    gl.clearColor(0.05, 0.16, 0.3, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const space = map ? 0 : smooth(3e4, 4e5, view.altM), pxAngle = map ? 1 / view.metresPerPx : view.pxAngle * H / sh, widthScale = Math.max(1, sh / 700);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, noise);

    if (!map) {       // sky first, without depth
      use('sky', S.SKY_VS, S.SKY_FS); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      f3('uR', view.R); f3('uU', view.U); f3('uF', view.F); f2('uTan', view.tanX, view.tanY); f3('uUp', view.frame.subarray(6, 9)); f3('uSun', L.sun); f3('uMoon', L.moon);
      f3('uZen', L.zenith); f3('uHor', L.horizon); f3('uFogCol', L.fog); f3('uSunTint', L.sunTint);
      f4('uP', view.horizonSin, (R_EARTH + Math.max(view.altM, 0)) / R_EARTH, L.stars, L.lit ? L.twilight : 0);
      f4('uQ', L.lit ? L.sunIntensity : 0, L.moonLight, clamp(smooth(3 / 30000, 3 / 2000, L.fogDensity) + L.cover * 0.9, 0, 1), L.inCloud);
      gl.uniform1i(U('uNoise'), 0);
      f4('uCl', L.lit && !L.inCloud ? clamp(0.9 - L.cover * 1.5, 0, 0.8) * (1 - L.night) : 0, n.t || 0, tier.noise, 0);
      gl.bindVertexArray(skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); stats.drawCalls++;
      gl.depthMask(true);
    }

    // terrain
    mask(P.highlight);
    use(map ? 'terrainMap' : 'terrain', S.TERRAIN_VS, S.TERRAIN_FS, map ? 'MAP' : '');
    const bb = baseMask(view);
    gl.uniform1i(U('uNoise'), 0); gl.uniform1i(U('uMask'), 1); gl.uniform1i(U('uBase'), 2); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, baseTex); gl.activeTexture(gl.TEXTURE0);
    f4('uBaseBox', bb ? bb.west : 0, bb ? bb.south : 0, bb ? 1 / bb.width : 0, bb ? 1 / bb.height : 0); f3('uBaseCol', BASE_COL);
    if (map) { mapU(view); gl.uniform3f(U('uCam'), 0, 0, 0); gl.disable(gl.DEPTH_TEST); }
    else { gl.uniformMatrix4fv(U('uVP'), false, view.vp); gl.uniform3f(U('uCam'), view.pos[0], view.pos[1], view.pos[2]); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); }
    f3('uSun', L.sun); f3('uSunCol', L.sunColour); f3('uAmb', L.ambient); f3('uSky', L.horizon); f1('uTerminator', L.lit ? 1 : 0);
    f4('uOpt', L.night, tier.noise, view.altM, space); fogU(L, view);
    const hb = P.highlight ? P.highlight.box : null;
    f4('uMaskBox', hb ? hb.west : 0, hb ? hb.south : 0, hb ? 1 / hb.width : 0, hb ? 1 / (hb.north - hb.south) : 0);
    const lBox = U('uBox'), lGrid = U('uGrid'), lTex = U('uTexO');
    // new patches are uploaded in the frame they were built in (a bounded number), not when they are first drawn
    const upload = nd => {
      if (!nd.data) return nd.gpu;
      free(nd.gpu);
      const g = nd.gpu = vao(nd.data.vertices, PATCH_STRIDE, [[0, 3, F, false, 0], [1, 1, F, false, 12], [2, 4, B, true, 16], [3, 4, UB, true, 20], [4, 4, UB, true, 24]], nd.data.indices);
      stats.patchUploads++; g.version = nd.version; g.count = nd.data.indexCount; g.gridCount = nd.data.gridIndexCount; g.cols = nd.data.cols; g.rows = nd.data.rows;
      nd.data = null;
      return g;
    };
    for (const nd of P.fresh) upload(nd);
    for (const nd of P.patches) {
      const g = nd.gpu && nd.gpu.version === nd.version ? nd.gpu : upload(nd);
      if (!g) continue;
      frameU(view, nd.frame, nd.rot); gl.uniform3fv(lTex, nd.texO);
      if (map) {
        const rel = wrap180(nd.west - view.lon), wd = nd.east - nd.west;
        gl.uniform2i(lGrid, g.cols + 1, g.rows + 1);
        gl.uniform4f(lBox, rel, nd.south - view.lat, wd / g.cols, (nd.north - nd.south) / g.rows); draw(g, g.gridCount);
        if (!view.stereo && rel + wd > 180) { gl.uniform4f(lBox, rel - 360, nd.south - view.lat, wd / g.cols, (nd.north - nd.south) / g.rows); draw(g, g.gridCount); }
      } else draw(g, g.count);
    }

    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    // runways
    if (P.runways && !map) {
      const r = P.runways;
      if (!r.gpu) r.gpu = vao(r.data.vertices, RUNWAY_STRIDE, [[0, 3, F, false, 0], [1, 3, F, false, 12], [2, 2, F, false, 24], [3, 2, F, false, 32], [4, 4, UB, true, 64], [5, 3, F, false, 40], [6, 3, F, false, 52]], r.data.indices);
      use('runway', S.RUNWAY_VS, S.RUNWAY_FS);
      gl.uniformMatrix4fv(U('uVP'), false, view.vp); gl.uniform1i(U('uNoise'), 0); f4('uPx', pxAngle, 0.003, widthScale, 0); fogU(L, view);
      gl.uniform3f(U('uCamF'), view.F[0], view.F[1], view.F[2]); gl.uniform3f(U('uCamR'), view.R[0], view.R[1], view.R[2]); gl.uniform3f(U('uCamU'), view.U[0], view.U[1], view.U[2]);
      f4('uTan', view.tanX, view.tanY, sw, sh);
      const up = Math.max(0, L.sunEnu[2]);
      gl.uniform3f(U('uLight'), L.ambient[0] + L.sunColour[0] * up, L.ambient[1] + L.sunColour[1] * up, L.ambient[2] + L.sunColour[2] * up);
      const em = rgba(n.runways.color, 0x40ff80ff);
      f4('uEm', (em >>> 24) / 255, ((em >>> 16) & 255) / 255, ((em >>> 8) & 255) / 255, 0.9); f4('uOpt', clamp(L.night + L.twilight, 0, 1), n.runways.lights ? 1 : 0, 0, 0);
      frameU(view, r.data.frame, null); draw(r.gpu, r.data.indexCount);
    }
    // lines
    if (P.lines.length) {
      use(map ? 'ribbonMap' : 'ribbon', S.RIBBON_VS, S.RIBBON_FS, map ? 'MAP' : '');
      if (map) mapU(view); else gl.uniformMatrix4fv(U('uVP'), false, view.vp);
      fogU(L, view);
      for (const r of P.lines) {
        if (!r.data.indexCount) continue;
        if (!r.gpu) r.gpu = vao(r.data.vertices, RIBBON_STRIDE, [[0, 3, F, false, 0], [1, 3, F, false, 12], [2, 2, F, false, 24], [3, 2, F, false, 32], [4, 4, UB, true, 40]], r.data.indices);
        const fr = r.data.frame;
        f4('uPx', pxAngle, r.lift ?? 0.004, widthScale, 0); frameU(view, fr, null);
        if (map) f2('uLL', wrap180(Math.atan2(fr[7], fr[6]) * DEG - view.lon), Math.asin(clamp(fr[8], -1, 1)) * DEG - view.lat);
        draw(r.gpu, r.data.indexCount);
      }
    }
    gl.depthMask(true);
    // vehicles
    if (P.meshes.length) {
      use('mesh', S.MESH_VS, S.MESH_FS);
      gl.uniformMatrix4fv(U('uVP'), false, view.vp); f3('uSun', L.sun); f3('uSunCol', L.sunColour); f3('uAmb', L.ambient); fogU(L, view);
      for (const m of P.meshes) {
        const mesh = /** @type {any} */ (m.mesh);
        if (!mesh.gpu || mesh.owner !== owner) { mesh.gpu = vao(mesh.vertices, MESH_STRIDE, [[0, 3, F, false, 0], [1, 4, B, true, 12], [2, 4, UB, true, 16]], null); mesh.owner = owner; }
        frameU(view, m.frame, m.rot); gl.bindVertexArray(mesh.gpu.va); gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount); stats.drawCalls++; stats.triangles += mesh.vertexCount / 3;
      }
    }
    // clouds
    if (P.clouds.length) {
      use('cloud', S.CLOUD_VS, S.CLOUD_FS); gl.depthMask(false);
      gl.uniformMatrix4fv(U('uVP'), false, view.vp); gl.uniform1i(U('uNoise'), 0); fogU(L, view);
      const top = L.ambient.map((a, i) => Math.min(1.05, a * 1.25 + L.sunColour[i] * 0.75)), bottom = L.ambient.map((a, i) => Math.min(1, a * 1.3 + L.sunColour[i] * 0.3));
      f3('uTop', top); f3('uBottom', bottom);
      gl.bindVertexArray(cloudVao); gl.bindBuffer(gl.ARRAY_BUFFER, cloudVbo);
      for (const c of P.clouds) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, c.vertices); f4('uLayer', c.cover, c.below, tier.noise, 0); gl.drawElements(gl.TRIANGLES, CLOUD_INDICES.length, gl.UNSIGNED_SHORT, 0); stats.drawCalls++; stats.triangles += CLOUD_INDICES.length / 3; }
      gl.depthMask(true);
    }
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);

    if (!direct) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, sw, sh, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, W, H);
    overlays(ops, W, H);
    gl.bindVertexArray(null);
    return stats;
  }

  init();
  return {
    frame, init,
    /** Free what the drawing layer holds for a scene item (patch, line set, runway set). */
    release(item) { if (item && item.gpu) { try { free(item.gpu); } catch (e) { log(e); } item.gpu = null; } },
    dispose() { for (const p of Object.values(progs)) gl.deleteProgram(p.prog); progs = {}; },
  };
}
