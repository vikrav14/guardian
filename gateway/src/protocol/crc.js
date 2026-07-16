/**
 * CRC-ITU (CRC-16/X-25 style) used by Concox GT06 devices.
 * Computed over: packet length + protocol number + information + serial number.
 */
function crc16Itu(buffer) {
  let fcs = 0xffff;
  for (let i = 0; i < buffer.length; i += 1) {
    fcs ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      if (fcs & 0x0001) {
        fcs = (fcs >> 1) ^ 0x8408;
      } else {
        fcs >>= 1;
      }
    }
  }
  return (~fcs) & 0xffff;
}

function appendCrc(payloadWithoutCrcAndStop) {
  const crc = crc16Itu(payloadWithoutCrcAndStop);
  const out = Buffer.alloc(payloadWithoutCrcAndStop.length + 2);
  payloadWithoutCrcAndStop.copy(out);
  out.writeUInt16BE(crc, payloadWithoutCrcAndStop.length);
  return out;
}

module.exports = { crc16Itu, appendCrc };
