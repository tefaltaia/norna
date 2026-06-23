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

  return map;
}
