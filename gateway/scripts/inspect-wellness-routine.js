'use strict';

async function main() {
  const args = process.argv.slice(2);
  const request = args.length === 1 && args[0] === '--request-temperature';
  if (args.length && !request) throw new Error('Use no arguments or --request-temperature.');
  const config = require('../src/config');
  if (!config.adminApiKey) throw new Error('ADMIN_API_KEY is required.');
  const response = await fetch(`http://127.0.0.1:${config.httpPort}/admin/wellness-routine`, {
    method: request ? 'POST' : 'GET',
    headers: { 'X-Admin-Key': config.adminApiKey, 'Content-Type': 'application/json' },
    ...(request ? { body: JSON.stringify({ action: 'temperature_once' }) } : {}),
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  console.error('Could not reach the running gateway; check the gateway and its admin configuration.');
  process.exitCode = 1;
});
