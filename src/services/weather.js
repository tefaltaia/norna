const MONTHLY_AVERAGES_SPAIN = {
  1: { temp_avg: 7, humidity: 78 },   2: { temp_avg: 9, humidity: 74 },
  3: { temp_avg: 12, humidity: 68 },  4: { temp_avg: 14, humidity: 65 },
  5: { temp_avg: 18, humidity: 60 },  6: { temp_avg: 23, humidity: 55 },
  7: { temp_avg: 27, humidity: 50 },  8: { temp_avg: 27, humidity: 53 },
  9: { temp_avg: 22, humidity: 62 },  10: { temp_avg: 16, humidity: 70 },
  11: { temp_avg: 11, humidity: 75 }, 12: { temp_avg: 8, humidity: 78 }
};

export async function fetchWeatherForLocation(location, sowingDate, weeks) {
  const latAdj = (40 - location.lat) * 0.5;
  const start = new Date(sowingDate);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7);
    const month = d.getMonth() + 1;
    const base = MONTHLY_AVERAGES_SPAIN[month];
    out.push({
      week: w,
      date: d.toISOString().slice(0, 10),
      temp_avg: Math.round((base.temp_avg + latAdj) * 10) / 10,
      humidity: base.humidity
    });
  }
  return out;
}

// Bloque "terreno/clima puro": depende exclusivamente de ubicación y fecha, no del genoma.
export function assessEnvironmentalRisk(env, location) {
  const weeks = env.map(w => {
    // ET simplificada (Hargreaves-like): a mayor temperatura, mayor evapotranspiración semanal
    const water_need_mm_week = Math.round((2.5 + w.temp_avg * 0.35) * 10) / 10;

    let risk = 'bajo';
    const reasons = [];
    if (w.temp_avg <= 8) { risk = 'alto'; reasons.push('riesgo de helada'); }
    else if (w.temp_avg >= 28) { risk = 'alto'; reasons.push('riesgo de golpe de calor'); }
    else if (w.temp_avg <= 12 || w.temp_avg >= 25) { risk = 'medio'; reasons.push('temperatura subóptima'); }
    if (w.humidity >= 75) reasons.push('alta humedad (riesgo de hongos)');

    return {
      week: w.week,
      date: w.date,
      water_need_mm_week,
      climate_risk: risk,
      climate_risk_reasons: reasons
    };
  });

  return {
    location_label: location.label,
    weeks
  };
}
