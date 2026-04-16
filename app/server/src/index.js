const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./logger');

const engineProxy = require('./routes/engine-proxy');
const projectsRouter = require('./routes/projects');
const aiRouter = require('./routes/ai');
const dbtRouter = require('./routes/dbt');

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

module.exports = server;
