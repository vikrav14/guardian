const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTcpPublicUrl,
  findTcpTunnelForPort,
  formatServerSwitchSms,
} = require('../src/ngrok-hint');

test('parseTcpPublicUrl extracts host and port', () => {
  assert.deepEqual(parseTcpPublicUrl('tcp://8.tcp.ngrok.io:15375'), {
    host: '8.tcp.ngrok.io',
    port: 15375,
  });
  assert.equal(parseTcpPublicUrl('http://bad'), null);
});

test('findTcpTunnelForPort matches localhost forwarding target', () => {
  const payload = {
    tunnels: [{
      proto: 'tcp',
      public_url: 'tcp://0.tcp.in.ngrok.io:24975',
      config: { addr: 'localhost:9000' },
    }],
  };
  assert.deepEqual(findTcpTunnelForPort(payload, 9000), {
    host: '0.tcp.in.ngrok.io',
    port: 24975,
  });
});

test('formatServerSwitchSms uses vendor ip command syntax', () => {
  assert.equal(
    formatServerSwitchSms({ host: '8.tcp.ngrok.io', port: 15375 }),
    'ip,8.tcp.ngrok.io,15375#'
  );
});
