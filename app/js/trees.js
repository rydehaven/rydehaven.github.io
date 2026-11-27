// trees.js — pine and fir forest from IMPOSTORS of Poly Haven's pine_sapling_small and fir_sapling (both CC0).
// The real model (~400k triangles each) was photographed offline from 12 angles (3 variants),
// with color+coverage and normals. Pines and firs share one atlas, so mixing them costs nothing extra per frame. Each tree in the game is ONE camera-facing card (2 triangles):
//  - it shows the photo for the angle you're viewing from, cross-fading between angles (no popping)
//  - normals are baked, so the game's sun still lights the needles correctly
//  - alpha-to-coverage + mip-aware alpha keeps thin needles from shimmering or thinning out far away
//  - cards cast shadows (they turn to face the sun in the shadow pass)
import * as THREE from 'three';

export const IMPOSTOR = {
  color: 'textures/trees/trees_color.png',  // RGBA atlas: 12 angles (columns) x 6 variants (rows: 3 firs on top, 3 pines below)
  normal: 'textures/trees/trees_normal.jpg',
  views: 12, variants: 6,
  cellW: 1.15, cellH: 1.4375,                // model meters covered by one cell (with margins)
  baseOffset: 0.04,                         // trunk base sits this fraction above the cell bottom
  modelH: 1.2835,                           // tallest sapling in the model (m)
};

const VERT_PARS = /* glsl */`
attribute vec2 treeData;          // x = variant row, y = yaw (radians)
uniform float uViews, uVariants;
varying vec2 vUv0, vUv1;
varying float vBlend;
`;
// toward-camera direction on the ground plane, per instance
const VERT_DIR = /* glsl */`
vec3 tCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec2 toCam = cameraPosition.xz - tCenter.xz;
float tLen = length(toCam);
toCam = tLen > 1e-4 ? toCam / tLen : vec2(0.0, 1.0);
`;
const VERT_POS = /* glsl */`
vec3 transformed = vec3(toCam.y, 0.0, -toCam.x) * position.x + vec3(0.0, position.y, 0.0);
float tAng = atan(toCam.x, toCam.y) - treeData.y;
float tF = mod(tAng / 6.28318530718 * uViews, uViews);
float tI0 = floor(tF), tI1 = mod(tI0 + 1.0, uViews);
vBlend = tF - tI0;
vUv0 = vec2((tI0 + uv.x) / uViews, (treeData.x + uv.y) / uVariants);
vUv1 = vec2((tI1 + uv.x) / uViews, (treeData.x + uv.y) / uVariants);
`;

function coverageAlpha() {
  // keeps needle density stable as the texture shrinks (mip-aware); soft edges go to alpha-to-coverage
  return /* glsl */`
  vec2 tSz = vec2(textureSize(tColor, 0));
  vec2 tDx = dFdx(vUv0 * tSz), tDy = dFdy(vUv0 * tSz);
  float tLod = max(0.0, 0.5 * log2(max(dot(tDx, tDx), dot(tDy, tDy))));
  float tA = clamp(tc.a * (1.0 + tLod * 0.3) * 1.35, 0.0, 1.0);`;
}

export function buildForest({ scene, placements, aniso, files = IMPOSTOR, msaa = true, cell = 350 }) {
  const L = new THREE.TextureLoader();
  const tColor = L.load(files.color), tNormal = L.load(files.normal);
  tColor.colorSpace = THREE.SRGBColorSpace; tNormal.colorSpace = THREE.NoColorSpace;
  for (const t of [tColor, tNormal]) { t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }

  // card: width/height in model units, base at y = 0; scaled per tree by the instance matrix
  const aspect = files.cellW / files.cellH;
  const geo = new THREE.PlaneGeometry(aspect, 1).translate(0, 0.5 - files.baseOffset, 0);
  const common = { uViews: { value: files.views }, uVariants: { value: files.variants }, tColor: { value: tColor }, tNormal: { value: tNormal } };

  const mat = new THREE.MeshStandardMaterial({ map: tColor, normalMap: tNormal, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.alphaToCoverage = msaa; // smooth needle edges with MSAA; without MSAA use a hard cut-out
  if (!msaa) mat.defines = { NO_A2C: 1 };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, common);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', VERT_DIR + 'vec3 objectNormal = vec3(toCam.x, 0.0, toCam.y);')
      .replace('#include <begin_vertex>', VERT_POS);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tColor, tNormal;\nvarying vec2 vUv0, vUv1;\nvarying float vBlend;')
      .replace('#include <map_fragment>', `
        vec4 tc = mix(texture2D(tColor, vUv0), texture2D(tColor, vUv1), vBlend);
        ${coverageAlpha()}
        if (tA < 0.08) discard;
        #ifdef NO_A2C
        if (tA < 0.45) discard; tA = 1.0;
        #endif
        diffuseColor.rgb *= tc.rgb;
        diffuseColor.a = tA;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = normalize(mix(texture2D(tNormal, vUv0).xyz, texture2D(tNormal, vUv1).xyz, vBlend) * 2.0 - 1.0);
        normal = normalize(tbn * mapN);`)
      // keep the coverage alpha for alpha-to-coverage (opaque materials would force alpha = 1)
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(outgoingLight, diffuseColor.a);');
  };
  mat.customProgramCacheKey = () => 'pine-impostor-v2' + (msaa ? '' : '-noa2c');

  // shadow caster: same card, facing the sun (the shadow camera), hard alpha test
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tColor, alphaTest: 0.35, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, common);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', VERT_DIR + VERT_POS);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tColor;\nvarying vec2 vUv0, vUv1;\nvarying float vBlend;')
      .replace('#include <map_fragment>', 'vec4 tc = texture2D(tColor, vUv0); diffuseColor.a = tc.a;');
  };
  depth.customProgramCacheKey = () => 'pine-impostor-depth-v1';

  // group trees by area: each group is frustum-culled (cards only turn around their own axis, so the
  // bounding sphere stays valid), hidden past the view distance, and casts shadows only near the rider
  const buckets = new Map();
  for (const p of placements) { const k = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(p); }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  const groups = [];
  for (const list of buckets.values()) {
    const g2 = geo.clone(), data = new Float32Array(list.length * 2);
    const mesh = new THREE.InstancedMesh(g2, mat, list.length);
    mesh.customDepthMaterial = depth;
    let cx = 0, cz = 0;
    list.forEach((p, i) => {
      const k = files.cellH * p.h / files.modelH;           // card height so the sapling itself is p.h meters tall
      m.compose(v.set(p.x, p.y, p.z), q, s.set(k * p.w, k, k * p.w));
      mesh.setMatrixAt(i, m);
      data[i * 2] = p.variant; data[i * 2 + 1] = p.rot;
      c.setHSL(0.22 + 0.05 * p.tint, 0.25 + 0.2 * p.tint, 0.85 + 0.15 * p.tint);
      mesh.setColorAt(i, c); cx += p.x; cz += p.z;
    });
    g2.setAttribute('treeData', new THREE.InstancedBufferAttribute(data, 2));
    mesh.computeBoundingSphere();
    mesh.castShadow = false; mesh.receiveShadow = false;
    scene.add(mesh);
    groups.push({ mesh, x: cx / list.length, z: cz / list.length });
  }
  return {
    count: placements.length, groups: groups.length,
    update(cam, rider, viewDist, shadowR) {           // call a few times a second
      for (const g of groups) {
        const dc = Math.hypot(g.x - cam.x, g.z - cam.z), dr = Math.hypot(g.x - rider.x, g.z - rider.z);
        g.mesh.visible = dc < viewDist + cell;
        g.mesh.castShadow = shadowR > 0 && dr < shadowR + cell * 0.75;
      }
    },
  };
}
