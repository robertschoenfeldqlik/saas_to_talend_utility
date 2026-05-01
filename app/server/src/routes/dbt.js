const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const yaml = require('js-yaml');
const axios = require('axios');
const logger = require('../logger');

const router = express.Router();

const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:8081';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─────────── Helpers ───────────

const REF_RE = /\{\{\s*ref\(['"]([^'"]+)['"]\)\s*\}\}/g;
const SRC_RE = /\{\{\s*source\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\)\s*\}\}/g;
const MAT_RE = /\{\{\s*config\([^)]*materialized\s*=\s*['"]([^'"]+)['"]/;

function detectLayer(modelPath, modelName) {
  const p = (modelPath || '').replace(/\\/g, '/').toLowerCase();
  if (p.includes('/staging/') || p.includes('/stg/')) return 'staging';
  if (p.includes('/marts/')) return 'marts';
  if (p.includes('/intermediate/') || p.includes('/int/')) return 'intermediate';
  const n = (modelName || '').toLowerCase();
  if (n.startsWith('stg_')) return 'staging';
  if (n.startsWith('dim_') || n.startsWith('fct_') || n.startsWith('fact_')) return 'marts';
  if (n.startsWith('int_')) return 'intermediate';
  return 'other';
}

function parseModelSql(name, relPath, sql) {
  const refs = [];
  const sources = [];
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(sql)) !== null) refs.push(m[1]);
  SRC_RE.lastIndex = 0;
  while ((m = SRC_RE.exec(sql)) !== null) sources.push(`${m[1]}.${m[2]}`);
  const mat = MAT_RE.exec(sql);
  return {
    name,
    path: relPath,
    layer: detectLayer(relPath, name),
    sql,
    refs,
    sources,
    materialization: mat ? mat[1] : 'view',
  };
}

function parseSourcesYml(doc) {
  const out = [];
  if (!doc || !Array.isArray(doc.sources)) return out;
  for (const src of doc.sources) {
    if (!src) continue;
    const source_name = src.name;
    const schema = src.schema || src.database || source_name;
    const tables = Array.isArray(src.tables) ? src.tables : [];
    for (const t of tables) {
      if (!t) continue;
      out.push({
        source_name,
        schema,
        table: typeof t === 'string' ? t : t.name,
      });
    }
  }
  return out;
}

function parseProfilesYml(doc) {
  if (!doc || typeof doc !== 'object') return null;
  // profiles.yml has <profile_name>: { target: 'dev', outputs: { dev: {...} } }
  for (const profKey of Object.keys(doc)) {
    const prof = doc[profKey];
    if (!prof || typeof prof !== 'object') continue;
    const target = prof.target || 'dev';
    const outputs = prof.outputs || {};
    const out = outputs[target] || Object.values(outputs)[0];
    if (out && typeof out === 'object') {
      return {
        type: out.type || '',
        host: out.host || '',
        port: out.port ? String(out.port) : '',
        dbname: out.dbname || out.database || '',
        schema: out.schema || '',
        user: out.user || out.username || '',
      };
    }
  }
  return null;
}

function normalizePath(p) {
  return (p || '').replace(/\\/g, '/');
}

function stripCommonPrefix(entries) {
  if (!entries.length) return entries;
  const firstSeg = (p) => normalizePath(p).split('/')[0];
  const candidate = firstSeg(entries[0].path);
  if (!candidate) return entries;
  if (entries.every((e) => firstSeg(e.path) === candidate)) {
    return entries.map((e) => ({
      ...e,
      path: normalizePath(e.path).substring(candidate.length + 1),
    }));
  }
  return entries;
}

/**
 * entries: [{ path, content }] (paths forward-slash, content string)
 * Returns parse result.
 */
function parseDbtEntries(entries) {
  let projectName = null;
  let targetInfo = null;
  const sources = [];
  const models = [];

  for (const e of entries) {
    const p = normalizePath(e.path);
    const lower = p.toLowerCase();
    const base = lower.split('/').pop();

    if (base === 'dbt_project.yml' || base === 'dbt_project.yaml') {
      try {
        const doc = yaml.load(e.content);
        if (doc && doc.name) projectName = doc.name;
      } catch (err) {
        logger.warn({ err, path: p }, 'failed to parse dbt_project.yml');
      }
      continue;
    }
    if (base === 'profiles.yml' || base === 'profiles.yaml') {
      try {
        const doc = yaml.load(e.content);
        const ti = parseProfilesYml(doc);
        if (ti) targetInfo = ti;
      } catch (err) {
        logger.warn({ err, path: p }, 'failed to parse profiles.yml');
      }
      continue;
    }

    // YAML files inside models/
    if ((lower.endsWith('.yml') || lower.endsWith('.yaml')) && lower.includes('models/')) {
      try {
        const doc = yaml.load(e.content);
        const srcs = parseSourcesYml(doc);
        sources.push(...srcs);
      } catch (err) {
        logger.warn({ err, path: p }, 'failed to parse model yml');
      }
      continue;
    }

    // SQL models inside models/
    if (lower.endsWith('.sql') && lower.includes('models/')) {
      const name = base.replace(/\.sql$/i, '');
      models.push(parseModelSql(name, p, e.content));
    }
  }

  const layers = Array.from(new Set(models.map((m) => m.layer)));
  return {
    projectName: projectName || 'dbt_project',
    models,
    sources,
    targetInfo: targetInfo || null,
    stats: {
      totalModels: models.length,
      totalSources: sources.length,
      layers,
    },
  };
}

// ─────────── 1) Upload ZIP ───────────

// ZIP slip / decompression-bomb guards
const MAX_ZIP_ENTRIES = 5000;          // refuse pathological many-file archives
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB total uncompressed
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;          // 10 MB per individual file

/**
 * Returns true if a ZIP entry name is unsafe (absolute path, traversal,
 * Windows drive prefix, NUL byte, or backslash component) — any entry that
 * could escape the intended virtual root.
 */
function isUnsafeZipPath(entryName) {
  if (!entryName) return true;
  if (entryName.includes('\0')) return true;
  // Reject absolute paths
  if (entryName.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entryName)) return true;
  // Normalize separators and split
  const parts = entryName.replace(/\\/g, '/').split('/');
  return parts.some((p) => p === '..');
}

router.post('/upload-zip', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field "file")' });
    const zip = new AdmZip(req.file.buffer);
    const zipEntries = zip.getEntries();

    if (zipEntries.length > MAX_ZIP_ENTRIES) {
      return res.status(413).json({
        error: `ZIP has too many entries (${zipEntries.length}); limit is ${MAX_ZIP_ENTRIES}.`,
      });
    }

    let totalDecompressed = 0;
    const skipped = [];
    let entries = [];
    for (const ze of zipEntries) {
      if (ze.isDirectory) continue;

      // Path-traversal / absolute-path / NUL-byte guard
      if (isUnsafeZipPath(ze.entryName)) {
        skipped.push({ path: ze.entryName, reason: 'unsafe path' });
        continue;
      }

      // Per-entry size guard (zip-bomb defense)
      const declaredSize = ze.header && ze.header.size ? ze.header.size : 0;
      if (declaredSize > MAX_ENTRY_BYTES) {
        skipped.push({ path: ze.entryName, reason: 'entry too large' });
        continue;
      }

      let content = '';
      try {
        const buf = ze.getData();
        if (buf.length > MAX_ENTRY_BYTES) {
          skipped.push({ path: ze.entryName, reason: 'entry too large' });
          continue;
        }
        totalDecompressed += buf.length;
        if (totalDecompressed > MAX_DECOMPRESSED_BYTES) {
          return res.status(413).json({
            error: `Total decompressed size exceeds ${MAX_DECOMPRESSED_BYTES} bytes (zip-bomb guard).`,
          });
        }
        content = buf.toString('utf8');
      } catch {
        continue;
      }
      entries.push({ path: ze.entryName, content });
    }
    entries = stripCommonPrefix(entries);
    const result = parseDbtEntries(entries);
    if (skipped.length) result.skippedEntries = skipped;
    res.json(result);
  } catch (err) {
    logger.error({ msg: err.message }, 'upload-zip failed');
    res.status(500).json({ error: 'Failed to parse ZIP' });
  }
});

// ─────────── 2) Fetch GitHub repo ───────────

function parseGithubUrl(url) {
  if (!url) return null;
  // https://github.com/owner/repo[/tree/ref[/subpath...]]
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/i.exec(url.trim());
  if (!m) return null;
  return {
    owner: m[1],
    repo: m[2],
    ref: m[3] || 'main',
    subpath: m[4] ? m[4].replace(/\/+$/, '') : '',
  };
}

router.post('/fetch-repo', async (req, res) => {
  try {
    const { githubUrl } = req.body || {};
    const parsed = parseGithubUrl(githubUrl);
    if (!parsed) return res.status(400).json({ error: 'Invalid GitHub URL' });
    const { owner, repo, ref, subpath } = parsed;

    const ghHeaders = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'saas-to-talend',
    };
    if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    let treeResp;
    try {
      treeResp = await axios.get(treeUrl, { headers: ghHeaders, timeout: 30000 });
    } catch (err) {
      const status = err.response?.status;
      if (status === 403 || status === 429) {
        return res.status(429).json({
          error: 'GitHub rate limit exceeded. Set GITHUB_TOKEN env var to increase limits.',
        });
      }
      if (status === 404) return res.status(404).json({ error: 'Repository or ref not found' });
      throw err;
    }

    const tree = treeResp.data?.tree || [];
    const matches = tree.filter((t) => {
      if (t.type !== 'blob') return false;
      const p = t.path.toLowerCase();
      if (subpath && !t.path.startsWith(subpath)) return false;
      return p.endsWith('.sql') || p.endsWith('.yml') || p.endsWith('.yaml');
    });

    // Fetch contents in parallel (bounded)
    const entries = [];
    const batchSize = 8;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (t) => {
        const contentUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(t.path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`;
        try {
          const r = await axios.get(contentUrl, { headers: ghHeaders, timeout: 30000 });
          const data = r.data;
          if (data && data.content && data.encoding === 'base64') {
            const buf = Buffer.from(data.content, 'base64');
            return { path: t.path, content: buf.toString('utf8') };
          }
        } catch (err) {
          const status = err.response?.status;
          if (status === 403 || status === 429) {
            throw new Error('RATE_LIMIT');
          }
          logger.warn({ err: err.message, path: t.path }, 'failed to fetch file');
        }
        return null;
      }));
      for (const r of results) if (r) entries.push(r);
    }

    // Strip subpath prefix so parser sees "models/..." at the top
    let stripped = entries;
    if (subpath) {
      stripped = entries.map((e) => ({
        ...e,
        path: e.path.startsWith(subpath + '/') ? e.path.substring(subpath.length + 1) : e.path,
      }));
    }
    stripped = stripCommonPrefix(stripped);

    const result = parseDbtEntries(stripped);
    res.json({ ...result, repo: `${owner}/${repo}`, ref });
  } catch (err) {
    if (err.message === 'RATE_LIMIT') {
      return res.status(429).json({
        error: 'GitHub rate limit exceeded. Set GITHUB_TOKEN env var to increase limits.',
      });
    }
    logger.error({ err }, 'fetch-repo failed');
    res.status(500).json({ error: err.message || 'Failed to fetch repo' });
  }
});

// ─────────── 3) Parse pasted SQL ───────────

router.post('/parse-sql', async (req, res) => {
  try {
    const { projectName, files } = req.body || {};
    if (!Array.isArray(files)) return res.status(400).json({ error: 'files[] required' });
    const entries = files
      .filter((f) => f && f.path && typeof f.content === 'string')
      .map((f) => {
        let p = normalizePath(f.path);
        // Nudge bare SQL files into models/ so the parser picks them up
        if (p.toLowerCase().endsWith('.sql') && !p.toLowerCase().includes('models/')) {
          p = 'models/' + p.replace(/^\/+/, '');
        }
        return { path: p, content: f.content };
      });
    const result = parseDbtEntries(entries);
    if (projectName) result.projectName = projectName;
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'parse-sql failed');
    res.status(500).json({ error: err.message || 'Failed to parse SQL' });
  }
});

// ─────────── 4) Generate → Java engine ───────────

router.post('/generate', async (req, res) => {
  try {
    const resp = await axios.post(`${ENGINE_URL}/api/engine/dbt/generate`, req.body, {
      timeout: 30000,
    });
    res.status(resp.status).json(resp.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(err.response.data || { error: err.message });
    }
    logger.error({ err }, 'generate proxy failed');
    res.status(500).json({ error: err.message || 'Engine call failed' });
  }
});

module.exports = router;
