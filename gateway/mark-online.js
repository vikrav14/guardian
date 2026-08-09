const { getDb } = require('./src/firestore');

(async () => {
  const db = getDb();
  const imei = '861397053140768'; // Dexter

  try {
    // Update device to online since it's actively sending data
    await db.collection('devices').doc(imei).update({
      online: true,
      lastSeenAt: new Date()
    });

    console.log('✅ Dexter device marked ONLINE');
    console.log('');

    // Fetch updated status
    const doc = await db.collection('devices').doc(imei).get();
    const data = doc.data();

    console.log('Updated Device Status:');
    console.log('  Online: ' + data.online);
    console.log('  Battery: ' + data.batteryPercent + '%');
    console.log('  Location: ' + data.lastLocation?.placeName);
    console.log('  Last Seen: ' + data.lastSeenAt?.toDate?.().toISOString());

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
