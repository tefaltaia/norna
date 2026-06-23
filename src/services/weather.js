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
