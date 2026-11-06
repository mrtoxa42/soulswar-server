'use strict';
const { isIP } = require('node:net');
// Forwarding headers are meaningful only behind a configured trusted proxy.
// Read from the right: clients can prepend arbitrary addresses to XFF.
function clientIp(req, hops = process.env.RENDER ? 1 : Number(process.env.TRUST_PROXY_HOPS || 0)) {
  const direct = String(req.socket?.remoteAddress || 'unknown');
  if (!Number.isInteger(hops) || hops < 1 || hops > 8) return direct;
  const chain = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim());
  const candidate = chain[chain.length - hops];
  return candidate && isIP(candidate) ? candidate : direct;
}
module.exports = { clientIp };
