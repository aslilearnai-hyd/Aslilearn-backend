import dns from 'dns';

/**
 * Windows/home routers often refuse Node's SRV DNS queries for mongodb+srv URIs
 * (querySrv ECONNREFUSED) while nslookup still works. Use reliable public DNS.
 *
 * Override with MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1 in .env
 * Set MONGO_DNS_SERVERS=system to skip.
 */
export function configureMongoDns() {
  const override = String(process.env.MONGO_DNS_SERVERS || '').trim();
  if (override.toLowerCase() === 'system') return;

  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '');
  if (!uri.startsWith('mongodb+srv://')) return;

  const servers = override
    ? override.split(',').map((s) => s.trim()).filter(Boolean)
    : ['8.8.8.8', '1.1.1.1', '8.8.4.4'];

  if (!servers.length) return;

  dns.setServers(servers);
  if (!override && process.platform === 'win32') {
    console.log(
      '🔧 MongoDB SRV DNS: using public resolvers (Windows router DNS workaround). Set MONGO_DNS_SERVERS=system to disable.',
    );
  } else if (override) {
    console.log(`🔧 MongoDB SRV DNS: using MONGO_DNS_SERVERS (${servers.join(', ')})`);
  }
}
