const http = require('http');

const queries = [
  { device: 'Dexter', query: 'Where is Dexter?' },
  { device: 'Jeshna', query: 'Where is Jeshna?' },
];

const results = {
  Dexter: [],
  Jeshna: [],
};

const INTERVAL_MS = 60 * 1000; // 1 minute
const DURATION_MS = 60 * 60 * 1000; // 1 hour
let startTime = null;
let testCount = 0;

function sendQuery(device, query) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ from: '+23058590100', text: query });

    const options = {
      hostname: 'localhost',
      port: 9001,
      path: '/dev/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const reply = json.reply || '';
          const isOnline = !reply.toLowerCase().includes('offline');
          const hasBattery = /\d+%/.test(reply);
          resolve({
            timestamp: new Date().toISOString(),
            reply: reply.substring(0, 100),
            isOnline,
            hasBattery,
          });
        } catch (err) {
          resolve({
            timestamp: new Date().toISOString(),
            reply: `ERROR: ${err.message}`,
            isOnline: null,
            hasBattery: null,
          });
        }
      });
    });

    req.on('error', (e) => {
      resolve({
        timestamp: new Date().toISOString(),
        reply: `CONNECTION ERROR: ${e.message}`,
        isOnline: null,
        hasBattery: null,
      });
    });

    req.write(postData);
    req.end();
  });
}

async function runTest() {
  testCount++;
  console.log(`\n[Test ${testCount}] ${new Date().toLocaleTimeString()}`);

  for (const { device, query } of queries) {
    const result = await sendQuery(device, query);
    results[device].push(result);
    console.log(
      `  ${device}: online=${result.isOnline ? '✓' : '✗'} battery=${result.hasBattery ? '✓' : '✗'}`
    );
  }
}

function printSummary() {
  console.log('\n\n=== CONSISTENCY REPORT ===\n');

  for (const device of ['Dexter', 'Jeshna']) {
    const tests = results[device];
    const onlineCount = tests.filter((t) => t.isOnline === true).length;
    const batteryCount = tests.filter((t) => t.hasBattery === true).length;
    const errorCount = tests.filter((t) => t.isOnline === null).length;

    console.log(`${device}:`);
    console.log(`  Total tests: ${tests.length}`);
    console.log(`  Online: ${onlineCount}/${tests.length} (${((onlineCount / tests.length) * 100).toFixed(1)}%)`);
    console.log(`  Battery shown: ${batteryCount}/${tests.length} (${((batteryCount / tests.length) * 100).toFixed(1)}%)`);
    console.log(`  Errors: ${errorCount}`);

    if (errorCount > 0) {
      console.log(`  Last error: ${tests.find((t) => t.isOnline === null)?.reply}`);
    }
    console.log();
  }

  // Check consistency between devices
  console.log('CONSISTENCY CHECK:');
  let consistent = 0;
  let inconsistent = 0;

  for (let i = 0; i < results.Dexter.length; i++) {
    const dex = results.Dexter[i];
    const jesh = results.Jeshna[i];
    if (dex.isOnline === jesh.isOnline && dex.hasBattery === jesh.hasBattery) {
      consistent++;
    } else {
      inconsistent++;
      if (inconsistent <= 3) {
        // Show first 3 inconsistencies
        console.log(
          `  Test ${i + 1}: Dexter(online=${dex.isOnline},batt=${dex.hasBattery}) vs Jeshna(online=${jesh.isOnline},batt=${jesh.hasBattery})`
        );
      }
    }
  }

  console.log(`  Consistent: ${consistent}/${results.Dexter.length} (${((consistent / results.Dexter.length) * 100).toFixed(1)}%)`);
  if (inconsistent > 0) {
    console.log(`  Inconsistent: ${inconsistent}/${results.Dexter.length}`);
  }
}

async function main() {
  console.log('🔍 Guardian Consistency Monitor (1 hour)');
  console.log(`Starting at ${new Date().toLocaleTimeString()}\n`);
  startTime = Date.now();

  // Run first test immediately
  await runTest();

  // Then run every INTERVAL_MS
  const intervalId = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= DURATION_MS) {
      clearInterval(intervalId);
      printSummary();
      console.log(`\nMonitoring complete. Elapsed: ${(elapsed / 1000 / 60).toFixed(1)} minutes`);
      process.exit(0);
    }
    await runTest();
  }, INTERVAL_MS);
}

main();
