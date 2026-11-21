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
vec4 twoScale(sampler2D t, vec2 uv) {          // anti-tiling: blend a rotated, larger copy (High quality only)
#ifdef TERRAIN_HQ
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.31 + 0.17;
  return mix(texture2D(t, uv), texture2D(t, uv2), 0.33);
#else
  return texture2D(t, uv);
#endif
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
// layers that aren't present here are skipped entirely (most of a map is one or two layers)
vec3 tcol = vec3(0.0);
if (sw.x > 0.003) tcol += twoScale(tDiff0, wuv * tScale.x).rgb * tTint0 * tDet * sw.x;
if (sw.y > 0.003) tcol += twoScale(tDiff1, wuv * tScale.y).rgb * tTint1 * sw.y;
if (sw.z > 0.003) tcol += twoScale(tDiff2, wuv * tScale.z).rgb * tTint2 * sw.z;
if (sw.w > 0.003) tcol += twoScale(tDiff3, wuv * tScale.w).rgb * tTint3 * sw.w;
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
if (sw.y > 0.003) { vec3 n1 = texture2D(tNor1, wuv * tScale.y).xyz * 2.0 - 1.0; n1.y *= tFlip.y; mapN += n1 * sw.y; }
if (sw.z > 0.003) { vec3 n2 = texture2D(tNor2, wuv * tScale.z).xyz * 2.0 - 1.0; n2.y *= tFlip.z; mapN += n2 * sw.z; }
if (sw.w > 0.003) { vec3 n3 = texture2D(tNor3, wuv * tScale.w).xyz * 2.0 - 1.0; n3.y *= tFlip.w; mapN += n3 * sw.w; }
mapN = normalize(mapN + vec3(0.0, 0.0, 1e-4));
mapN.xy *= normalScale;
normal = normalize(tbn * mapN);`;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float snow;\nvarying float vSnow;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvSnow = snow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\n' + decl)
      .replace('#include <map_fragment>', mapFrag)
      .replace('#include <color_fragment>', '')       // vertex colors are weights, not tint
      .replace('#include <roughnessmap_fragment>', roughFrag)
      .replace('#include <normal_fragment_maps>', normFrag);
  };
  if (hq) mat.defines = { TERRAIN_HQ: 1 };
  mat.customProgramCacheKey = () => 'terrain-splat-v5' + (hq ? '-hq' : '');
  return { material: mat, uniforms: u };
}
