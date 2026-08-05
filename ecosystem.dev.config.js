/**
 * PM2 — DEV VPS (aitech-ilt.co.id)
 *
 * Runs 3 processes on one VPS:
 *   3000 → aitech-ilt.co.id          (AI Tech Website)
 *   3002 → aitech-ilt.co.id/Permatrax (Permatrax DEV frontend)
 *   3003 → aitech-ilt.co.id/Permatrax/api (Permatrax DEV API)
 *
 * Usage:
 *   pm2 start ecosystem.dev.config.js
 *   pm2 start ecosystem.dev.config.js --only permatrax-dev-api
 */

module.exports = {
  apps: [
    // ─── AI Tech Website ──────────────────────────────────────────────────
    {
      name: 'aitech-website',
      cwd: '/var/www/aitech-website/website',
      script: 'node',
      args: 'node_modules/next/dist/bin/next start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/pm2/aitech-website-error.log',
      out_file: '/var/log/pm2/aitech-website-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ─── Permatrax DEV — Frontend (Next.js) ──────────────────────────────
    {
      name: 'permatrax-dev-web',
      cwd: '/var/www/permatrax-dev/apps/web',
      script: 'node',
      args: 'node_modules/next/dist/bin/next start -p 3002',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        BASE_PATH: '/Permatrax',   // serves under aitech-ilt.co.id/Permatrax
        API_URL: 'http://localhost:3003',
      },
      error_file: '/var/log/pm2/permatrax-dev-web-error.log',
      out_file: '/var/log/pm2/permatrax-dev-web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
    },

    // ─── Permatrax DEV — API (NestJS) ────────────────────────────────────
    {
      name: 'permatrax-dev-api',
      cwd: '/var/www/permatrax-dev/apps/api',
      script: 'dist/apps/api/src/main.js',
      instances: 1,
      exec_mode: 'fork',  // fork (bukan cluster) karena ini dev
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
        DATABASE_URL: 'postgresql://permatrax:permatrax123@127.0.0.1:5432/permatrax_dev?schema=public&connection_limit=5',
        REDIS_URL: 'redis://:redis123@127.0.0.1:6379',
        REDIS_PASSWORD: 'redis123',
        JWT_SECRET: 'permatrax_jwt_dev_secret_aitech_2025_very_long_string',
        JWT_REFRESH_SECRET: 'permatrax_jwt_refresh_dev_secret_aitech_2025_very_long_string',
        JWT_EXPIRES_IN: '8h',
        REFRESH_TOKEN_EXPIRES_IN: '7d',
        FRONTEND_URL: 'https://aitech-ilt.co.id/Permatrax',
        CORS_ALLOWED_ORIGINS: 'https://aitech-ilt.co.id,https://www.aitech-ilt.co.id',
        UPLOAD_DIR: '/var/www/permatrax-dev/uploads',
        FILE_BASE_URL: 'https://aitech-ilt.co.id/Permatrax/api/files',
        MAX_FILE_SIZE: '52428800',
        // PAI P3: optional Ollama slot fill (heuristic always remains fallback)
        PAI_SLOT_FILL: 'true',
        OLLAMA_URL: 'http://127.0.0.1:11434',
        OLLAMA_MODEL: 'llama3.2',
      },
      error_file: '/var/log/pm2/permatrax-dev-api-error.log',
      out_file: '/var/log/pm2/permatrax-dev-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
