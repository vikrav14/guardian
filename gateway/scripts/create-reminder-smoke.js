const { getDb } = require('./src/firestore');

const db = getDb();

if (!db) {
  console.error(
    'Firestore is not initialized. Run this smoke utility with the gateway environment configured.',
  );
  process.exit(1);
}
const imei = '861397053140768'; // Dexter
const now = new Date();
const scheduledTime = new Date(now.getTime() + 2 * 60000); // 2 minutes from now
const timeStr = `${scheduledTime.getHours().toString().padStart(2, '0')}:${scheduledTime.getMinutes().toString().padStart(2, '0')}`;

console.log(`\n📋 Creating test reminder in Firestore...\n`);
console.log(`Current time: ${now.toISOString()}`);
console.log(`Scheduled for: ${timeStr} (in ~2 minutes)`);

const reminder = {
  id: 'test-reminder-1',
  medicineName: 'Aspirin',
  time: timeStr,
  frequency: 'daily',
  enabled: true,
  createdAt: now,
  lastSentAt: null,
  notes: 'Test reminder for Phase 3b',
};

db.collection('devices')
  .doc(imei)
  .collection('reminders')
  .doc(reminder.id)
  .set(reminder)
  .then(() => {
    console.log(`\n✅ Reminder created!`);
    console.log(`   Device: ${imei}`);
    console.log(`   Medicine: ${reminder.medicineName}`);
    console.log(`   Time: ${timeStr}`);
    console.log(`   Frequency: ${reminder.frequency}`);
    console.log(`\n⏱️  Scheduler checks every 60 seconds`);
    console.log(`📱 WhatsApp should send at ${timeStr}\n`);
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
