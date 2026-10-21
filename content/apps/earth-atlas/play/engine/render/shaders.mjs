// @ts-check
// GLSL ES 3.00 sources of the WebGL2 renderer, inline so that nothing is downloaded.
// Spaces: "rel" = earth-centred axes with the camera at the origin (camera-relative, so 32-bit floats stay exact near the eye).

const HEAD = '#version 300 es\nprecision highp float;\nprecision highp sampler3D;\n';

// Flat map projection of a longitude/latitude offset (degrees) from the map centre to clip space.
const MAP = `
uniform vec4 uMapA;   // pixels per degree, cos(centre latitude), sin(centre latitude), 1 = stereographic
uniform vec4 uMapB;   // cos(rotation), sin(rotation), 2 / width, 2 / height
uniform float uMapC;  // true cos(centre latitude)
vec2 mapPx(vec2 d) {
  vec2 p;
  if (uMapA.w < 0.5) p = vec2(d.x * uMapA.y, d.y) * uMapA.x;
  else {
    float dl = radians(d.x), dp = radians(d.y), sp = uMapA.z * cos(dp) + uMapC * sin(dp), cp = uMapC * cos(dp) - uMapA.z * sin(dp), hl = sin(dl * 0.5);
    float den = 2.0 + (uMapA.z * sp + uMapC * cp - 1.0) - 2.0 * uMapC * cp * hl * hl;
    p = (2.0 / max(den, 1e-6)) * vec2(cp * sin(dl), sin(dp) + 2.0 * uMapA.z * cp * hl * hl) * uMapA.x * 57.29577951;
  }
  return vec2(p.x * uMapB.x - p.y * uMapB.y, p.x * uMapB.y + p.y * uMapB.x);
}
`;

// Haze between the eye and a point: exponential in distance, thinning with height.
const FOG = `
uniform vec4 uFog;     // density at sea level (1/m), 1 / scale height, extra uniform density (in cloud), height of the eye
uniform vec3 uFogCol;
float fogAmount(float dist, float h) {
  float a = exp(-max(uFog.w, 0.0) * uFog.y), b = exp(-max(h, 0.0) * uFog.y), k = (h - uFog.w) * uFog.y;
  return 1.0 - exp(-dist * (uFog.x * (abs(k) < 1e-3 ? a : (a - b) / k) + uFog.z));
}
`;

export const TERRAIN_VS = HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in float aH; layout(location=2) in vec4 aN; layout(location=3) in vec4 aCol; layout(location=4) in vec4 aMat;
uniform mat4 uVP; uniform mat3 uRot; uniform vec3 uOff; uniform vec3 uTexO; uniform vec3 uCam;
out vec3 vRel; out vec3 vN; out vec3 vUp; out vec4 vCol; out vec4 vMat; out vec3 vTex; out float vH;
#ifdef MAP
${MAP}
uniform vec4 uBox;    // west and south as offsets from the map centre, degrees per column and per row
uniform ivec2 uGrid;  // vertices per row of the grid
#endif
void main() {
  vec3 w = uRot * aPos;
  vN = aN.xyz; vCol = aCol; vMat = aMat; vH = aH; vTex = w + uTexO;
#ifdef MAP
  int id = gl_VertexID;
  vec2 d = uBox.xy + vec2(float(id % uGrid.x), float(id / uGrid.x)) * uBox.zw;
  gl_Position = vec4(mapPx(d) * uMapB.zw, 0.0, 1.0);
  vRel = vec3(0.0, 0.0, 1.0); vUp = normalize(w + uOff + uCam);
#else
  vRel = w + uOff; vN = uRot * vN; vUp = normalize(vRel + uCam);
  gl_Position = uVP * vec4(vRel, 1.0);
#endif
}`;

export const TERRAIN_FS = HEAD + `
in vec3 vRel; in vec3 vN; in vec3 vUp; in vec4 vCol; in vec4 vMat; in vec3 vTex; in float vH;
uniform sampler3D uNoise; uniform sampler2D uMask;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uSky;
uniform vec4 uOpt;      // night 0..1, detail octaves, camera height above sea, space 0..1
uniform vec4 uMaskBox;  // west, south, 1 / width, 1 / height in degrees; width 0 = no highlight
uniform float uTerminator;
uniform sampler2D uBase; uniform vec4 uBaseBox; uniform vec3 uBaseCol;  // built-in base map: land (r), lakes (g), ice (b) over a box like uMaskBox; z 0 = none
${FOG}
out vec4 o;
float cell(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 up = normalize(vUp), n = normalize(vN);
#ifdef MAP
  float dist = 0.0; vec3 V = vec3(0.0, 0.0, -1.0), upL = vec3(0.0, 0.0, 1.0);
#else
  float dist = length(vRel); vec3 V = vRel / dist, upL = up;
#endif
  float slope = 1.0 - dot(n, upL);
  vec4 n1 = texture(uNoise, vTex / 4096.0), n2 = texture(uNoise, vTex.yzx / 512.0);
  vec4 n3 = uOpt.y > 2.5 ? texture(uNoise, vTex.zxy / 64.0) : vec4(0.5), n4 = uOpt.y > 3.5 ? texture(uNoise, vTex / 8.0) : vec4(0.5);
  vec4 col = vCol, mat = vMat;
  bool plain = uBaseBox.z > 0.0;
  if (plain) {
    // the base map: flat colours from its picture of the areas in view (crisp at any zoom), no ground texture
    vec2 ll = vec2(degrees(atan(up.y, up.x)), degrees(asin(clamp(up.z, -1.0, 1.0))));
    vec4 m = texture(uBase, vec2(mod(ll.x - uBaseBox.x + 720.0, 360.0) * uBaseBox.z, (ll.y - uBaseBox.y) * uBaseBox.w));
    col = vec4(mix(uBaseCol, vec3(0.92, 0.94, 0.97), m.b), 0.0);
    mat = vec4(clamp(max(1.0 - m.r, m.g) - m.b, 0.0, 1.0), 0.0, 0.0, mix(0.8, 0.3, m.g));
    n1 = vec4(0.5); n2 = vec4(0.5); n3 = vec4(0.5); n4 = vec4(0.5); n = upL; slope = 0.0;
  }
  float water = smoothstep(0.42, 0.58, mat.r + (n2.r - 0.5) * 0.2 * (1.0 - abs(2.0 * mat.r - 1.0)));
  // land
  vec3 c = col.rgb * (0.8 + 0.4 * n1.r) * (0.9 + 0.2 * (n2.g * 0.6 + n3.r * 0.4));
  if (!plain) {
    // broad patches of lighter and drier ground and darker vegetation, seen across the whole view
    vec4 n0 = texture(uNoise, vTex / 23000.0 + 0.31);
    c *= (0.86 + 0.28 * n0.g) * mix(vec3(1.0), vec3(1.1, 1.0, 0.8), smoothstep(0.45, 0.8, n0.b) * 0.55 * (1.0 - mat.b));
  }
  c *= mix(1.0, 0.72 + 0.56 * n3.g * (0.6 + 0.8 * n4.r), mat.g);
  if (!plain) {
    // close ground, on every quality tier: dry and lush patches every few tens of metres, blades and clods within a few metres of the eye,
    // furrows on cropland, speckle on bare ground and sand; faded out with distance so that nothing shimmers
    float nearW = 1.0 - smoothstep(40.0, 900.0, dist), vege = (1.0 - mat.b) * (1.0 - water) * (1.0 - smoothstep(0.1, 0.32, slope));
    vec4 g0 = texture(uNoise, vTex / 17.0 + 0.7), g1 = texture(uNoise, vTex / 1.9), g2 = texture(uNoise, vTex.zxy / 0.37 + 0.2);
    float mott = (g0.r - 0.5) * 0.5 + (g1.g - 0.5) * 0.45 + (g2.b - 0.5) * 0.5 * (1.0 - smoothstep(10.0, 140.0, dist));
    vec3 dry = vec3(1.16, 1.06, 0.78), lush = vec3(0.82, 1.0, 0.8);
    c *= mix(vec3(1.0), mix(lush, dry, smoothstep(-0.2, 0.25, g0.g - 0.5 + mott * 0.4)), 0.55 * vege * (1.0 - smoothstep(300.0, 6000.0, dist)));
    c *= 1.0 + mott * 0.7 * nearW * vege + (g2.g - 0.5) * 0.3 * nearW * mat.b;
    float row = 0.5 + 0.5 * sin(dot(vTex.xy, vec2(0.83, 0.56)) * 2.6), rv = clamp(1.4 - 2.2 * fwidth(dot(vTex.xy, vec2(0.83, 0.56)) * 2.6), 0.0, 1.0);
    c *= 1.0 + (row - 0.5) * 0.22 * col.a * rv * nearW;
  }
  // fields and town blocks: cells of a coarse lattice, faded out where one pixel covers several of them
  float lights = 0.12;
  if (uOpt.y > 2.5) {
    vec3 fc = vTex / vec3(230.0, 310.0, 270.0); float fh = cell(floor(fc)), fv = clamp(1.3 - 1.5 * (fwidth(fc.x) + fwidth(fc.y) + fwidth(fc.z)), 0.0, 1.0);
    c = mix(c, c * (0.74 + 0.52 * fh) + vec3(0.07, 0.02, -0.03) * (fh - 0.5), col.a * fv);
    vec3 bc = vTex / vec3(70.0, 90.0, 80.0), be = abs(fract(bc) - 0.5); float bv = clamp(1.3 - 1.5 * (fwidth(bc.x) + fwidth(bc.y) + fwidth(bc.z)), 0.0, 1.0);
    vec3 town = vec3(0.56, 0.55, 0.54) * mix(1.0, (0.78 + 0.44 * cell(floor(bc))) * (1.0 - 0.35 * step(0.43, max(be.x, max(be.y, be.z)))), bv);
    c = mix(c, town, mat.b * 0.8);
    vec3 lc = vTex / 45.0; float lv = clamp(1.3 - 1.5 * (fwidth(lc.x) + fwidth(lc.y) + fwidth(lc.z)), 0.0, 1.0);
    lights = mix(lights, step(0.7, cell(floor(lc))) * smoothstep(0.16, 0.03, length(fract(lc) - 0.5)) * 3.0 + 0.03, lv);
  } else c = mix(c, vec3(0.56, 0.55, 0.54), mat.b * 0.8);
  float rock = smoothstep(0.1, 0.32, slope + (n3.r - 0.5) * 0.08) * (1.0 - mat.b);
  c = mix(c, vec3(0.43, 0.4, 0.37) * (0.75 + 0.5 * n3.g), rock * 0.85);
  float line = 5200.0 - 5200.0 * smoothstep(0.5, 1.0, abs(up.z));
  float snow = plain ? 0.0 : smoothstep(-150.0, 250.0, vH - line + (n1.a * 0.75 + n2.a * 0.25 - 0.5) * 900.0) * (1.0 - 0.6 * rock);
  c = mix(c, vec3(0.93, 0.95, 0.98), snow);
  // water
  vec3 wc = mix(vec3(0.16, 0.42, 0.52), vec3(0.03, 0.12, 0.3), mat.a) * (0.92 + 0.16 * n1.b);
  vec3 nw = normalize(upL + (vec3(n3.a, n4.a, n3.b) - 0.5) * 0.06 * (uOpt.y > 2.5 ? 1.0 : 0.0));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-V, nw), 0.0), 5.0);
  wc = mix(wc, uSky, fres * 0.55);
  float spec = pow(max(dot(nw, normalize(uSun - V)), 0.0), 260.0) * 1.6 + pow(max(dot(reflect(V, nw), uSun), 0.0), 40.0) * 0.07;
  n = normalize(mix(n, nw, water)); c = mix(c, wc, water);
  // light
#ifdef MAP
  float ndl = clamp(dot(n, normalize(vec3(-0.5, 0.5, 0.75))), 0.0, 1.0), dayf = uTerminator > 0.5 ? smoothstep(-0.12, 0.12, dot(up, uSun)) : 1.0;
  vec3 lit = c * (0.38 + 0.85 * ndl) * mix(0.3, 1.0, dayf);
  float night = (1.0 - dayf);
#else
  float ndl = max(dot(n, uSun), 0.0), sunUp = smoothstep(-0.08, 0.08, dot(up, uSun));
  vec3 lit = c * (uAmb * (0.65 + 0.35 * dot(n, up)) + uSunCol * ndl * sunUp) + uSunCol * spec * water * sunUp * (1.0 - 0.75 * uOpt.w);
  float night = uOpt.x * (1.0 - sunUp);
#endif
  lit += vec3(1.0, 0.8, 0.5) * mat.b * night * lights * (0.5 + n2.g);
  if (uMaskBox.z > 0.0) {
    vec2 ll = vec2(degrees(atan(up.y, up.x)), degrees(asin(clamp(up.z, -1.0, 1.0))));
    vec2 uv = vec2(mod(ll.x - uMaskBox.x + 720.0, 360.0) * uMaskBox.z, (ll.y - uMaskBox.y) * uMaskBox.w);
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) { vec4 m = texture(uMask, uv); lit = mix(lit, m.rgb, m.a * 0.7); }
  }
#ifndef MAP
  lit = mix(lit, uFogCol, fogAmount(dist, vH));
  // seen from space: a blue veil towards the limb
  lit = mix(lit, uSky * (0.4 + 0.6 * sunUp), uOpt.w * 0.75 * pow(1.0 - max(dot(-V, up), 0.0), 3.0));
#endif
  o = vec4(lit, 1.0);
}`;

export const SKY_VS = HEAD + `
out vec2 vP;
void main() { vP = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; gl_Position = vec4(vP, 1.0, 1.0); }`;

export const SKY_FS = HEAD + `
in vec2 vP;
uniform vec3 uR; uniform vec3 uU; uniform vec3 uF; uniform vec2 uTan; uniform vec3 uUp; uniform vec3 uSun; uniform vec3 uMoon;
uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uFogCol; uniform vec3 uSunTint;
uniform vec4 uP;   // sine of the horizon's elevation, camera distance from the planet's centre in planet radii, star visibility, twilight 0..1
uniform vec4 uQ;   // sun brightness 0..1, moon light 0..1, haze 0..1 (thick air hides the disc), in cloud 0..1
uniform sampler3D uNoise; uniform vec4 uCl;   // fair-weather cloud amount 0..1, animation time, noise octaves, 0
out vec4 o;
float hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 d = normalize(uF + vP.x * uTan.x * uR + vP.y * uTan.y * uU);
  float mu = dot(d, uUp), t = clamp((mu - uP.x) / (1.0 - uP.x), 0.0, 1.0);
  // air on the sight line: all of it from the ground, a thin shell at the limb from space
  float hmin = (mu < 0.0 ? uP.y * sqrt(max(1.0 - mu * mu, 0.0)) : uP.y) - 1.0;
  float air = exp(-max(hmin, 0.0) * 6371.0 / 22.0);
  vec3 c = mix(uHor, uZen, pow(t, 0.45));
  float sd = max(dot(d, uSun), 0.0), low = pow(1.0 - t, 4.0);
  c = mix(c, vec3(0.98, 0.52, 0.22), uP.w * low * (0.35 + 0.65 * pow(sd, 3.0)));
  c += uSunTint * uQ.x * (pow(sd, 12.0) * 0.12 + pow(sd, 90.0) * 0.35 + pow(sd, 400.0) * 0.5) * (1.0 - uQ.z);
  // a warm band of haze on the horizon, brightest toward the sun
  c += vec3(1.0, 0.8, 0.56) * low * low * uQ.x * (1.0 - uQ.z) * (0.06 + 0.32 * pow(sd, 3.0));
  // a few soft fair-weather clouds on a plane high above, thinning into the haze at the horizon
  if (uCl.x > 0.01 && mu > uP.x + 0.008 && air > 0.5) {
    float hh = max(mu - uP.x, 0.035);
    vec3 pp = (d - uUp * mu) / hh * 0.16 + vec3(uCl.y * 0.004, 0.0, uCl.y * 0.002);
    float nz = texture(uNoise, pp).r * 0.62 + texture(uNoise, pp * 2.7 + 0.37).g * (uCl.z > 2.5 ? 0.38 : 0.19);
    float cv = smoothstep(0.62 - 0.17 * uCl.x, 0.84 - 0.1 * uCl.x, nz) * smoothstep(0.03, 0.2, mu - uP.x);
    float lightSide = pow(max(dot(normalize(d - uUp * mu), normalize(uSun - uUp * dot(uSun, uUp)) ), 0.0), 2.0) * 0.4;
    vec3 cc = mix(vec3(0.55, 0.6, 0.7), vec3(1.0, 0.98, 0.95) * (0.85 + 0.2 * uSunTint), clamp(0.55 + lightSide + (nz - 0.6) * -1.0, 0.0, 1.0));
    cc = mix(uHor * 0.5, cc, clamp(uQ.x * 1.4, 0.0, 1.0));
    c = mix(c, cc, cv * 0.88 * uCl.x * (1.0 - uQ.z));
  }
  c *= air;
  float starry = max(uP.z * air, 1.0 - smoothstep(0.0, 0.2, air));
  if (starry > 0.01 && mu > uP.x) {
    vec3 q = d * 140.0, cell = floor(q); float h = hash(cell);
    c += vec3(0.9, 0.93, 1.0) * starry * step(0.992, h) * smoothstep(0.45, 0.1, length(fract(q) - 0.5)) * (0.4 + 0.6 * hash(cell + 7.0));
  }
  float clear = (1.0 - uQ.z) * (1.0 - uQ.w);
  c += uSunTint * step(0.01, uQ.x) * smoothstep(0.99985, 0.99996, dot(d, uSun)) * 3.0 * clear;
  c = mix(c, vec3(0.92, 0.93, 0.88), smoothstep(0.99988, 0.99996, dot(d, uMoon)) * (0.25 + 0.75 * uQ.y) * clear);
  if (mu < uP.x) c = mix(c, uFogCol, air);     // below the horizon and nothing drawn there: haze
  o = vec4(mix(c, uFogCol, uQ.w), 1.0);
}`;

export const RIBBON_VS = HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aSide; layout(location=2) in vec2 aLL; layout(location=3) in vec2 aW; layout(location=4) in vec4 aCol;
uniform mat4 uVP; uniform mat3 uRot; uniform vec3 uOff; uniform vec4 uPx;   // metres per pixel at one metre, lift towards the eye, width scale, 0
out vec4 vCol; out float vEdge; out float vDist;
#ifdef MAP
${MAP}
uniform vec2 uLL;   // frame origin as an offset from the map centre, degrees
#endif
void main() {
  vCol = aCol; vEdge = sign(aW.y);
#ifdef MAP
  vec2 p = mapPx(uLL + aLL), s = normalize(vec2(aSide.x * uMapB.x - aSide.y * uMapB.y, aSide.x * uMapB.y + aSide.y * uMapB.x) + 1e-6);
  float hw = max(aW.x * uPx.x, abs(aW.y) * uPx.z) + 0.5;
  gl_Position = vec4((p + s * hw) * uMapB.zw, 0.0, 1.0); vDist = 0.0;
#else
  vec3 w = uRot * aPos + uOff; float d = length(w);
  w += uRot * aSide * (max(aW.x, abs(aW.y) * uPx.z * uPx.x * d) + 0.5 * uPx.x * d);
  vDist = d;
  gl_Position = uVP * vec4(w * (1.0 - uPx.y), 1.0);
#endif
}`;

export const RIBBON_FS = HEAD + `
in vec4 vCol; in float vEdge; in float vDist;
${FOG}
out vec4 o;
void main() {
  float a = clamp((1.0 - abs(vEdge)) / max(fwidth(vEdge), 1e-4), 0.0, 1.0);
  o = vec4(mix(vCol.rgb, uFogCol, fogAmount(vDist, uFog.w)), vCol.a * a);
}`;

export const RUNWAY_VS = HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aSide; layout(location=2) in vec2 aUV; layout(location=3) in vec2 aDim; layout(location=4) in vec4 aFlag;
layout(location=5) in vec3 aAlong; layout(location=6) in vec3 aCtr;
uniform mat4 uVP; uniform mat3 uRot; uniform vec3 uOff; uniform vec4 uPx;
out vec2 vUV; out vec2 vDim; out vec2 vFlag; out float vDist; out vec3 vAlong; out vec3 vAcross; out vec3 vCtr;
void main() {
  vec3 w = uRot * aPos + uOff; float d = length(w), grow = max(0.0, (aFlag.y > 0.5 ? 2.2 : 1.0) * uPx.x * d - aDim.y * 0.5);
  w += uRot * aSide * grow;
  vUV = aUV; vDim = aDim; vFlag = aFlag.xy * vec2(255.0, 1.0); vDist = d;
  // the plane of this piece of strip, in camera-relative axes: the same for all its vertices
  vAlong = uRot * aAlong; vAcross = uRot * (aSide * sign(aUV.y)); vCtr = uRot * aCtr + uOff;
  gl_Position = uVP * vec4(w * (1.0 - uPx.y), 1.0);
}`;

export const RUNWAY_FS = HEAD + `
in vec2 vUV; in vec2 vDim; in vec2 vFlag; in float vDist; in vec3 vAlong; in vec3 vAcross; in vec3 vCtr;
uniform sampler3D uNoise; uniform vec3 uLight; uniform vec4 uEm; uniform vec4 uOpt;   // night, lights on, 0, 0
uniform mat3 uRot; uniform vec3 uOff; uniform vec3 uCamF; uniform vec3 uCamR; uniform vec3 uCamU; uniform vec4 uTan;   // tan half fov x, y, viewport size
${FOG}
out vec4 o;
float band(float v, float c, float hw, float px) { return clamp((hw - abs(v - c)) / px + 0.5, 0.0, 1.0); }
// a repeating bar pattern (duty = share that is paint) that settles to its average where one pixel covers several periods
float stripes(float v, float period, float duty) {
  float pf = fwidth(v) / period;
  return mix(duty, step(fract(v / period), duty), clamp(1.6 - pf * 2.0, 0.0, 1.0));
}
void main() {
  // where this pixel's sight line meets the strip (exact, whatever the shape of the triangle: a cockpit is right over the strip)
  vec2 fc = gl_FragCoord.xy / uTan.zw;
  vec3 dir = normalize(uCamF + (2.0 * fc.x - 1.0) * uTan.x * uCamR + (2.0 * fc.y - 1.0) * uTan.y * uCamU), A = normalize(vAlong), B = normalize(vAcross), N = normalize(cross(A, B));
  float dn = dot(dir, N), tt = dn * dn > 1e-10 ? dot(vCtr, N) / dn : -1.0;
  float dist = tt > 0.0 ? tt : vDist;
  vec3 P = dir * dist, rel = P - vCtr, vTex = (P - uOff) * uRot;
  float L = vDim.x, W = vDim.y, x = vUV.x + dot(rel, A), y = dot(rel, B), ax = abs(x), ay = abs(y), px = max(fwidth(y), 1e-3), pl = max(fwidth(x), 1e-3);
  float paved = vFlag.x < 1.5 ? 1.0 : 0.0, on = step(ay, max(W * 0.5, px)), e = L * 0.5 - ax;   // e = distance from the nearer end
  vec3 q = vTex;
  float n = texture(uNoise, q / 8.0).r, nb = texture(uNoise, q / 40.0).g, nf = texture(uNoise, q / 0.9).b;
  float near = clamp(1.0 - dist / 260.0, 0.0, 1.0);
  // worn asphalt: broad lighter and darker patches, fine grit close up, crack lines every 25 m across, rubber in the wheel tracks after each end
  vec3 asphalt = vec3(0.30, 0.30, 0.315) * (0.82 + 0.34 * nb) * (0.92 + 0.16 * n) * (1.0 + (nf - 0.5) * 0.35 * near);
  float joint = (1.0 - smoothstep(0.0, 0.06 + 0.5 * pl, abs(fract(x / 25.0 + 0.5) - 0.5) * 25.0)) * near * 0.5;
  asphalt *= 1.0 - 0.12 * joint;
  float rubber = smoothstep(260.0, 60.0, e) * smoothstep(40.0, 160.0, e) * (1.0 - smoothstep(0.8, 2.6, abs(ay - 4.0)) * 0.8 - 0.1) * (0.4 + 0.6 * nb);
  asphalt *= 1.0 - 0.28 * clamp(rubber, 0.0, 1.0) * paved * clamp(1.4 - 2.0 * pl / 4.0, 0.0, 1.0);
  vec3 base = mix(vec3(0.5, 0.44, 0.33) * (0.85 + 0.3 * n), asphalt, paved);
  float fade = clamp(2.6 - px, 0.0, 1.0), m = 0.0;
  float hl = max(0.55, px * 0.8);
  // centre line: 30 m paint, 20 m gap, from 60 m after the end
  m = max(m, band(y, 0.0, hl, px) * stripes(x + 25.0, 50.0, 0.6) * step(60.0, e));
  // edge lines
  m = max(m, band(ay, W * 0.5 - 1.2, max(0.32, px * 0.7), px) * step(2.0, e));
  // threshold: a line across, then the piano keys (1.8 m paint and 1.8 m gap, a wider gap on the centre line), 30 m long from 6 m
  float u = (ay - 1.8) / 3.6;
  m = max(m, step(6.0, e) * step(e, 36.0) * step(0.0, u) * step(ay, W * 0.5 - 3.0) * stripes(ay - 1.8, 3.6, 0.5));
  m = max(m, band(e, 3.0, 0.7, pl) * step(ay, W * 0.5 - 1.5));
  // touchdown zone bars in sets of three, two and one every 150 m from the end; aiming point blocks 300 m from the end
  float k = floor((e - 150.0) / 150.0 + 0.5), nbar = k < 0.5 ? 3.0 : (k < 3.5 ? 2.0 : 1.0), v2 = (ay - 4.5) / 3.6;
  float inTz = step(0.0, k) * step(k, 4.0) * step(abs(e - 150.0 - 150.0 * k), 11.0) * (1.0 - step(abs(k - 1.0), 0.5)) * step(150.0, L);
  m = max(m, inTz * step(0.0, v2) * step(v2, nbar * 2.0 - 1.0) * stripes(ay - 4.5, 3.6, 0.5));
  m = max(m, step(abs(e - 300.0), 22.0) * band(ay, 9.5, 3.0, px) * step(700.0, L));                    // aiming point blocks
  vec3 c = mix(base, vec3(0.93, 0.93, 0.9) * (0.93 + 0.07 * nb), clamp(m * fade * paved * on, 0.0, 1.0));
  c = mix(c, mix(base, vec3(0.62), 0.25 * paved), (1.0 - fade) * on * 0.5);
  c *= max(uLight, vec3(0.14 * uOpt.y));          // lit runways stay readable at night
  float em = vFlag.y * max(band(ay, W * 0.5, max(1.5, px * 1.6), px), band(ax, L * 0.5, max(1.5, pl * 1.6), pl));
  em = max(em, vFlag.y * (1.0 - on));
  c = mix(c, uEm.rgb, em * uEm.a);
  // edge lights every 60 m and green threshold lights, at night and at dusk; from far away they merge into lines
  float lit = uOpt.x * uOpt.y, spot = clamp(1.5 - 0.25 * pl, 0.0, 1.0);
  float lamps = on * band(ay, W * 0.5 - 1.5, max(0.9, px * 1.3), px) * mix(0.45, band(fract(x / 60.0), 0.5, max(0.02, pl / 50.0), max(pl / 60.0, 1e-3)), spot) * step(ax, L * 0.5);
  float ends = on * band(ax, L * 0.5 - 2.0, max(1.0, pl * 1.3), pl) * step(fract(y / 6.0), 0.5);
  c += (vec3(1.0, 0.94, 0.72) * lamps * 2.2 + vec3(0.2, 1.0, 0.35) * ends * 1.6) * lit;
  float a = max(on, em);
  o = vec4(mix(c, uFogCol, fogAmount(dist, uFog.w) * (1.0 - 0.6 * max(em, (lamps + ends) * lit))), a);
}`;

export const MESH_VS = HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aN; layout(location=2) in vec4 aCol;
uniform mat4 uVP; uniform mat3 uRot; uniform vec3 uOff;
out vec3 vN; out vec4 vCol; out vec3 vRel;
void main() { vRel = uRot * aPos + uOff; vN = uRot * aN.xyz; vCol = aCol; gl_Position = uVP * vec4(vRel, 1.0); }`;

export const MESH_FS = HEAD + `
in vec3 vN; in vec4 vCol; in vec3 vRel;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb;
${FOG}
out vec4 o;
void main() {
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 c = vCol.rgb * (uAmb * 1.1 + uSunCol * (0.25 + 0.75 * max(dot(n, uSun), 0.0)));
  o = vec4(mix(c, uFogCol, fogAmount(length(vRel), uFog.w)), vCol.a);
}`;

export const CLOUD_VS = HEAD + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aTex; layout(location=2) in float aFade;
uniform mat4 uVP;
out vec3 vRel; out vec3 vTex; out float vFade;
void main() { vRel = aPos; vTex = aTex; vFade = aFade; gl_Position = uVP * vec4(aPos, 1.0); }`;

export const CLOUD_FS = HEAD + `
in vec3 vRel; in vec3 vTex; in float vFade;
uniform sampler3D uNoise; uniform vec4 uLayer;   // cover 0..1, seen from below 1 / above 0, octaves, 0
uniform vec3 uTop; uniform vec3 uBottom;
${FOG}
out vec4 o;
void main() {
  float d = length(vRel);
  float n = texture(uNoise, vTex / 16384.0).r * 0.55 + texture(uNoise, vTex.yzx / 4096.0).g * 0.3 + (uLayer.z > 1.5 ? texture(uNoise, vTex.zxy / 1024.0).b * 0.15 : 0.075);
  float cover = uLayer.x, th = 0.5 + (0.5 - cover) * 0.62, soft = 0.07;
  float a = max(smoothstep(th - soft, th + soft, n), smoothstep(0.9, 1.0, cover));
  float thick = smoothstep(th, th + 0.25, n);
  vec3 c = mix(uTop * (0.82 + 0.18 * thick), uBottom * (1.0 - 0.45 * thick * (0.4 + 0.6 * cover)), uLayer.y);
  float f = fogAmount(d, uFog.w);
  o = vec4(mix(c, uFogCol, f), a * vFade * (1.0 - f * f) * 0.96);
}`;

export const OVERLAY_VS = HEAD + `
layout(location=0) in vec2 aPos; layout(location=1) in vec3 aUV; layout(location=2) in vec4 aCol;
uniform vec2 uInv;
out vec3 vUV; out vec4 vCol;
void main() { vUV = aUV; vCol = aCol; gl_Position = vec4(aPos.x * uInv.x - 1.0, 1.0 - aPos.y * uInv.y, 0.0, 1.0); }`;

export const OVERLAY_FS = HEAD + `
in vec3 vUV; in vec4 vCol;
uniform sampler2D uAtlas;
out vec4 o;
void main() {
  float a = vCol.a;
  if (vUV.z > 1.5) a *= clamp(vUV.y + 0.5 - abs(vUV.x), 0.0, 1.0);          // line: distance from the centre line in pixels
  else if (vUV.z > 0.5) { vec4 t = texture(uAtlas, vUV.xy); o = vec4(mix(vec3(0.0), vCol.rgb, t.r), max(t.r, t.g * 0.6) * a); return; }
  o = vec4(vCol.rgb, a);
}`;
