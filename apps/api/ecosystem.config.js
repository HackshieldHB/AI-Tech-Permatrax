/**
 * PM2 — Docker / Linux path layout (lihat juga ecosystem.config.js di root monorepo).
 * wait_ready dimatikan: Nest tidak mengirim signal 'ready' ke PM2 secara default.
 */
const apiInstances = process.env.PM2_INSTANCES || 'max';

module.exports = {
  apps: [
    {
      name: 'permatrax-api',
      script: 'dist/apps/api/src/main.js',
      cwd: '/app/apps/api',
      instances: apiInstances,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1500M',
      kill_timeout: 5000,
      node_args: '--max-old-space-size=1400',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/var/log/permatrax/api-error.log',
      out_file: '/var/log/permatrax/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
