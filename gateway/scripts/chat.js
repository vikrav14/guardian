/**
 * Local test for the WhatsApp AI assistant (no Twilio needed).
 *
 *   node scripts/chat.js "Where is mum?"
 *   node scripts/chat.js --from +23051234567 "Battery?"
 */
const args = process.argv.slice(2);
let from = '+23050000000';
const textParts = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--from') {
    from = args[++i];
  } else {
    textParts.push(args[i]);
  }
}
const text = textParts.join(' ').trim() || 'Where is the pendant?';

async function main() {
  const res = await fetch('http://127.0.0.1:9001/dev/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, text }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Error:', data);
    process.exit(1);
  }
  console.log(data.reply);
}

main().catch((err) => {
  console.error(err.message);
  console.error('Is the gateway running?  npm start');
  process.exit(1);
});
