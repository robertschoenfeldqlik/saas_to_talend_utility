const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./logger');

const engineProxy = require('./routes/engine-proxy');
const projectsRouter = require('./routes/projects');
const aiRouter = require('./routes/ai');
const dbtRouter = require('./routes/dbt');
const probeRouter = require('./routes/probe');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: Date.now() - start,
    }, 'request');
  });
  next();
});

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/engine', engineProxy);
app.use('/api/projects', projectsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/dbt', dbtRouter);
app.use('/api/probe', probeRouter);

// Serve Vite build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, _next) => {
  logger.error({ err, url: req.originalUrl }, 'Unhandled error');
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Bind 0.0.0.0 so the server is reachable from outside a Docker container
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, 'SaaS-to-Talend server started');
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// On SIGTERM (Docker stop) or SIGINT (Ctrl-C), stop accepting new connections,
// allow in-flight requests up to GRACE_MS, then exit. Without this, Docker
// kills mid-request and SQLite may close dirty.
const GRACE_MS = parseInt(process.env.SHUTDOWN_GRACE_MS || '15000', 10);
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, graceMs: GRACE_MS }, 'Shutdown signal received — closing server');

  const forceExitTimer = setTimeout(() => {
    logger.warn('Grace period expired — forcing exit');
    process.exit(1);
  }, GRACE_MS);
  forceExitTimer.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err: err.message }, 'Error closing server');
      process.exit(1);
    }
    logger.info('Server closed cleanly');
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Surface unhandled rejections instead of silently swallowing them
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled promise rejection');
});

module.exports = server;
