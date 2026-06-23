import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
  scene.background = new THREE.Color(0x16160e);
  scene.fog = new THREE.FogExp2(0x16160e, 0.035);

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

  window.addEventListener('resize', onResize);

  // Public API for right panel
  window.__wheatStartAuto = () => { autoPlay = true; scheduleAuto(); updateNavBtn(); };
  window.__wheatSetLocation = (loc) => applyLocationTint(loc);
  window.toggleAuto = toggleAuto;
  window.nextStage  = () => { stopAuto(); goToStage((currentStage + 1) % STAGES.length); };
  window.prevStage  = () => { stopAuto(); goToStage((currentStage - 1 + STAGES.length) % STAGES.length); };

  animate();
}

// ── Lights ──────────────────────────────────────────────────────────────────
function buildLights() {
  const sun = new THREE.DirectionalLight(0xffeebb, 2.8);
  sun.position.set(6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { near:0.5, far:50, left:-10, right:10, top:10, bottom:-10 });
  scene.add(sun);

  scene.add(new THREE.AmbientLight(0x20280c, 1.4));

  const fill = new THREE.DirectionalLight(0x304820, 0.5);
  fill.position.set(-6, 4, -6);
  scene.add(fill);

  scene.add(new THREE.HemisphereLight(0x506030, 0x3a1a05, 0.7));
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

  // Background stems
  for (let i = 0; i < 55; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 2.8 + Math.random() * 5.5;
    const h = 0.25 + Math.random() * 0.55;
    const g = new THREE.CylinderGeometry(0.018, 0.025, h, 4);
    const m = new THREE.MeshLambertMaterial({ color: 0x3a5818 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(Math.cos(ang)*r, h/2, Math.sin(ang)*r);
    mesh.rotation.z = (Math.random()-0.5)*0.15;
    scene.add(mesh);
  }
}

// ── Plant builder ────────────────────────────────────────────────────────────
function buildPlant(stage) {
  const g = new THREE.Group();
  const t = stage / 6;

  const stemH = lerp(0.05, 4.5, smoothstep(0, 0.7, t));
  const stemR = lerp(0.04, 0.062, t);

  // Base green shifts to gold at maturity, tinted by location
  const baseGreen = new THREE.Color(0x2a5a10).lerp(new THREE.Color(0xc8a020), Math.max(0,(t-0.7)/0.3));
  const green = baseGreen.clone().multiply(locationTint);

  // Roots
  const rootCount = Math.min(stage + 2, 7);
  for (let i = 0; i < rootCount; i++) {
    const ang = (i/rootCount)*Math.PI*2;
    const rL = lerp(0.08, 0.9, Math.min(t*2.2, 1));
    const rg = new THREE.CylinderGeometry(0.007, 0.003, rL, 4);
    const rm = new THREE.MeshLambertMaterial({ color: 0x7a4018 });
    const root = new THREE.Mesh(rg, rm);
    root.position.set(Math.cos(ang)*0.1, -rL/2-0.04, Math.sin(ang)*0.1);
    root.rotation.z = Math.cos(ang)*0.55;
    root.rotation.x = Math.sin(ang)*0.55;
    g.add(root);
  }

  // Seed
  if (stage <= 1) {
    const sg = new THREE.SphereGeometry(0.11, 8, 6);
    sg.scale(1, 0.68, 0.78);
    const sm = new THREE.MeshLambertMaterial({ color: 0xd4a030 });
    const seed = new THREE.Mesh(sg, sm);
    seed.position.y = -0.08;
    g.add(seed);
  }

  // Stem
  if (stemH > 0.05) {
    const stemGeo = new THREE.CylinderGeometry(stemR*0.65, stemR, stemH, 6);
    const stemMat = new THREE.MeshLambertMaterial({ color: green });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = stemH/2;
    stem.castShadow = true;
    g.add(stem);

    if (stage >= 2) {
      const nodeCount = Math.min(stage-1, 4);
      for (let i = 1; i <= nodeCount; i++) {
        const ny = (i/(nodeCount+1))*stemH;
        const ng = new THREE.SphereGeometry(stemR*1.25, 6, 4);
        const nm = new THREE.MeshLambertMaterial({ color: 0x304810 });
        const node = new THREE.Mesh(ng, nm);
        node.position.y = ny;
        g.add(node);
      }
    }
  }

  // Leaves
  const leafCount = Math.min(Math.max(stage, 1), 6);
  for (let i = 0; i < leafCount; i++) addLeaf(g, i, leafCount, stemH, t, green);

  // Tiller
  if (stage >= 2) {
    const tH = stemH * 0.62;
    const tg = new THREE.CylinderGeometry(stemR*0.45, stemR*0.55, tH, 5);
    const tm = new THREE.MeshLambertMaterial({ color: green });
    const tiller = new THREE.Mesh(tg, tm);
    tiller.position.set(0.22, tH/2, 0.08);
    tiller.rotation.z = 0.18;
    g.add(tiller);
    addLeaf(g, 0, 2, tH*0.9, t, green, new THREE.Vector3(0.22, 0, 0.08));
  }

  // Spike
  if (stage >= 3) {
    addSpike(g, stemH+0.04, Math.min((stage-3)/3, 1), stage, t, green);
  }

  // Awns
  if (stage >= 4) addAwns(g, stemH, t);

  return g;
}

function addLeaf(group, idx, total, stemH, t, green, offset = new THREE.Vector3()) {
  const angle = (idx/total)*Math.PI*2 + idx*0.75;
  const leafY = Math.min((0.15 + (idx/total)*0.6)*stemH, stemH-0.12);
  const leafL = lerp(0.28, 1.45, Math.min(t+0.22, 1)) * (0.68 + idx*0.08);
  const leafW = leafL * 0.17;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(leafW, leafL*0.28, leafW*0.28, leafL);
  shape.quadraticCurveTo(0, leafL*1.04, -leafW*0.28, leafL);
  shape.quadraticCurveTo(-leafW, leafL*0.28, 0, 0);

  const leafColor = new THREE.Color(0x2a6010)
    .lerp(new THREE.Color(0xb09020), Math.max(0,(t-0.58)/0.42))
    .multiply(locationTint);

  const geo = new THREE.ShapeGeometry(shape, 6);
  const mat = new THREE.MeshLambertMaterial({ color: leafColor, side: THREE.DoubleSide });
  const leaf = new THREE.Mesh(geo, mat);
  leaf.position.set(offset.x+Math.cos(angle)*0.07, leafY+offset.y, offset.z+Math.sin(angle)*0.07);
  leaf.rotation.y = angle;
  leaf.rotation.z = -0.28 - idx*0.04;
  leaf.castShadow = true;
  group.add(leaf);
}

function addSpike(group, y, spikeT, stage, t, green) {
  const spikeH = lerp(0.08, 0.95, spikeT);
  const spikeColor = new THREE.Color(0x4a7818)
    .lerp(new THREE.Color(0xd4a820), Math.max(0,(t-0.48)/0.52))
    .multiply(locationTint);

  const rachisGeo = new THREE.CylinderGeometry(0.022, 0.028, spikeH, 5);
  const rachis = new THREE.Mesh(rachisGeo, new THREE.MeshLambertMaterial({ color: spikeColor }));
  rachis.position.y = y + spikeH/2;
  group.add(rachis);

  const spikeletCount = Math.round(lerp(3, 13, spikeT));
  for (let i = 0; i < spikeletCount; i++) {
    const sy = y + (i/spikeletCount)*spikeH;
    const side = i%2===0 ? 1 : -1;
    const sg = new THREE.SphereGeometry(0.038, 5, 4);
    sg.scale(0.55, 1.25, 0.48);
    const sp = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: spikeColor }));
    sp.position.set(side*0.042, sy, 0);
    group.add(sp);

    if (stage >= 4) {
      const gg = new THREE.ConeGeometry(0.028, 0.11, 4);
      const glume = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ color: spikeColor }));
      glume.position.set(side*0.042, sy+0.065, 0);
      glume.rotation.z = side*0.28;
      group.add(glume);
    }
  }
}

function addAwns(group, stemH, t) {
  const awnL = lerp(0.08, 0.65, (t-0.38)/0.62);
  if (awnL <= 0) return;
  const awnColor = new THREE.Color(0x4a7010).lerp(new THREE.Color(0xd4b830), (t-0.48)/0.52).multiply(locationTint);
  for (let i = 0; i < 9; i++) {
    const ay = stemH + 0.04 + (i/9)*0.85;
    const side = i%2===0 ? 1 : -1;
    const ag = new THREE.CylinderGeometry(0.004, 0.0015, awnL, 3);
    const awn = new THREE.Mesh(ag, new THREE.MeshLambertMaterial({ color: awnColor }));
    awn.position.set(side*0.055, ay+awnL/2, 0);
    awn.rotation.z = side*(0.28 + Math.random()*0.12);
    group.add(awn);
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

  rebuildPlant();
}

// ── Stage control ────────────────────────────────────────────────────────────
function goToStage(idx) {
  currentStage = idx;
  updateUI();
  rebuildPlant();
}

function rebuildPlant() {
  if (plantGroup) {
    scene.remove(plantGroup);
    plantGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  plantGroup = buildPlant(currentStage);
  scene.add(plantGroup);

  const heights = [1.5, 2, 3, 4, 4.5, 5, 5.5];
  controls.target.set(0, heights[currentStage]*0.5, 0);
  controls.update();
}

function updateUI() {
  const s = STAGES[currentStage];
  document.getElementById('stage-title').textContent = s.name;
  document.getElementById('stage-days').textContent = s.days[wheatType];

  const pct = (currentStage/(STAGES.length-1))*100;
  document.getElementById('top-bar-fill').style.width = pct+'%';

  document.querySelectorAll('.stage-btn').forEach((b,i) => b.classList.toggle('active', i===currentStage));
  document.querySelectorAll('.connector').forEach((c,i) => c.classList.toggle('passed', i<currentStage));

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
  clock.getDelta();
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
