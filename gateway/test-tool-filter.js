const { runTool } = require('./src/assistant/tools');

// Simulate context with device having speedKmh: 3.16
const ctx = {
  devices: [
    {
      imei: '861397053140768',
      name: 'Dexter',
      nickname: 'Dexter',
      online: true,
      batteryPercent: 70,
      speedKmh: 3.16,  // Old stale value
      location: { lat: -20.029296, lng: 57.5960017 },
    },
  ],
};

(async () => {
  const result = await runTool(null, ctx, 'get_last_location', { device_name: 'Dexter' });
  console.log('Tool result:');
  console.log(JSON.stringify(result, null, 2));
})();
