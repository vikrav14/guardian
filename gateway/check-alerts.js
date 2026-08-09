const { getDb } = require('./src/firestore');

(async () => {
  try {
    const db = getDb();

    // Get recent alerts for Dexter (IMEI 861397053139877)
    const imei = '861397053139877';

    const alertsSnapshot = await db
      .collection('alerts')
      .where('imei', '==', imei)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    console.log(`\n=== ALERTS FOR DEXTER (${imei}) ===`);

    if (alertsSnapshot.empty) {
      console.log('No alerts found');
    } else {
      alertsSnapshot.forEach((doc) => {
        const data = doc.data();
        const age = Math.round((Date.now() - data.createdAt.toDate().getTime()) / 1000);
        console.log(`\n[${age}s ago] ${data.type}`);
        console.log('  Severity:', data.severity);
        console.log('  Status:', data.notifyStatus);
        console.log('  Location:', data.location?.placeName);
        console.log('  Message:', data.message?.substring(0, 100));
      });
    }

    // Also check device's last location
    console.log('\n=== LATEST DEVICE DATA ===');
    const deviceDoc = await db.collection('devices').doc(imei).get();
    if (deviceDoc.exists) {
      const device = deviceDoc.data();
      console.log('Online:', device.online);
      console.log('Battery:', device.batteryPercent + '%');
      console.log('Last Location:', device.lastLocation?.placeName);
      console.log('Lat/Lng:', device.lastLocation?.lat, device.lastLocation?.lng);
      console.log('Last Seen:', device.lastSeenAt?.toDate?.().toISOString());
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
