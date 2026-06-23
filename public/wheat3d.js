import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const STAGES = [
  { id:0, name:'Germinación y Emergencia', icon:'🌱', desc:'La semilla absorbe agua, la radícula emerge y el coleóptilo asciende', days:{primavera:'15–20 días',invierno:'10–15 días'}, cumDays:{primavera:17,invierno:12} },
  { id:1, name:'Brotación',               icon:'🌿', desc:'Las primeras hojas verdaderas se despliegan; fotosíntesis activa',    days:{primavera:'10–20 días',invierno:'15–25 días'}, cumDays:{primavera:32,invierno:32} },
  { id:2, name:'Crecimiento del Tallo',   icon:'🌾', desc:'El tallo se elonga con macollos secundarios',                        days:{primavera:'20–30 días',invierno:'40–50 días'}, cumDays:{primavera:57,invierno:77} },
  { id:3, name:'Espigamiento',            icon:'🌾', desc:'La espiga emerge desde la vaina de la hoja bandera',                 days:{primavera:'20–30 días',invierno:'40–50 días'}, cumDays:{primavera:82,invierno:122} },
  { id:4, name:'Floración',               icon:'🌼', desc:'Las anteras liberan el polen; polinización y fertilización',         days:{primavera:'15–20 días',invierno:'15–20 días'}, cumDays:{primavera:99,invierno:139} },
  { id:5, name:'Llenado del Grano',       icon:'🌻', desc:'Los granos acumulan almidón y proteínas',                           days:{primavera:'30–35 días',invierno:'30–35 días'}, cumDays:{primavera:131,invierno:171} },
  { id:6, name:'Maduración',              icon:'🌾', desc:'El grano alcanza peso seco máximo; listo para cosecha',             days:{primavera:'10–15 días',invierno:'10–15 días'}, cumDays:{primavera:143,invierno:183} },
];

let currentStage = 0;
let wheatType = 'primavera';
let autoPlay = false;
let autoTimer = null;
let scene, camera, renderer, controls;
let plantGroup = null;
let clock;
let fadeList = [];
const FADE_DURATION = 0.6;

// Smooth camera-target transition between growth stages, instead of a hard cut
let camTargetAnim = null;
const CAM_TARGET_DURATION = 1.1;

// Location-driven colour tint
let locationTint = new THREE.Color(1, 1, 1);

function init() {
  const container = document.getElementById('canvas-container');

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4e6e1);
  scene.fog = new THREE.FogExp2(0xe4e6e1, 0.035);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 200);
  camera.position.set(0, 3, 12);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.80;
  controls.target.set(0, 2, 0);
  controls.update();

  clock = new THREE.Clock();

  buildLights();
  buildEnvironment();
  buildTimeline();
  goToStage(0);
  prewarmStages([1, 2, 3, 4, 5, 6]);

  window.addEventListener('resize', onResize);

  // Public API for right panel
  window.__wheatStartAuto = () => { autoPlay = true; scheduleAuto(); updateNavBtn(); };
  window.__wheatSetLocation = (loc) => applyLocationTint(loc);
  window.toggleAuto = toggleAuto;
  window.nextStage  = () => { stopAuto(); goToStage((currentStage + 1) % STAGES.length); };
  window.prevStage  = () => { stopAuto(); goToStage((currentStage - 1 + STAGES.length) % STAGES.length); };
  window.setStageFromSlider = (v) => { stopAuto(); goToStage(parseInt(v, 10)); };
  window.__wheatResize = onResize;

  animate();
}

// ── Lights ──────────────────────────────────────────────────────────────────
function buildLights() {
  const sun = new THREE.DirectionalLight(0xbfe8e0, 2.4);
  sun.position.set(6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { near:0.5, far:50, left:-10, right:10, top:10, bottom:-10 });
  scene.add(sun);

  scene.add(new THREE.AmbientLight(0xe4e6e1, 1.2));

  const fill = new THREE.DirectionalLight(0x2ed8c0, 0.9);
  fill.position.set(-4, 5, -6);
  scene.add(fill);

  const rim = new THREE.PointLight(0x4af0d8, 6, 18, 2);
  rim.position.set(0, 5, -8);
  scene.add(rim);

  scene.add(new THREE.HemisphereLight(0x3ad8c0, 0x3a1a05, 0.6));
}

// ── Environment ──────────────────────────────────────────────────────────────
function buildEnvironment() {
  // Soil top — rich brown
  const soilGeo = new THREE.CylinderGeometry(9, 9, 0.5, 48);
  const soilMat = new THREE.MeshLambertMaterial({ color: 0x7a3e10 });
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.y = -0.25;
  soil.receiveShadow = true;
  scene.add(soil);

  // Soil surface highlight
  const surfGeo = new THREE.CylinderGeometry(9, 9, 0.04, 48);
  const surfMat = new THREE.MeshLambertMaterial({ color: 0x8a4e18 });
  const surf = new THREE.Mesh(surfGeo, surfMat);
  surf.position.y = 0.02;
  scene.add(surf);

  // Subsoil
  const subGeo = new THREE.CylinderGeometry(9, 8.5, 2, 48);
  const subMat = new THREE.MeshLambertMaterial({ color: 0x4a2208 });
  const sub = new THREE.Mesh(subGeo, subMat);
  sub.position.y = -1.25;
  scene.add(sub);

  buildGrass();
}

// ── Realistic grass ground cover ───────────────────────────────────────────
// Each blade is built from two crossed tapered strips (a cheap "billboard cross"),
// so it always reads as a leaf with real width no matter which way it's rotated —
// a single flat blade goes near-invisible edge-on, which is what made the first
// attempt at this look like a forest of thin black spikes.
function makeBladeGeometry() {
  const colorBase = new THREE.Color(0x2c5a12);
  const colorMid = new THREE.Color(0x4f8a22);
  const colorTip = new THREE.Color(0x9bcf4a);

  const spine = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.45, 0.04),
    new THREE.Vector3(0, 1, 0.14),
  ];
  const widths = [0.052, 0.03, 0];
  const cols = [colorBase, colorMid, colorTip];

  const positions = [];
  const colors = [];
  const push = (p, c) => { positions.push(p.x, p.y, p.z); colors.push(c.r, c.g, c.b); };

  for (let i = 0; i < spine.length - 1; i++) {
    const p0 = spine[i], p1 = spine[i + 1];
    const w0 = widths[i], w1 = widths[i + 1];
    const c0 = cols[i], c1 = cols[i + 1];
    const l0 = new THREE.Vector3(p0.x - w0 / 2, p0.y, p0.z);
    const r0 = new THREE.Vector3(p0.x + w0 / 2, p0.y, p0.z);
    if (w1 > 0.001) {
      const l1 = new THREE.Vector3(p1.x - w1 / 2, p1.y, p1.z);
      const r1 = new THREE.Vector3(p1.x + w1 / 2, p1.y, p1.z);
      push(l0, c0); push(r0, c0); push(r1, c1);
      push(l0, c0); push(r1, c1); push(l1, c1);
    } else {
      push(l0, c0); push(r0, c0); push(p1, c1);
    }
  }

  const single = new THREE.BufferGeometry();
  single.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  single.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const crossed = single.clone();
  crossed.rotateY(Math.PI / 2);

  const merged = mergeGeometries([single, crossed]);
  merged.computeVertexNormals();
  return merged;
}

function buildGrass() {
  const bladeGeo = makeBladeGeometry();
  const bladeMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const COUNT = 5500;
  const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, COUNT);
  grass.castShadow = false;
  grass.receiveShadow = false;

  const dummy = new THREE.Object3D();
  let idx = 0;
  while (idx < COUNT) {
    const ang = Math.random() * Math.PI * 2;
    const r = 0.55 + Math.random() * 8.2;
    const h = 0.1 + Math.random() * 0.3 + Math.max(0, (8.2 - r)) * 0.01;
    const w = 0.8 + Math.random() * 0.7;
    const lean = (Math.random() - 0.5) * 0.4;

    dummy.position.set(
      Math.cos(ang) * r + (Math.random() - 0.5) * 0.12,
      0,
      Math.sin(ang) * r + (Math.random() - 0.5) * 0.12
    );
    dummy.rotation.set(lean * 0.5, Math.random() * Math.PI * 2, lean * 0.5);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    grass.setMatrixAt(idx, dummy.matrix);
    idx++;
  }
  grass.instanceMatrix.needsUpdate = true;
  scene.add(grass);
}

// ── Plant builder ────────────────────────────────────────────────────────────
// Each growth stage gets its own deliberate, hand-tuned silhouette instead of a
// single continuous lerp — wheat actually looks structurally different stage to
// stage (radicle → seedling → tillered clump → jointed stem → spike → ripe ear),
// so we branch per-stage and only interpolate within a stage's own sub-features.
function buildPlant(stage) {
  const g = new THREE.Group();
  const t = stage / 6;

  const stemH = lerp(0.05, 4.5, smoothstep(0, 0.7, t));
  const stemR = lerp(0.045, 0.07, t);

  const baseGreen = new THREE.Color(0x2a5a10).lerp(new THREE.Color(0xc8a020), Math.max(0,(t-0.7)/0.3));
  const green = baseGreen.clone().multiply(locationTint);

  addRoots(g, stage, t);

  if (stage <= 1) addSeed(g, stage, t);

  // Main culm (curved, jointed stem built from several short segments)
  if (stemH > 0.05) addCulm(g, stemH, stemR, stage, t, green);

  // Leaves on the main culm — count and length grow with stage
  const leafCount = Math.min(Math.max(stage, 1), 6);
  for (let i = 0; i < leafCount; i++) addLeaf(g, i, leafCount, stemH, t, green, stage);

  // Tillers (secondary shoots) — wheat bushes out from stage 2 onward
  if (stage >= 2) {
    const tillerCount = Math.min(stage - 1, 4);
    for (let i = 0; i < tillerCount; i++) {
      const ang = (i / tillerCount) * Math.PI * 2 + 0.6;
      const spread = 0.16 + i * 0.05;
      const tH = stemH * (0.55 - i * 0.06);
      const tR = stemR * 0.6;
      const offset = new THREE.Vector3(Math.cos(ang) * spread, 0, Math.sin(ang) * spread);
      addCulm(g, tH, tR, Math.max(stage - 1, 1), t, green, offset, ang);
      const tLeaves = Math.min(stage, 3);
      for (let j = 0; j < tLeaves; j++) addLeaf(g, j, tLeaves, tH * 0.92, t, green, stage, offset, ang);
      if (stage >= 4) addSpike(g, tH + 0.03, Math.min((stage-3)/3, 1) * 0.7, stage, t, green, offset);
    }
  }

  // Main spike
  if (stage >= 3) {
    addSpike(g, stemH + 0.04, Math.min((stage-3)/3, 1), stage, t, green);
  }

  // Awns (bristles) on the main spike
  if (stage >= 4) addAwns(g, stemH, t);

  return g;
}

function addRoots(g, stage, t) {
  if (stage === 0) {
    // Germination: one dominant radicle plus fine root hairs
    const rL = lerp(0.05, 0.55, Math.min(t * 4, 1));
    const rg = new THREE.CylinderGeometry(0.009, 0.002, rL, 5);
    const radicle = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: 0x9a6428 }));
    radicle.position.y = -rL / 2 - 0.05;
    g.add(radicle);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const hL = rL * 0.4;
      const hg = new THREE.CylinderGeometry(0.0015, 0.0008, hL, 3);
      const hair = new THREE.Mesh(hg, new THREE.MeshLambertMaterial({ color: 0xb88040 }));
      hair.position.set(Math.cos(ang) * 0.015, -rL - 0.05 + Math.random()*0.1, Math.sin(ang) * 0.015);
      hair.rotation.z = Math.cos(ang) * 0.7;
      hair.rotation.x = Math.sin(ang) * 0.7;
      g.add(hair);
    }
    return;
  }

  // Branching fibrous root system: primary roots + finer secondary branches
  const rootCount = Math.min(stage + 3, 9);
  for (let i = 0; i < rootCount; i++) {
    const ang = (i / rootCount) * Math.PI * 2 + (i % 2) * 0.25;
    const rL = lerp(0.18, 1.05, Math.min(t * 1.8, 1)) * (0.8 + Math.random() * 0.4);
    const bendZ = Math.cos(ang) * (0.45 + Math.random() * 0.25);
    const bendX = Math.sin(ang) * (0.45 + Math.random() * 0.25);

    const segA = new THREE.CylinderGeometry(0.005, 0.0035, rL * 0.55, 4);
    const rootA = new THREE.Mesh(segA, new THREE.MeshLambertMaterial({ color: 0x7a4018 }));
    rootA.position.set(Math.cos(ang) * 0.09, -rL * 0.275 - 0.04, Math.sin(ang) * 0.09);
    rootA.rotation.z = bendZ;
    rootA.rotation.x = bendX;
    g.add(rootA);

    const segB = new THREE.CylinderGeometry(0.0035, 0.0012, rL * 0.5, 4);
    const rootB = new THREE.Mesh(segB, new THREE.MeshLambertMaterial({ color: 0x6a3812 }));
    rootB.position.set(Math.cos(ang) * 0.16, -rL * 0.55 - rL*0.25 - 0.04, Math.sin(ang) * 0.16);
    rootB.rotation.z = bendZ * 1.6;
    rootB.rotation.x = bendX * 1.6;
    g.add(rootB);
  }
}

function addSeed(group, stage, t) {
  const sg = new THREE.SphereGeometry(0.11, 8, 6);
  sg.scale(1, 0.68, 0.78);
  const sm = new THREE.MeshLambertMaterial({ color: 0xd4a030 });
  const seed = new THREE.Mesh(sg, sm);
  seed.position.y = -0.08;
  group.add(seed);

  // Coleoptile sheath sleeving the emerging shoot at germination
  if (stage === 0) {
    const cH = lerp(0.02, 0.18, Math.min(t * 4, 1));
    const cg = new THREE.CylinderGeometry(0.018, 0.022, cH, 5);
    const cm = new THREE.MeshLambertMaterial({ color: 0xd8e0a0 });
    const cole = new THREE.Mesh(cg, cm);
    cole.position.y = cH / 2;
    group.add(cole);
  }
}

// Builds a culm (wheat stem) as a short chain of slightly-angled segments with
// node knuckles, instead of one perfectly straight cylinder — real wheat stems
// kink gently at each node, which reads as far more organic at this poly budget.
function addCulm(g, stemH, stemR, stage, t, green, offset = new THREE.Vector3(), tilt = 0) {
  const segCount = Math.max(2, Math.min(stage, 5));
  const segH = stemH / segCount;
  const stemMat = new THREE.MeshLambertMaterial({ color: green });
  const nodeMat = new THREE.MeshLambertMaterial({ color: 0x304810 });

  const culm = new THREE.Group();
  let y = 0;
  for (let i = 0; i < segCount; i++) {
    const rTop = lerp(stemR * 0.6, stemR, 1 - i / segCount);
    const rBot = lerp(stemR * 0.65, stemR * 1.05, 1 - (i - 1) / segCount);
    const sg = new THREE.CylinderGeometry(rTop, rBot, segH, 6);
    const seg = new THREE.Mesh(sg, stemMat);
    const sway = Math.sin(i * 1.7 + tilt) * 0.05 * (i / segCount);
    seg.position.set(sway, y + segH / 2, 0);
    seg.rotation.z = sway * 0.6;
    seg.castShadow = true;
    culm.add(seg);

    if (i > 0 && stage >= 2) {
      const ng = new THREE.SphereGeometry(stemR * 1.3, 6, 4);
      const node = new THREE.Mesh(ng, nodeMat);
      node.position.set(sway, y, 0);
      culm.add(node);
    }
    y += segH;
  }
  culm.position.copy(offset);
  g.add(culm);
}

// Curved, tapered leaf blade with a gentle midrib bend and a 3-stop colour
// gradient — built as a strip BufferGeometry (same technique as the grass
// blades) rather than a flat ShapeGeometry, so it catches light like a real
// leaf instead of looking like a flat paper cutout.
function makeLeafGeometry(length, width, droop, colorBase, colorTip) {
  const SEGS = 6;
  const positions = [];
  const colors = [];
  const push = (x, y, z, c) => { positions.push(x, y, z); colors.push(c.r, c.g, c.b); };

  const mid = colorBase.clone().lerp(colorTip, 0.5);
  for (let i = 0; i < SEGS; i++) {
    const a0 = i / SEGS, a1 = (i + 1) / SEGS;
    const bend0 = Math.sin(a0 * Math.PI * 0.5) * droop;
    const bend1 = Math.sin(a1 * Math.PI * 0.5) * droop;
    const y0 = a0 * length, y1 = a1 * length;
    const z0 = bend0 * length, z1 = bend1 * length;
    const w0 = width * (1 - a0) * (1 - a0 * 0.2);
    const w1 = width * (1 - a1) * (1 - a1 * 0.2);
    const c0 = colorBase.clone().lerp(colorTip, a0);
    const c1 = colorBase.clone().lerp(colorTip, a1);

    if (w1 > 0.001) {
      push(-w0/2, y0, z0, c0); push(w0/2, y0, z0, c0); push(w1/2, y1, z1, c1);
      push(-w0/2, y0, z0, c0); push(w1/2, y1, z1, c1); push(-w1/2, y1, z1, c1);
    } else {
      push(-w0/2, y0, z0, c0); push(w0/2, y0, z0, c0); push(0, y1, z1, c1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function addLeaf(group, idx, total, stemH, t, green, stage, offset = new THREE.Vector3(), tilt = 0) {
  const angle = (idx/total)*Math.PI*2 + idx*0.75 + tilt;
  const leafY = Math.min((0.12 + (idx/total)*0.6)*stemH, stemH-0.1);
  const leafL = lerp(0.28, 1.5, Math.min(t+0.22, 1)) * (0.68 + idx*0.08);
  const leafW = leafL * 0.16;
  // Older / lower leaves droop more; the flag leaf (last one, late stage) stays stiffer
  const isFlag = stage >= 3 && idx === total - 1;
  const droop = isFlag ? 0.18 : 0.32 + idx * 0.05;

  const colorBase = new THREE.Color(0x234d0c).multiply(locationTint);
  const colorTip = new THREE.Color(0x2a6010)
    .lerp(new THREE.Color(0xb09020), Math.max(0,(t-0.58)/0.42))
    .multiply(locationTint);

  const geo = makeLeafGeometry(leafL, leafW, droop, colorBase, colorTip);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  const leaf = new THREE.Mesh(geo, mat);
  leaf.position.set(offset.x+Math.cos(angle)*0.07, leafY+offset.y, offset.z+Math.sin(angle)*0.07);
  leaf.rotation.y = angle;
  leaf.rotation.x = -0.1;
  leaf.castShadow = true;
  group.add(leaf);
}

function addSpike(group, y, spikeT, stage, t, green, offset = new THREE.Vector3()) {
  const spikeH = lerp(0.08, 0.95, spikeT);
  const spikeColor = new THREE.Color(0x4a7818)
    .lerp(new THREE.Color(0xd4a820), Math.max(0,(t-0.48)/0.52))
    .multiply(locationTint);
  // At full ripeness the heavy ear droops under its own weight
  const droopAngle = stage >= 6 ? 0.45 : stage >= 5 ? 0.18 : 0;

  const spikeGroup = new THREE.Group();

  const rachisGeo = new THREE.CylinderGeometry(0.018, 0.026, spikeH, 6);
  const rachis = new THREE.Mesh(rachisGeo, new THREE.MeshLambertMaterial({ color: spikeColor }));
  rachis.position.y = spikeH/2;
  spikeGroup.add(rachis);

  const spikeletCount = Math.round(lerp(4, 16, spikeT));
  for (let i = 0; i < spikeletCount; i++) {
    const sy = (i/spikeletCount)*spikeH;
    const side = i%2===0 ? 1 : -1;

    // Floret cluster: 2-3 small lens-shaped grains/florets per node
    const floretsHere = stage >= 5 ? 3 : 2;
    for (let f = 0; f < floretsHere; f++) {
      const sg = new THREE.SphereGeometry(0.034, 5, 4);
      sg.scale(0.6, 1.2 + (stage>=5 ? f*0.08 : 0), 0.5);
      const grainColor = stage >= 5
        ? spikeColor.clone().lerp(new THREE.Color(0xe8c860), 0.3)
        : spikeColor;
      const sp = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: grainColor }));
      sp.position.set(side*(0.04 + f*0.012), sy + f*0.012, (f-1)*0.018);
      spikeGroup.add(sp);
    }

    if (stage >= 4) {
      const gg = new THREE.ConeGeometry(0.026, 0.12, 4);
      const glume = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ color: spikeColor }));
      glume.position.set(side*0.045, sy+0.07, 0);
      glume.rotation.z = side*0.3;
      spikeGroup.add(glume);
    }
  }

  spikeGroup.position.set(offset.x, y + offset.y, offset.z);
  spikeGroup.rotation.x = droopAngle;
  group.add(spikeGroup);
}

function addAwns(group, stemH, t) {
  const awnL = lerp(0.08, 0.72, (t-0.38)/0.62);
  if (awnL <= 0) return;
  const awnColor = new THREE.Color(0x4a7010).lerp(new THREE.Color(0xd4b830), (t-0.48)/0.52).multiply(locationTint);
  const droopAngle = t >= 0.95 ? 0.45 : t >= 0.78 ? 0.18 : 0;
  const cosD = Math.cos(droopAngle), sinD = Math.sin(droopAngle);

  for (let i = 0; i < 13; i++) {
    const along = (i/13)*0.85;
    const side = i%2===0 ? 1 : -1;
    // Two-segment awn with a slight outward curve, bent to follow the spike droop
    const baseY = stemH + 0.04 + along*cosD;
    const baseZ = along*sinD;

    const ag1 = new THREE.CylinderGeometry(0.0035, 0.002, awnL*0.55, 3);
    const seg1 = new THREE.Mesh(ag1, new THREE.MeshLambertMaterial({ color: awnColor }));
    seg1.position.set(side*0.055, baseY + (awnL*0.275)*cosD, baseZ + (awnL*0.275)*sinD);
    seg1.rotation.x = droopAngle;
    seg1.rotation.z = side*(0.22 + Math.random()*0.08);
    group.add(seg1);

    const ag2 = new THREE.CylinderGeometry(0.0012, 0.0006, awnL*0.5, 3);
    const seg2 = new THREE.Mesh(ag2, new THREE.MeshLambertMaterial({ color: awnColor }));
    const tipY = baseY + awnL*0.55*cosD;
    const tipZ = baseZ + awnL*0.55*sinD;
    seg2.position.set(side*0.058, tipY + (awnL*0.25)*cosD, tipZ + (awnL*0.25)*sinD);
    seg2.rotation.x = droopAngle + 0.3;
    seg2.rotation.z = side*(0.35 + Math.random()*0.1);
    group.add(seg2);
  }
}

// ── Location tint ────────────────────────────────────────────────────────────
function applyLocationTint(loc) {
  // Northern climates → slightly bluer/cooler; Mediterranean → warmer gold
  const tints = {
    'Toledo':      new THREE.Color(1.0,  0.98, 0.88),
    'Valladolid':  new THREE.Color(1.0,  1.0,  0.92),
    'Sajonia':     new THREE.Color(0.88, 1.0,  0.88),
    'Île-de-France': new THREE.Color(0.90, 1.0,  0.90),
  };
  const key = Object.keys(tints).find(k => loc.name.includes(k));
  locationTint = key ? tints[key] : new THREE.Color(1,1,1);

  // Update model info panel
  const typeEl = document.getElementById('info-type');
  if (typeEl) typeEl.textContent = loc.name.includes('Sajonia') || loc.name.includes('France') ? 'Invierno' : 'Primavera';

  // Colour tint is baked into each cached stage's geometry, so the whole
  // cache must be rebuilt when it changes.
  clearPlantCache();
  rebuildPlant();
  prewarmStages(STAGES.map(s => s.id).filter(id => id !== currentStage));
}

// ── Stage control ────────────────────────────────────────────────────────────
function goToStage(idx) {
  currentStage = idx;
  updateUI();
  rebuildPlant();
}

function setGroupOpacity(group, opacity) {
  group.traverse(o => {
    if (o.material) {
      o.material.transparent = true;
      o.material.opacity = opacity;
    }
  });
}

// All 7 stage groups are built once and kept (hidden) in the scene; switching
// stages then only toggles visibility/opacity instead of constructing dozens
// of meshes synchronously on the main thread, which is what caused the visible
// "stutter/cut" right as a new stage finished generating.
let plantCache = new Map();

function getOrBuildPlant(stage) {
  let group = plantCache.get(stage);
  if (!group) {
    group = buildPlant(stage);
    group.visible = false;
    setGroupOpacity(group, 0);
    scene.add(group);
    plantCache.set(stage, group);
  }
  return group;
}

// Builds the remaining stages a little at a time, one per animation frame, so
// the very first stage still appears instantly while the rest warm up quietly
// in the background before the user ever clicks/slides to them.
function prewarmStages(stages) {
  let i = 0;
  function step() {
    if (i >= stages.length) return;
    getOrBuildPlant(stages[i++]);
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function clearPlantCache() {
  fadeList = [];
  plantCache.forEach(group => {
    scene.remove(group);
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  });
  plantCache.clear();
  plantGroup = null;
}

function rebuildPlant() {
  const newGroup = getOrBuildPlant(currentStage);
  setGroupOpacity(newGroup, 0);
  newGroup.visible = true;
  fadeList.push({ group: newGroup, mode: 'in', start: clock.elapsedTime });

  if (plantGroup && plantGroup !== newGroup) {
    fadeList.push({ group: plantGroup, mode: 'out', start: clock.elapsedTime });
  }
  plantGroup = newGroup;

  const heights = [1.5, 2, 3, 4, 4.5, 5, 5.5];
  const targetY = heights[currentStage] * 0.5;
  camTargetAnim = {
    from: controls.target.clone(),
    to: new THREE.Vector3(0, targetY, 0),
    start: clock.elapsedTime
  };
}

function updateFades() {
  for (let i = fadeList.length - 1; i >= 0; i--) {
    const f = fadeList[i];
    const t = Math.min((clock.elapsedTime - f.start) / FADE_DURATION, 1);
    const eased = smoothstep(0, 1, t);
    setGroupOpacity(f.group, f.mode === 'in' ? eased : 1 - eased);

    if (t >= 1) {
      if (f.mode === 'out') {
        f.group.visible = false;
      }
      fadeList.splice(i, 1);
    }
  }
}

function updateUI() {
  const s = STAGES[currentStage];
  document.getElementById('stage-title').textContent = s.name;
  document.getElementById('stage-days').textContent = s.days[wheatType];

  const pct = (currentStage/(STAGES.length-1))*100;
  document.getElementById('top-bar-fill').style.width = pct+'%';

  document.querySelectorAll('.stage-btn').forEach((b,i) => b.classList.toggle('active', i===currentStage));
  document.querySelectorAll('.connector').forEach((c,i) => c.classList.toggle('passed', i<currentStage));

  const slider = document.getElementById('stage-slider');
  if (slider) {
    slider.value = currentStage;
    slider.style.setProperty('--fill', `${(currentStage/(STAGES.length-1))*100}%`);
  }

  // Right panel info
  const infoStage = document.getElementById('info-stage');
  const infoDays  = document.getElementById('info-days');
  if (infoStage) infoStage.textContent = `${currentStage+1}/7 — ${s.name}`;
  if (infoDays)  infoDays.textContent  = `~${s.cumDays[wheatType]} días`;
}

function buildTimeline() {
  const tl = document.getElementById('timeline');
  tl.innerHTML = '';
  STAGES.forEach((s,i) => {
    const btn = document.createElement('button');
    btn.className = 'stage-btn' + (i===0?' active':'');
    btn.innerHTML = `<span class="s-icon">${s.icon}</span><span class="s-label">${s.name}</span><span class="s-days">${s.days[wheatType]}</span>`;
    btn.onclick = () => { stopAuto(); goToStage(i); };
    tl.appendChild(btn);
    if (i < STAGES.length-1) {
      const conn = document.createElement('div');
      conn.className = 'connector';
      tl.appendChild(conn);
    }
  });
}

// ── Auto play ────────────────────────────────────────────────────────────────
function scheduleAuto() {
  if (autoTimer) clearTimeout(autoTimer);
  if (!autoPlay) return;
  autoTimer = setTimeout(() => {
    goToStage((currentStage+1) % STAGES.length);
    scheduleAuto();
  }, 3400);
}

function stopAuto() {
  autoPlay = false;
  if (autoTimer) clearTimeout(autoTimer);
  updateNavBtn();
}

function toggleAuto() {
  autoPlay = !autoPlay;
  updateNavBtn();
  if (autoPlay) scheduleAuto();
  else if (autoTimer) clearTimeout(autoTimer);
}

function updateNavBtn() {
  const btn = document.getElementById('btn-auto');
  if (!btn) return;
  btn.textContent = autoPlay ? '⏵' : '⏸';
  btn.classList.toggle('on', autoPlay);
}

// ── Render loop ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  if (plantGroup) {
    plantGroup.rotation.z = Math.sin(clock.elapsedTime * 0.55) * 0.012 * (currentStage/4);
  }
  updateFades();
  clock.getDelta();

  if (camTargetAnim) {
    const t = Math.min((clock.elapsedTime - camTargetAnim.start) / CAM_TARGET_DURATION, 1);
    const eased = smoothstep(0, 1, t);
    controls.target.lerpVectors(camTargetAnim.from, camTargetAnim.to, eased);
    if (t >= 1) camTargetAnim = null;
  }
  controls.update();

  const w = renderer.domElement.parentElement.clientWidth;
  const h = renderer.domElement.parentElement.clientHeight;
  if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
    renderer.setSize(w, h);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
}

function onResize() {
  const container = document.getElementById('canvas-container');
  renderer.setSize(container.clientWidth, container.clientHeight);
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
}

function lerp(a,b,t) { return a+(b-a)*Math.max(0,Math.min(1,t)); }
function smoothstep(a,b,t) { const x=Math.max(0,Math.min(1,(t-a)/(b-a))); return x*x*(3-2*x); }

init();
requestAnimationFrame(() => document.body.classList.add('loaded'));
