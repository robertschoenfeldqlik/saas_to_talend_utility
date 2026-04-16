const express = require('express');
const axios = require('axios');
const logger = require('../logger');

const router = express.Router();
const ENGINE_TARGET = process.env.ENGINE_URL || 'http://localhost:8081';

/**
 * Simple reverse proxy to the Java engine.
 * Uses axios instead of http-proxy-middleware to avoid body parsing conflicts
 * and ensure fast error responses when the engine is offline.
 */
router.all('/*', async (req, res) => {
  const path = req.originalUrl; // preserves /api/engine/...
  const url = `${ENGINE_TARGET}${path}`;

  try {
    const resp = await axios({
      method: req.method,
      url,
      data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      headers: {
        'Content-Type': 'application/json',
        'Accept': req.headers.accept || 'application/json',
      },
      timeout: 5000,
      responseType: path.includes('/export') ? 'arraybuffer' : 'json',
      validateStatus: () => true, // don't throw on 4xx/5xx
    });

    // Forward response headers for file downloads
    if (resp.headers['content-disposition']) {
      res.setHeader('Content-Disposition', resp.headers['content-disposition']);
    }
    if (resp.headers['content-type']) {
      res.setHeader('Content-Type', resp.headers['content-type']);
    }

    res.status(resp.status).send(resp.data);
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
      logger.warn('Java engine not reachable at %s', ENGINE_TARGET);
      return res.status(503).json({
        error: 'Java engine is not running',
        detail: `Cannot connect to ${ENGINE_TARGET}. Start the engine with: cd engine && mvn spring-boot:run`,
      });
    }
    logger.error({ err }, 'Engine proxy error');
    res.status(502).json({ error: `Engine error: ${err.message}` });
  }
});

module.exports = router;
