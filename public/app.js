import { initMap } from './map.js';

let mapInitialized = false;

document.getElementById('terrain-btn').addEventListener('click', () => {
  const mapEl = document.getElementById('map');
  if (mapEl.style.display === 'none') {
    mapEl.style.display = 'block';
    mapEl.style.height = '180px';
    if (!mapInitialized) {
      mapInitialized = true;
      initMap((lat, lon) => {
        state.location = { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
        document.getElementById('map-info').textContent = `${lat.toFixed(4)}°N ${Math.abs(lon).toFixed(4)}°W`;
        document.getElementById('coord-location').textContent = 'seleccionado';
      });
    }
  } else {
    mapEl.style.display = 'none';
  }
});

const state = {
  vcfContent: null,
  vcfFilename: null,
  location: { lat: 39.8628, lon: -4.0273, label: '39.8628, -4.0273' }, // default Toledo
  weeks: 4,
  runId: null,
  phenology: null,
  playing: false,
  playInterval: null,
  activeWeek: 0
};

// === Demo mode (no API keys needed) ===
document.getElementById('demo-btn').addEventListener('click', async () => {
  const DEMO_RUN = 'r_demo_backup';
  state.runId = DEMO_RUN;
  state.weeks = 4;
  document.getElementById('logs').textContent = '[DEMO] Cargando run pre-generado...\n[DEMO] QTL fw2.2 detectado: fruto grande (+30%)\n[DEMO] QTL lcy-b: licopeno alto\n[DEMO] Cultivar: Tipo beef/Heinz\n[DEMO] Fenología 4 semanas cargada\n';
  showLoading('Cargando datos demo...');
  try {
    const meta = await (await fetch(`/api/runs/${DEMO_RUN}/phenology`)).json();
    state.phenology = meta;
    const genome = await (await fetch(`/api/runs/${DEMO_RUN}/genome`)).json();
    const badge = document.getElementById('genome-badge');
    badge.textContent = `🧬 ${genome.inferredCultivar} · ${genome.keyVariants.length} QTLs · ${genome.totalVariants} variantes`;
    badge.classList.add('visible');
    hideLoading();
    document.getElementById('week-slider').disabled = false;
    showWeekImage(DEMO_RUN, 0);
    updateWeekInfo(0, meta);
    appendLog('[DEMO] ✓ Datos fenológicos cargados.');
  } catch (err) {
    hideLoading();
    appendLog(`[ERROR] Demo: ${err.message}`);
  }
});

// === VCF upload ===
document.getElementById('vcf-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.vcfFilename = file.name;
  state.vcfContent = await file.text();
  const lines = state.vcfContent.split('\n').length;
  document.getElementById('vcf-info').textContent = `✓ ${file.name} · ${lines} líneas`;
  updateAnalyzeButton();
});

function updateAnalyzeButton() {
  document.getElementById('analyze-btn').disabled = !state.vcfContent;
}

// === Analyze ===
document.getElementById('analyze-btn').addEventListener('click', async () => {
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('logs').textContent = '';
  document.getElementById('genome-badge').classList.remove('visible');
  showLoading('Iniciando análisis...');

  const sowingDate = document.getElementById('sowing-date').value;

  try {
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

    if (!res.ok) throw new Error(await res.text());
    const { run_id } = await res.json();
    state.runId = run_id;

    const es = new EventSource(`/api/runs/${run_id}/stream`);
    const logsEl = document.getElementById('logs');

    es.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      const time = data.ts.slice(11, 19);
      logsEl.textContent += `[${time}] ${data.msg}\n`;
      logsEl.scrollTop = logsEl.scrollHeight;
      updateLoadingText(data.msg);
    });

    es.addEventListener('done', async () => {
      es.close();
      hideLoading();

      try {
        const meta = await (await fetch(`/api/runs/${run_id}/phenology`)).json();
        state.phenology = meta;

        const genome = await (await fetch(`/api/runs/${run_id}/genome`)).json();
        const badge = document.getElementById('genome-badge');
        badge.textContent = `🧬 ${genome.inferredCultivar} · ${genome.keyVariants.length} QTLs · ${genome.totalVariants} variantes`;
        badge.classList.add('visible');

        showWeekImage(run_id, 0);
        setActiveWeekTab(0);
        updateWeekInfo(0, meta);
        document.getElementById('week-slider').disabled = false;
        document.getElementById('analyze-btn').disabled = false;
      } catch (err) {
        hideLoading();
        appendLog(`[ERROR] Al cargar imágenes: ${err.message}`);
        document.getElementById('analyze-btn').disabled = false;
      }
    });

    es.addEventListener('error', (e) => {
      if (e.data) appendLog(`[ERROR] ${JSON.parse(e.data).error}`);
      hideLoading();
      document.getElementById('analyze-btn').disabled = false;
    });

  } catch (err) {
    hideLoading();
    appendLog(`[ERROR] ${err.message}`);
    document.getElementById('analyze-btn').disabled = false;
  }
});

// === Week tab clicks ===
document.querySelectorAll('.week-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const week = parseInt(btn.dataset.week, 10);
    setActiveWeekTab(week);
    if (state.runId) {
      showWeekImage(state.runId, week);
    }
    if (state.phenology) {
      updateWeekInfo(week, state.phenology);
    }
    // sync hidden slider for legacy compatibility
    const slider = document.getElementById('week-slider');
    slider.value = Math.min(week, 3);
  });
});

// === Slider (hidden, kept for legacy) ===
const slider = document.getElementById('week-slider');
slider.addEventListener('input', (e) => {
  const w = parseInt(e.target.value, 10);
  document.getElementById('week-label').textContent = `Semana ${w + 1}`;
  updateWeekInfo(w, state.phenology);
  setActiveWeekTab(w);
  if (state.runId) showWeekImage(state.runId, w);
});

// === Play button (hidden) ===
document.getElementById('play-btn').addEventListener('click', () => {
  if (state.playing) {
    clearInterval(state.playInterval);
    state.playing = false;
    document.getElementById('play-btn').textContent = '▶';
    return;
  }
  state.playing = true;
  document.getElementById('play-btn').textContent = '⏸';
  let val = parseInt(slider.value, 10);
  state.playInterval = setInterval(() => {
    val = (val + 1) % 4;
    slider.value = val;
    slider.dispatchEvent(new Event('input'));
  }, 1500);
});

// === Image display ===
function showWeekImage(runId, week) {
  state.activeWeek = week;
  const img = document.getElementById('plant-image');
  const placeholder = document.getElementById('plant-placeholder');
  const url = `/api/runs/${runId}/image/${week}`;

  img.onload = () => {
    placeholder.style.display = 'none';
    img.style.display = 'block';
  };
  img.onerror = () => {
    placeholder.style.display = 'flex';
    img.style.display = 'none';
  };
  img.src = url;

  // Update days badge (week * 7 days)
  const days = week * 7;
  document.getElementById('days-badge').textContent = `han pasado ${days} días`;

  // Update progress bar (week 0-3 = 0-75%, week 4 = 100%)
  const pct = week === 4 ? 100 : (week / 4) * 100;
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

function setActiveWeekTab(week) {
  document.querySelectorAll('.week-tab').forEach((btn, i) => {
    btn.classList.toggle('active', parseInt(btn.dataset.week, 10) === week);
  });
}

function updateWeekInfo(weekIdx, phenology) {
  if (!phenology) return;
  const w = phenology.weeks[Math.min(weekIdx, phenology.weeks.length - 1)];
  if (!w) return;
  document.getElementById('week-title').textContent = w.title || `Semana ${w.week}`;
  document.getElementById('week-bbch').textContent = `BBCH ${w.bbch_stage} · ${w.estimated_height_cm} cm estimados`;
  document.getElementById('week-bio').textContent = w.biological_summary;
}

function appendLog(text) {
  const logsEl = document.getElementById('logs');
  logsEl.textContent += text + '\n';
  logsEl.scrollTop = logsEl.scrollHeight;
}

function showLoading(msg) {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function updateLoadingText(msg) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = msg;
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}
