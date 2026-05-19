/**
 * PM2 — production (monorepo root).
 * Override API workers: PM2_INSTANCES=4 pm2 start ecosystem.config.js --env production
 */
const apiInstances = process.env.PM2_INSTANCES || 'max';

module.exports = {
  apps: [
    {
      name: 'permatrax-api',
      cwd: './apps/api',
      script: 'dist/apps/api/src/main.js',
      instances: apiInstances,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      autorestart: true,
      kill_timeout: 5000,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        UPLOAD_DIR: './uploads',
        FILE_BASE_URL: 'https://api.permatrax.tech/api/files',
        MAX_FILE_SIZE: '52428800',
      },
      error_file: '../../logs/api-error.log',
      out_file: '../../logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
    },
    {
      name: 'permatrax-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      autorestart: true,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '../../logs/web-error.log',
      out_file: '../../logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
