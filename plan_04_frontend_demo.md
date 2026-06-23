# Plan 04 — Frontend, visor 3D y demo

## HTML + JS vanilla — sin frameworks, sin distracciones

### 4.1 Estructura HTML `public/index.html`

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemelo Digital de Tomate · La Vega Innova</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app">
    <aside id="sidebar">
      <h1>🍅 Gemelo Digital</h1>

      <section class="control-group">
        <label>Archivo de genoma (.vcf)</label>
        <input type="file" id="vcf-input" accept=".vcf,.txt">
        <small id="vcf-info">Sin archivo</small>
      </section>

      <section class="control-group">
        <label>Punto de siembra</label>
        <div id="map" style="height: 200px;"></div>
        <small id="map-info">Haz clic en el mapa</small>
      </section>

      <section class="control-group">
        <label>Fecha de siembra</label>
        <input type="date" id="sowing-date" value="2026-03-15">
      </section>

      <button id="analyze-btn" disabled>🚀 Iniciar análisis</button>

      <hr>

      <section id="logs-section">
        <h3>Logs en vivo</h3>
        <pre id="logs"></pre>
      </section>
    </aside>

    <main id="viewer-area">
      <div id="three-canvas-container"></div>
      
      <div id="timeline-container">
        <button id="play-btn">▶ Auto</button>
        <input type="range" id="week-slider" min="0" max="3" step="0.01" value="0" disabled>
        <span id="week-label">Semana 0</span>
      </div>

      <div id="week-info-panel">
        <h3 id="week-title">—</h3>
        <p id="week-bbch">—</p>
        <p id="week-bio">—</p>
      </div>
    </main>
  </div>

  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/"
    }
  }
  </script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

### 4.2 Lógica principal `public/app.js`

```js
import { initViewer, loadWeekModels, setWeek } from './viewer.js';
import { initMap } from './map.js';

const state = {
  vcfContent: null,
  vcfFilename: null,
  location: null,
  weeks: 4,
  runId: null,
  phenology: null,
  autoplayInterval: null
};

// ═══════════════════════════════════════════════════════════════════════════
// === Map ===
// ═══════════════════════════════════════════════════════════════════════════

initMap((lat, lon) => {
  state.location = { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  document.getElementById('map-info').textContent = `📍 ${state.location.label}`;
  updateAnalyzeButton();
});

// ═══════════════════════════════════════════════════════════════════════════
// === VCF Upload ===
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('vcf-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.vcfFilename = file.name;
  state.vcfContent = await file.text();
  const lines = state.vcfContent.split('\n').length;
  document.getElementById('vcf-info').textContent = `📄 ${file.name} (${lines} líneas)`;
  updateAnalyzeButton();
});

function updateAnalyzeButton() {
  document.getElementById('analyze-btn').disabled = !(state.vcfContent && state.location);
}

// ═══════════════════════════════════════════════════════════════════════════
// === Analyze Button ===
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('analyze-btn').addEventListener('click', async () => {
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('logs').textContent = '';

  const sowingDate = document.getElementById('sowing-date').value;

  // POST /api/analyze
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vcf_filename: state.vcfFilename,
      vcf_content: state.vcfContent,
      location: state.location,
      sowing_date: sowingDate,
      weeks: state.weeks
    })
  });
  
  const { run_id } = await res.json();
  state.runId = run_id;

  // Conectar al stream de logs
  const es = new EventSource(`/api/runs/${run_id}/stream`);
  const logsEl = document.getElementById('logs');

  es.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    logsEl.textContent += `[${data.ts.slice(11, 19)}] ${data.msg}\n`;
    logsEl.scrollTop = logsEl.scrollHeight;
  });

  es.addEventListener('done', async () => {
    es.close();
    // Cargar metadata y modelos
    const metaRes = await fetch(`/api/runs/${run_id}/phenology`);
    const meta = await metaRes.json();
    state.phenology = meta;
    
    await loadWeekModels(run_id, state.weeks);
    document.getElementById('week-slider').disabled = false;
    
    setWeek(0, meta);
    updateWeekInfo(0, meta);
  });

  es.addEventListener('error', (e) => {
    if (e.data) {
      logsEl.textContent += `[ERROR] ${e.data}\n`;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// === Timeline Controls ===
// ═══════════════════════════════════════════════════════════════════════════

const slider = document.getElementById('week-slider');
const playBtn = document.getElementById('play-btn');

slider.addEventListener('input', (e) => {
  clearAutoplay();
  const w = parseFloat(e.target.value);
  setWeek(w, state.phenology);
  document.getElementById('week-label').textContent = `Semana ${w.toFixed(1)}`;
  updateWeekInfo(Math.round(w), state.phenology);
});

playBtn.addEventListener('click', () => {
  if (state.autoplayInterval) {
    clearAutoplay();
    playBtn.textContent = '▶ Auto';
  } else {
    playBtn.textContent = '⏸ Pausa';
    let w = parseFloat(slider.value);
    state.autoplayInterval = setInterval(() => {
      w += 0.05;
      if (w > 3) {
        clearAutoplay();
        playBtn.textContent = '▶ Auto';
        return;
      }
      slider.value = w;
      setWeek(w, state.phenology);
      document.getElementById('week-label').textContent = `Semana ${w.toFixed(1)}`;
      updateWeekInfo(Math.round(w), state.phenology);
    }, 100);
  }
});

function clearAutoplay() {
  if (state.autoplayInterval) {
    clearInterval(state.autoplayInterval);
    state.autoplayInterval = null;
  }
}

function updateWeekInfo(weekIdx, phenology) {
  if (!phenology) return;
  const w = phenology.weeks[Math.min(weekIdx, phenology.weeks.length - 1)];
  document.getElementById('week-title').textContent = w.title;
  document.getElementById('week-bbch').textContent = `BBCH ${w.bbch_stage} · ${w.estimated_height_cm} cm`;
  document.getElementById('week-bio').textContent = w.biological_summary;
}

// ═══════════════════════════════════════════════════════════════════════════
// === Initialize Viewer ===
// ═══════════════════════════════════════════════════════════════════════════

initViewer(document.getElementById('three-canvas-container'));
```

### 4.3 Visor Three.js con crossfade `public/viewer.js`

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let models = []; // array de { week, glb (THREE.Group) }

export function initViewer(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 1, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);

  // ─ Iluminación PBR ─
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(2, 4, 3);
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.3);
  fillLight.position.set(-3, 1, -2);
  scene.add(fillLight);

  // ─ Suelo sutil ─
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2, 32),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

export async function loadWeekModels(runId, weeks) {
  // Limpiar modelos previos
  models.forEach(m => scene.remove(m.glb));
  models = [];

  const loader = new GLTFLoader();
  for (let w = 0; w < weeks; w++) {
    const url = `/api/runs/${runId}/glb/${w}`;
    const gltf = await loader.loadAsync(url);
    const group = gltf.scene;

    // Normalizar tamaño
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 1 / maxDim;
    group.scale.setScalar(scale);

    // Centrar en suelo
    const center = box.getCenter(new THREE.Vector3());
    group.position.x = -center.x * scale;
    group.position.y = -box.min.y * scale;
    group.position.z = -center.z * scale;

    // Preparar material para crossfade
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0;
      }
    });

    scene.add(group);
    models.push({ week: w, glb: group });
  }

  // Mostrar el primero
  setOpacity(models[0].glb, 1);
}

export function setWeek(weekFloat, phenology) {
  if (models.length === 0) return;
  
  const lower = Math.floor(weekFloat);
  const upper = Math.min(lower + 1, models.length - 1);
  const t = weekFloat - lower;

  models.forEach((m, i) => {
    if (i === lower) setOpacity(m.glb, 1 - t);
    else if (i === upper) setOpacity(m.glb, t);
    else setOpacity(m.glb, 0);
  });
}

function setOpacity(group, opacity) {
  group.visible = opacity > 0.01;
  group.traverse((c) => {
    if (c.isMesh && c.material) c.material.opacity = opacity;
  });
}
```

### 4.4 Mapa con Leaflet `public/map.js`

```js
export function initMap(onSelect) {
  const map = L.map('map').setView([40.4168, -3.7038], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  let marker = null;
  map.on('click', (e) => {
    if (marker) map.removeLayer(marker);
    marker = L.marker(e.latlng).addTo(map);
    onSelect(e.latlng.lat, e.latlng.lng);
  });
}
```

### 4.5 Estilos CSS `public/style.css`

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f0f0f;
  color: #eee;
}

#app {
  display: grid;
  grid-template-columns: 300px 1fr;
  height: 100vh;
  gap: 1px;
  background: #222;
}

#sidebar {
  background: #1a1a1a;
  padding: 20px;
  overflow-y: auto;
  border-right: 1px solid #333;
}

#sidebar h1 {
  font-size: 20px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, #ff6b6b, #ee5a6f);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.control-group {
  margin-bottom: 20px;
}

.control-group label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: #999;
  margin-bottom: 8px;
}

.control-group input[type="file"],
.control-group input[type="date"] {
  width: 100%;
  padding: 8px;
  background: #222;
  border: 1px solid #333;
  border-radius: 4px;
  color: #eee;
  font-size: 13px;
}

.control-group small {
  display: block;
  font-size: 11px;
  color: #666;
  margin-top: 4px;
}

#map {
  border-radius: 4px;
  border: 1px solid #333;
  margin-bottom: 8px;
}

#analyze-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #ff6b6b, #ee5a6f);
  border: none;
  border-radius: 6px;
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
  transition: opacity 0.2s;
}

#analyze-btn:hover:not(:disabled) {
  opacity: 0.9;
}

#analyze-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

hr {
  margin: 20px 0;
  border: none;
  border-top: 1px solid #333;
}

#logs-section h3 {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: #999;
  margin-bottom: 10px;
}

#logs {
  background: #0f0f0f;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 10px;
  font-size: 11px;
  font-family: 'Courier New', monospace;
  max-height: 200px;
  overflow-y: auto;
  color: #0f0;
}

#viewer-area {
  position: relative;
  background: #0f0f0f;
}

#three-canvas-container {
  width: 100%;
  height: calc(100vh - 100px);
}

#timeline-container {
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 20px;
  display: flex;
  gap: 12px;
  align-items: center;
  background: rgba(0, 0, 0, 0.7);
  padding: 12px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

#play-btn {
  padding: 6px 12px;
  background: #ff6b6b;
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

#week-slider {
  flex: 1;
}

#week-label {
  font-size: 12px;
  font-weight: 600;
  min-width: 100px;
}

#week-info-panel {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  padding: 16px;
  border-radius: 6px;
  border: 1px solid #333;
  max-width: 250px;
}

#week-info-panel h3 {
  font-size: 14px;
  margin-bottom: 8px;
  color: #ff6b6b;
}

#week-info-panel p {
  font-size: 12px;
  color: #bbb;
  line-height: 1.4;
  margin-bottom: 6px;
}
```

---

## Timeline 48 horas: roadmap de implementación

### Día 1 — 22 de junio

| Hora | Tarea | Hito |
|------|-------|------|
| 15:00 | Kickoff y setup base | npm init + estructura de carpetas |
| 15:30 | Descargar VCF | `data/genomes/tomato_sample.vcf` listo |
| 17:00 | Ingesta RAG | > 400 chunks en ChromaDB |
| 19:00 | Backend paso 1 + 2 | JSON fenología en disco |
| 22:00 | Backend paso 3 + 4 | 4 PNG + 4 GLB descargados |
| 00:30 | SSE + endpoints REST | Logs en vivo funcionando |

**Dormir 2h (02:00 - 04:00)**

### Día 2 — 23 de junio

| Hora | Tarea | Hito |
|------|-------|------|
| 08:00 | Frontend HTML + mapa | Input VCF + selección ubicación |
| 11:00 | Visor Three.js | Slider temporal + crossfade |
| 13:30 | COMIDA (buffer de fallos) | — |
| 14:30 | End-to-end + pulido | 2 runs completos |
| 16:00 | Slides + pitch | Story telling listo |
| 17:30 | **DEMOFAY** | |

---

## Demo script (5 minutos)

1. **(30s) Hook visual:** Abrir la app, sin hablar. Subir VCF, clic en Madrid, "Iniciar análisis". Mientras corre, empieza a hablar.

2. **(45s) Problema:** *"En España cultivamos 4 millones de toneladas de tomate al año. Un agricultor que quiere probar una variedad nueva tarda 3 meses en saber cómo crece. Si el clima falla ese año, perdió 3 meses y 50.000€."*

3. **(45s) Solución:** *"Nuestro gemelo digital toma el genoma VCF real de la variedad — del Sol Genomics Network — y las condiciones exactas del punto de siembra, y simula visualmente cómo crecerá semana por semana. Antes de plantar la primera semilla."*

4. **(2 min) Demo:** Leer logs en voz alta ("QTL fw2.2 detectado", "Claude analizando fenología", "Generando imágenes"). Cuando termine, mover slider de semana 0 a 3. Rotar modelo 3D. Mostrar panel info derecha.

5. **(45s) Bajo el capot:** *"Tres innovaciones: (1) RAG agronómico curado, no genérico. (2) Pipeline IA encadenada donde cada paso refina el anterior. (3) Arquitectura FIWARE nativa — datos como NGSI-LD listos para vuestra plataforma."* Abre `/api/runs/.../fiware` 5 segundos.

6. **(45s) Impacto:** *"Tres clientes: semilleros que ahorran 200k€, cooperativas que comparan variedades, aseguradoras que modelan escenarios climáticos. Hoy tomate; mañana, cualquier Solanaceae cambiando un catálogo. Modular. Escalable. Integrable."*

---

## Riesgos mitigación

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|-----------|
| fal.ai API lenta | Media | Pre-generar 1 run de backup guardado en `runs/backup_run/` |
| Claude tarda mucho | Baja | Timeout a 10s, fallback con template hardcoded |
| Tripo falla | Media | Usar PNG como fallback en visor (no GLB) |
| ChromaDB no inicia | Baja | Pre-inicializar con `ingest_rag.py` antes de hackathon |
| WiFi falla | Alta | Llevar scripts locales offline; demostrar screenshots si es necesario |

**Regla de oro:** tener SIEMPRE un run pre-generado de backup en el disco. Si algo falla in vivo, la demo sigue.
