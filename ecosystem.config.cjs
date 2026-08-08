/**
 * PM2 process file for production (asli-api).
 * Prevents default ~2GB Node heap OOM under report/PDF/library load.
 *
 * Usage on droplet:
 *   cd /var/www/ASLI-STUD-BACK
 *   pm2 start ecosystem.config.cjs --env production
 *   # or: pm2 delete asli-api && pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'asli-api',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // Restart before hard OOM if RSS grows (MB)
      max_memory_restart: '2800M',
      node_args: '--max-old-space-size=3072',
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Avoid thrashing on crash loops
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
      kill_timeout: 8000,
      listen_timeout: 10000,
    },
  ],
};
