/**
 * PM2 — monorepo root (Windows / VPS).
 * Kurangi PM2_INSTANCES jika tekanan koneksi DB (mis. PM2_INSTANCES=4 pm2 start ecosystem.config.js --env production).
 */
const apiInstances = process.env.PM2_INSTANCES || 'max';

module.exports = {
  apps: [
    {
      name: 'permatrax-api',
      script: 'pnpm',
      args: 'run start:prod',
      cwd: './apps/api',
      instances: apiInstances,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      kill_timeout: 5000,
      node_args: '--max-old-space-size=1400',
      error_file: './apps/api/logs/api-error.log',
      out_file: './apps/api/logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      env_production: {
        NODE_ENV: 'production',
      },
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'permatrax-web',
      script: 'pnpm',
      args: 'run start',
      cwd: './apps/web',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
