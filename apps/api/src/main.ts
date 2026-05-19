import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express'; // FIX: use express app type for static assets
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet'; // FIX: security headers middleware
import { ThrottleExceptionFilter } from './common/filters/throttle-exception.filter';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { initApiSentry } from './sentry/instrument';
import * as path from 'path';
import * as fs from 'fs';
import * as express from 'express'; // FIX: body size limits for KMZ → GeoJSON POST /map/layers

initApiSentry();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule); // FIX: enable static asset serving

  const warnIfMissing = (label: string, keys: string[]) => {
    const missing = keys.filter((k) => !process.env[k]?.trim());
    if (missing.length) {
      console.warn(
        `[PermaTrax API] ${label}: environment not fully configured (missing: ${missing.join(', ')}). Email sending will fail until set.`,
      );
    }
  };
  warnIfMissing('SMTP transport', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']);
  warnIfMissing('Outbound mail identity', ['SMTP_FROM', 'PROCUREMENT_FROM_EMAIL']);

  // FIX: increase body size limit for KMZ/GeoJSON uploads (default ~100kb causes PayloadTooLargeError)
  // FIX: must run before enableCors / listen — registered first so large JSON is parsed before Nest’s default parser chain
  app.use(express.json({ limit: '50mb' })); // FIX
  app.use(
    express.urlencoded({
      extended: true, // FIX
      limit: '50mb', // FIX
    }),
  ); // FIX

  // FIX: helmet — sensible secure defaults.
  //  - crossOriginResourcePolicy 'cross-origin' needed so /api/files/* can be embedded/downloaded from the web app
  //  - contentSecurityPolicy disabled because this app serves JSON + static PDFs, not HTML pages
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  // CORS: dev = lenient (any origin, including missing / "null" for Postman & tooling).
  // Production = strict whitelist from CORS_ALLOWED_ORIGINS or FRONTEND_URL, plus optional ngrok tunnel hosts.
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProductionCors = nodeEnv === 'production';

  const productionOriginAllowlist = (
    process.env.CORS_ALLOWED_ORIGINS ??
    process.env.FRONTEND_URL ??
    ''
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const productionNgrokOriginPatterns = [
    /^https:\/\/[a-zA-Z0-9-]+\.ngrok-free\.app$/,
    /^https:\/\/[a-zA-Z0-9-]+\.ngrok-free\.dev$/,
    /^https:\/\/[a-zA-Z0-9-]+\.ngrok\.io$/,
    /^https:\/\/[a-zA-Z0-9-]+\.ngrok\.dev$/,
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!isProductionCors) {
        return callback(null, true);
      }

      if (!origin) {
        console.error('[CORS] Production: rejected request with missing Origin header');
        return callback(null, false);
      }

      if (origin === 'null') {
        console.error('[CORS] Production: rejected literal "null" Origin');
        return callback(null, false);
      }

      if (productionOriginAllowlist.includes(origin)) {
        return callback(null, true);
      }

      const matchesNgrokTunnel = productionNgrokOriginPatterns.some((p) =>
        p.test(origin),
      );
      if (matchesNgrokTunnel) {
        console.log(`[CORS] Production: allowed ngrok tunnel origin: ${origin}`);
        return callback(null, true);
      }

      console.error(`[CORS] Production: blocked origin: ${origin}`);
      console.error(
        '[CORS] Add the origin to CORS_ALLOWED_ORIGINS or FRONTEND_URL (comma-separated).',
      );
      return callback(null, false);
    },
    credentials:      true,
    methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders:   [
      'Content-Type', 'Authorization',
      'ngrok-skip-browser-warning', // FIX: always allow ngrok header
      'X-Requested-With',
    ],
    exposedHeaders:   ['Content-Disposition'],
    preflightContinue: false, // FIX: finish OPTIONS inside cors middleware
    optionsSuccessStatus: 204, // FIX: standard preflight success for static + API
  });

  // FIX: Global validation pipe — strips unknown fields, validates DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // NEW: Consistent JSON errors for all unhandled exceptions
  app.useGlobalFilters(new GlobalExceptionFilter());
  // FIX: Register custom throttle exception filter
  app.useGlobalFilters(new ThrottleExceptionFilter());

  // FIX: Global prefix for all API routes
  app.setGlobalPrefix('api');

  // HARD: never advertise JSON at GET / — wrong tunnel (ngrok -> :3001) or probes must not look like "the app".
  const httpServer = app.getHttpAdapter().getInstance() as express.Express;
  httpServer.get('/', (_req: express.Request, res: express.Response) => {
    res.status(404).type('text/plain').send('Not Found');
  });

  const uploadDir = process.env.UPLOAD_DIR // FIX: resolve local upload directory
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) { // FIX: ensure upload dir exists
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`[PermaTrax] Created uploads dir: ${uploadDir}`);
  }

  // FIX: CORS + OPTIONS for static PDFs (browser preflight from opaque/null origins)
  app.use('/api/files', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // FIX: file GET is safe without cookies
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); // FIX
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, ngrok-skip-browser-warning, Content-Type', // FIX
    );
    if (req.method === 'OPTIONS') {
      return res.status(204).end(); // FIX: answer preflight without 500
    }
    next();
  });

  app.useStaticAssets(uploadDir, { prefix: '/api/files' }); // FIX: serve files via /api/files

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`[PermaTrax API] Running on http://localhost:${port}/api`);
  console.log(`[PermaTrax API] Files served at http://localhost:${port}/api/files/`); // FIX: file serving log
  console.log(`[PermaTrax API] Upload dir: ${uploadDir}`); // FIX: local storage directory log
}

bootstrap();
