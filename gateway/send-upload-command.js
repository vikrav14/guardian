const net = require('net');

// V52 device info
const imei = '861397052547492';
const protocolId = '9705254749';

// Build the command: UPLOAD,300 (every 300 seconds = 5 minutes)
const content = 'UPLOAD,300';
const contentLength = content.length.toString(16).toUpperCase().padStart(4, '0');

// Packet format: [3G*deviceID*length*content]
// Using '3G' as manufacturer ID (device→server format, but we're testing)
const packet = `[3G*${protocolId}*${contentLength}*${content}]`;

console.log(`Sending UPLOAD command to V52 device (${imei})...`);
console.log(`Packet: ${packet}`);
console.log(`Content length: ${contentLength} (${content.length} bytes)`);

// Connect to gateway TCP port
const client = new net.Socket();
client.connect(9000, 'localhost', () => {
  console.log('Connected to gateway on port 9000');
  client.write(packet);
  console.log('✅ Command sent');
  setTimeout(() => {
    client.destroy();
    process.exit(0);
  }, 1000);
});

client.on('data', (data) => {
  console.log('Response:', data.toString());
});

client.on('error', (err) => {
  console.error('❌ Connection error:', err.message);
  process.exit(1);
});

client.on('close', () => {
  console.log('Connection closed');
});
