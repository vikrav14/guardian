const http = require('http');

const imei = '861397052547492'; // V52 Device - NEW
let checkCount = 0;
const maxChecks = 60;

function checkLocation() {
  checkCount++;
  const req = http.get(`http://localhost:9001/devices/${imei}/context`, (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const location = json.location?.placeName;
        const lat = json.location?.lat;
        const lng = json.location?.lng;
        const weather = json.weather?.condition;
        const temp = json.weather?.temperature;
        const hasLocation = location && location !== 'Unknown location' && lat && lng;

        console.log(`[${new Date().toLocaleTimeString()}] Check ${checkCount}: Location=${location}, Weather=${weather} ${temp}°C`);

        if (hasLocation) {
          console.log(`\n✅ LOCATION RECEIVED!\n`);
          console.log(`Location: ${location}`);
          console.log(`Coordinates: ${lat}, ${lng}`);
          console.log(`Weather: ${weather} ${temp}°C`);
          console.log(`Severity: ${json.weather?.severity}`);
          console.log(`Context Relevant: ${json.contextEvaluation?.relevant}`);
          if (json.contextEvaluation?.relevant) {
            console.log(`Context Message: ${json.contextEvaluation?.message}`);
          }
          process.exit(0);
        }

        if (checkCount < maxChecks) {
          setTimeout(checkLocation, 10000);
        } else {
          console.log('\n❌ Timeout: No location received after 10 minutes');
          process.exit(1);
        }
      } catch (err) {
        console.error('Parse error:', err.message);
        process.exit(1);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Request error:', err.message);
    process.exit(1);
  });
}

console.log(`Monitoring JESHNA (${imei})...`);
console.log(`(checking every 10 seconds, max 10 minutes)\n`);
checkLocation();
