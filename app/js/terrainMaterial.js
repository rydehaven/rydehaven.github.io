// terrainMaterial.js — MeshStandardMaterial patched to blend 3 PBR layers by a splat map.
// Splat weights: vertex colors (r = grass, g = dirt, b = rock) + a `snow` attribute.
// UVs are WORLD METERS, so tiling lines up across chunk seams; each layer divides by its own
// real-world size. Two scales are mixed per layer to hide repetition.
import * as THREE from 'three';

export function makeTerrainMaterial(layers, hq = true) {
  const [g, d, r, w] = layers; // each { diff, nor, arm, meters, flipY }
  const u = {
    tDiff0: { value: g.diff }, tDiff1: { value: d.diff }, tDiff2: { value: r.diff }, tDiff3: { value: w.diff },
    tNor0: { value: g.nor }, tNor1: { value: d.nor }, tNor2: { value: r.nor }, tNor3: { value: w.nor },
    tArm0: { value: g.arm }, tArm1: { value: d.arm }, tArm2: { value: r.arm }, tArm3: { value: w.arm },
    tScale: { value: new THREE.Vector4(1 / g.meters, 1 / d.meters, 1 / r.meters, 1 / w.meters) },
    tFlip: { value: new THREE.Vector4(1, 1, 1, 1) },
    tTint0: { value: new THREE.Color(1, 1, 1) }, tTint1: { value: new THREE.Color(1, 1, 1) },
    tTint2: { value: new THREE.Color(1, 1, 1) }, tTint3: { value: new THREE.Color(1, 1, 1) },
    tDetail: { value: g.diff }, tDetailNor: { value: g.nor }, uDetail: { value: new THREE.Vector2(1, 0) }, // (1/meters, strength)
  };
  // Assigning map/normalMap/roughnessMap only turns on the shader paths + UV varyings;
  // the actual sampling below uses the layer uniforms.
  const mat = new THREE.MeshStandardMaterial({
    map: g.diff, normalMap: g.nor, roughnessMap: g.arm, vertexColors: true, roughness: 1, metalness: 0,
  });

  const decl = /* glsl */`
uniform sampler2D tDiff0, tDiff1, tDiff2, tDiff3, tNor0, tNor1, tNor2, tNor3, tArm0, tArm1, tArm2, tArm3;
uniform vec4 tScale, tFlip;
uniform vec3 tTint0, tTint1, tTint2, tTint3;   // per-layer color grade (map.tints)
uniform sampler2D tDetail, tDetailNor; uniform vec2 uDetail;   // detail texture on the grass layer
varying float vSnow;
varying vec3 vTriP, vTriN;
vec4 twoScale(sampler2D t, vec2 uv) {          // anti-tiling: blend a rotated, larger copy (High quality only)
#ifdef TERRAIN_HQ
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.31 + 0.17;
  return mix(texture2D(t, uv), texture2D(t, uv2), 0.33);
#else
  return texture2D(t, uv);
#endif
}
// ---- breaking up the repeat (after Inigo Quilez, "texture repetition"):
// a smooth noise picks, per area, a different random offset into the texture; neighbouring picks blend softly,
// so the same rock never lines up twice. Mip levels come from the real uv so it stays sharp and doesn't shimmer.
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y);
}
vec4 noTile(sampler2D t, vec2 uv) {
  float l = tNoise(uv * 1.3) * 8.0, ia = floor(l), f = fract(l);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 a = textureGrad(t, uv + sin(vec2(3.0, 7.0) * ia), dx, dy);
  vec4 b = textureGrad(t, uv + sin(vec2(3.0, 7.0) * (ia + 1.0)), dx, dy);
  vec3 d = a.rgb - b.rgb;
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * (d.x + d.y + d.z)));
}
// rock on steep faces: project the texture from the side too (tri-planar), so cliffs don't show stretched streaks
vec3 triplanar(sampler2D t, float s, vec2 topUv) {
  vec3 b = pow(abs(normalize(vTriN)), vec3(4.0)); b /= (b.x + b.y + b.z);
  if (b.y > 0.96) return noTile(t, topUv).rgb;
  return noTile(t, vTriP.zy * s + 0.31).rgb * b.x + noTile(t, topUv).rgb * b.y + noTile(t, vTriP.xy * s + 0.67).rgb * b.z;
}`;
  const mapFrag = /* glsl */`
vec4 sw = max(vec4(vColor, vSnow), vec4(0.0)); sw /= max(sw.x + sw.y + sw.z + sw.w, 1e-4);
vec2 wuv = vMapUv;                                   // world meters
vec3 tDet = vec3(1.0);
if (uDetail.y > 0.0) {
  vec3 dc = texture2D(tDetail, wuv * uDetail.x).rgb, da = textureLod(tDetail, vec2(0.5), 12.0).rgb;
  float lumC = dot(dc, vec3(0.299, 0.587, 0.114)), lumA = max(dot(da, vec3(0.299, 0.587, 0.114)), 0.02);
  tDet = mix(vec3(1.0), vec3(clamp(lumC / lumA, 0.4, 1.8)), uDetail.y);
}
float rFar = smoothstep(25.0, 140.0, length(vViewPosition));   // small-tile layers (dirt, snow detail) fade to smooth colour past ~25 m so repeats never form a grid
float rockFar = smoothstep(800.0, 2200.0, length(vViewPosition));   // rock is tiled large, so it keeps its texture almost to the horizon
// layers that aren't present here are skipped entirely (most of a map is one or two layers)
vec3 tcol = vec3(0.0);
if (sw.x > 0.003) tcol += twoScale(tDiff0, wuv * tScale.x).rgb * tTint0 * tDet * sw.x;
if (sw.y > 0.003) tcol += mix(twoScale(tDiff1, wuv * tScale.y).rgb, textureLod(tDiff1, vec2(0.5), 12.0).rgb, rFar) * tTint1 * sw.y;
// far away the small rock pattern turns into shimmering moire: fade it to the rock's average colour with broad, soft patches
if (sw.z > 0.003) {
  vec3 rc = rockFar < 0.999 ? triplanar(tDiff2, tScale.z, wuv * tScale.z) : vec3(0.0);
  if (rockFar > 0.001) {
    vec3 avg = textureLod(tDiff2, vec2(0.5), 12.0).rgb;
    float patchy = texture2D(tDiff2, vTriP.xz / 600.0 + 0.37).g / max(avg.g, 0.05);
    rc = mix(rc, avg * mix(1.0, clamp(patchy, 0.6, 1.4), 0.7), rockFar);
  }
  float m1 = tNoise(vTriP.xz / 260.0), m2 = tNoise(vTriP.xz / 90.0 + 17.3);
  rc *= mix(0.8, 1.15, m1 * 0.65 + m2 * 0.35);                         // big light and dark areas
  rc *= mix(vec3(1.05, 1.0, 0.93), vec3(0.94, 0.98, 1.05), tNoise(vTriP.xz / 420.0 + 5.1));   // warmer / cooler stone
  tcol += rc * tTint2 * sw.z;
}
if (sw.w > 0.003) {   // snow: smooth, with only broad soft drifts (fine speckle read as a dotted grid on the slopes)
  vec3 savg = textureLod(tDiff3, vec2(0.5), 12.0).rgb;
  float sp = texture2D(tDiff2, vTriP.xz / 160.0 + 0.61).g / max(textureLod(tDiff2, vec2(0.5), 12.0).g, 0.05);
  tcol += savg * mix(1.0, clamp(sp, 0.88, 1.08), 0.6) * tTint3 * sw.w;
}
diffuseColor.rgb *= tcol;`;
  const roughFrag = /* glsl */`
vec3 tarm = vec3(0.0);
if (sw.x > 0.003) tarm += texture2D(tArm0, wuv * tScale.x).rgb * sw.x;
if (sw.y > 0.003) tarm += texture2D(tArm1, wuv * tScale.y).rgb * sw.y;
if (sw.z > 0.003) tarm += texture2D(tArm2, wuv * tScale.z).rgb * sw.z;
if (sw.w > 0.003) tarm += texture2D(tArm3, wuv * tScale.w).rgb * sw.w;
float roughnessFactor = roughness * tarm.g;
diffuseColor.rgb *= mix(1.0, tarm.r, 0.6);           // ambient occlusion detail`;
  const normFrag = /* glsl */`
vec3 mapN = vec3(0.0);
if (sw.x > 0.003) { vec3 n0 = texture2D(tNor0, wuv * tScale.x).xyz * 2.0 - 1.0; n0.y *= tFlip.x;
#ifdef TERRAIN_HQ
  if (uDetail.y > 0.0) { vec3 nd = texture2D(tDetailNor, wuv * uDetail.x).xyz * 2.0 - 1.0; n0 = normalize(vec3(n0.xy + nd.xy * uDetail.y, n0.z)); }
#endif
  mapN += n0 * sw.x; }
if (sw.y > 0.003) { vec3 n1 = texture2D(tNor1, wuv * tScale.y).xyz * 2.0 - 1.0; n1.y *= tFlip.y; n1 = mix(n1, vec3(0.0, 0.0, 1.0), rFar); mapN += n1 * sw.y; }
if (sw.z > 0.003) { vec3 n2 = noTile(tNor2, wuv * tScale.z).xyz * 2.0 - 1.0; n2.y *= tFlip.z; n2 = mix(n2, vec3(0.0, 0.0, 1.0), rockFar); mapN += n2 * sw.z; }
if (sw.w > 0.003) { vec3 n3 = texture2D(tNor3, wuv * tScale.w).xyz * 2.0 - 1.0; n3.y *= tFlip.w; n3 = mix(n3, vec3(0.0, 0.0, 1.0), 0.85); mapN += n3 * sw.w; }
mapN = normalize(mapN + vec3(0.0, 0.0, 1e-4));
mapN.xy *= normalScale;
normal = normalize(tbn * mapN);`;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float snow;\nvarying float vSnow;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvSnow = snow;')
      .replace('varying float vSnow;', 'varying float vSnow;\nvarying vec3 vTriP, vTriN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriP = (modelMatrix * vec4(transformed, 1.0)).xyz; vTriN = mat3(modelMatrix) * objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\n' + decl)
      .replace('#include <map_fragment>', mapFrag)
      .replace('#include <color_fragment>', '')       // vertex colors are weights, not tint
      .replace('#include <roughnessmap_fragment>', roughFrag)
      .replace('#include <normal_fragment_maps>', normFrag);
  };
  if (hq) mat.defines = { TERRAIN_HQ: 1 };
  mat.customProgramCacheKey = () => 'terrain-splat-v13' + (hq ? '-hq' : '');
  return { material: mat, uniforms: u };
}
