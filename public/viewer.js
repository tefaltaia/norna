import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let models = [];

export function initViewer(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111827);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 1000);
  camera.position.set(0, 1, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.5;
  controls.maxDistance = 10;

  // PBR lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(2, 4, 3);
  dir.castShadow = true;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xaaddff, 0.4);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3, 64),
    new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(container);

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

export async function loadWeekModels(runId, weeks) {
  models.forEach(m => scene.remove(m.glb));
  models = [];

  const loader = new GLTFLoader();
  const loadPromises = [];

  for (let w = 0; w < weeks; w++) {
    loadPromises.push(
      loader.loadAsync(`/api/runs/${runId}/glb/${w}`)
        .then(gltf => ({ week: w, gltf }))
        .catch(err => {
          console.warn(`GLB week ${w} not available:`, err.message);
          return null;
        })
    );
  }

  const results = await Promise.all(loadPromises);

  for (const result of results) {
    if (!result) continue;
    const { week, gltf } = result;
    const group = gltf.scene;

    // Normalize size to fit in 1-unit cube
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const baseScale = maxDim > 0 ? 1 / maxDim : 1;
    group.scale.setScalar(baseScale);

    // Center on ground
    box.setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.x = -center.x;
    group.position.y = -box.min.y;
    group.position.z = -center.z;

    // Enable transparency for crossfade
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          m.transparent = true;
          m.opacity = 0;
        });
      }
    });

    scene.add(group);
    models.push({ week, glb: group, baseScale });
  }

  if (models.length > 0) setOpacity(models[0].glb, 1);
}

export function setWeek(weekFloat, phenology) {
  if (models.length === 0) return;
  const lower = Math.floor(weekFloat);
  const upper = Math.min(lower + 1, models.length - 1);
  const t = weekFloat - lower;

  models.forEach((m, i) => {
    const opacity = i === lower ? (1 - t) : (i === upper ? t : 0);
    setOpacity(m.glb, opacity);

    if ((i === lower || i === upper) && phenology) {
      const wIdx = Math.min(i, phenology.weeks.length - 1);
      const sf = phenology.weeks[wIdx].scale_factor || 0.3;
      m.glb.scale.setScalar(m.baseScale * (0.3 + sf * 0.7));
    }
  });
}

export function hideViewer() {}
export function showViewer() {}

function setOpacity(group, opacity) {
  group.visible = opacity > 0.001;
  group.traverse((c) => {
    if (c.isMesh && c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => { m.opacity = opacity; });
    }
  });
}
