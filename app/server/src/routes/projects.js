const express = require('express');
const axios = require('axios');
const logger = require('../logger');
const { mapAuthConfig } = require('../services/authMapper');
const { getDb, queryAll, queryOne, runSql } = require('../services/db');

const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:8081';

const router = express.Router();

// Ensure DB is ready before handling requests
router.use(async (req, res, next) => {
  try {
    await getDb();
    next();
  } catch (err) {
    logger.error({ err }, 'Database initialization failed');
    res.status(500).json({ error: 'Database not available' });
  }
});

// GET /api/projects
router.get('/', (req, res) => {
  try {
    const projects = queryAll(`
      SELECT p.*, COUNT(j.id) as jobCount
      FROM projects p LEFT JOIN jobs j ON j.projectId = p.id
      GROUP BY p.id ORDER BY p.updatedAt DESC
    `);
    res.json(projects);
  } catch (err) {
    logger.error({ err }, 'Failed to list projects');
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// GET /api/projects/stats
router.get('/stats', (req, res) => {
  try {
    const projects = queryAll('SELECT * FROM projects');
    const totalJobs = queryOne('SELECT COUNT(*) as count FROM jobs');
    const byStatus = queryAll('SELECT status, COUNT(*) as count FROM jobs GROUP BY status');
    const recent = queryAll(`
      SELECT p.*, COUNT(j.id) as jobCount
      FROM projects p LEFT JOIN jobs j ON j.projectId = p.id
      GROUP BY p.id ORDER BY p.updatedAt DESC LIMIT 5
    `);
    res.json({
      totalProjects: projects.length,
      totalJobs: totalJobs?.count || 0,
      jobsByStatus: byStatus,
      recentProjects: recent,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get stats');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// POST /api/projects
router.post('/', (req, res) => {
  try {
    const { name, apiName, baseUrl, authConfig } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const result = runSql(
      'INSERT INTO projects (name, apiName, baseUrl, authConfig) VALUES (?, ?, ?, ?)',
      [name, apiName || null, baseUrl || null, JSON.stringify(authConfig || {})],
    );
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [result.lastId]);
    res.status(201).json(project);
  } catch (err) {
    logger.error({ err }, 'Failed to create project');
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  try {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const jobs = queryAll('SELECT * FROM jobs WHERE projectId = ? ORDER BY createdAt DESC', [req.params.id]);
    res.json({ ...project, jobs });
  } catch (err) {
    logger.error({ err }, 'Failed to get project');
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  try {
    const existing = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const { name, apiName, baseUrl, authConfig } = req.body;
    runSql(
      "UPDATE projects SET name = ?, apiName = ?, baseUrl = ?, authConfig = ?, updatedAt = datetime('now') WHERE id = ?",
      [
        name || existing.name,
        apiName !== undefined ? apiName : existing.apiName,
        baseUrl !== undefined ? baseUrl : existing.baseUrl,
        authConfig ? JSON.stringify(authConfig) : existing.authConfig,
        req.params.id,
      ],
    );
    const updated = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, 'Failed to update project');
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  try {
    const existing = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' });
    }
    runSql('DELETE FROM jobs WHERE projectId = ?', [req.params.id]);
    runSql('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to delete project');
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// GET /api/projects/:id/jobs
router.get('/:id/jobs', (req, res) => {
  try {
    const jobs = queryAll('SELECT * FROM jobs WHERE projectId = ? ORDER BY createdAt DESC', [req.params.id]);
    res.json(jobs);
  } catch (err) {
    logger.error({ err }, 'Failed to list jobs');
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

// GET /api/projects/jobs/:jobId — single job + its project context.
// The visual canvas uses this to render the job's real pipeline:
// HTTPClient → tExtractJSONFields → output.
router.get('/jobs/:jobId', (req, res) => {
  try {
    const job = queryOne('SELECT * FROM jobs WHERE id = ?', [req.params.jobId]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const project = queryOne('SELECT id, name, apiName, baseUrl, authConfig FROM projects WHERE id = ?', [job.projectId]);
    res.json({
      ...job,
      config: safeJson(job.config) || {},
      project: project
        ? { ...project, authConfig: safeJson(project.authConfig) || { type: 'none' } }
        : null,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch job');
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// DELETE /api/projects/jobs/:jobId — delete single job by ID
router.delete('/jobs/:jobId', (req, res) => {
  try {
    const job = queryOne('SELECT * FROM jobs WHERE id = ?', [req.params.jobId]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    runSql('DELETE FROM jobs WHERE id = ?', [req.params.jobId]);
    res.json({ success: true, deletedId: Number(req.params.jobId) });
  } catch (err) {
    logger.error({ err }, 'Failed to delete job');
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// DELETE /api/projects/jobs — bulk delete
router.delete('/jobs', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const placeholders = ids.map(() => '?').join(',');
    runSql(`DELETE FROM jobs WHERE id IN (${placeholders})`, ids);
    res.json({ success: true, deletedCount: ids.length });
  } catch (err) {
    logger.error({ err }, 'Failed to bulk delete jobs');
    res.status(500).json({ error: 'Failed to delete jobs' });
  }
});

// POST /api/projects/export — bridge: reconstruct jobs in Java engine then export archive
//
// Body: { projectName, jobIds: [], format?: "tar.gz" | "zip" }
//
// Default format is tar.gz because that's what Talend Studio 8.0.1's
// "Import existing project" wizard accepts. .zip is rejected at the file
// picker step. zip is still available as an opt-in for the legacy
// "Import items" wizard.
router.post('/export', async (req, res) => {
  try {
    const { projectName, jobIds, format } = req.body;
    if (!projectName || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: 'projectName and jobIds[] required' });
    }
    // Default: ZIP. Talend Studio 8.0.1's "Import existing project" wizard
    // accepts a ZIP that contains a folder with an Eclipse `.project` marker
    // file. tar.gz is offered as an opt-in.
    const useTarGz = format && ['tar.gz', 'targz', 'tgz'].includes(String(format).toLowerCase());

    // 1) Load jobs + their parent projects from SQLite
    const placeholders = jobIds.map(() => '?').join(',');
    const jobs = queryAll(`SELECT * FROM jobs WHERE id IN (${placeholders})`, jobIds);
    if (jobs.length === 0) {
      return res.status(404).json({ error: 'No jobs found for the provided IDs' });
    }

    // Group jobs by project so we can share baseUrl/auth per group
    const jobsByProject = {};
    for (const j of jobs) {
      if (!jobsByProject[j.projectId]) jobsByProject[j.projectId] = [];
      jobsByProject[j.projectId].push(j);
    }

    // 2) Regenerate each project's jobs in the Java engine, collecting UUIDs.
    //    Route DB projects → /api/engine/db/generate, API projects → /api/engine/generate.
    const generatedUuids = [];
    const extraFiles = {}; // relativePath → content (for dbt, etc.)

    for (const [projectId, projectJobs] of Object.entries(jobsByProject)) {
      const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) continue;

      const authConfig = safeJson(project.authConfig) || {};
      const isDbProject = authConfig.type === 'database' || !!authConfig.dialect;

      if (isDbProject) {
        // Reconstruct DiscoveredTable objects from saved per-job config
        const selectedTables = projectJobs.map((j) => {
          const cfg = safeJson(j.config) || {};
          return {
            tableName: cfg.table || j.name,
            schema: cfg.schema,
            columns: cfg.columns || [],
            primaryKeys: cfg.primaryKeys || [],
            selected: true,
          };
        });

        // Derive output config (dbt params, etc.) from the first job
        const firstCfg = safeJson(projectJobs[0].config) || {};
        const outputType = firstCfg.outputType || 'log';
        const outputConfig = {
          outputType,
          ...(firstCfg.output || {}),
          ...(outputType === 'dbt' ? {
            dbtProfile: firstCfg.dbtProfile,
            dbtMaterialization: firstCfg.dbtMaterialization,
          } : {}),
        };

        const sourceConfig = {
          dialect: authConfig.dialect || 'postgresql',
          host: project.baseUrl || '',
          database: project.name,
          filePath: project.name, // for SQLite
        };

        const genResp = await axios.post(`${ENGINE_URL}/api/engine/db/generate`, {
          sourceConfig,
          selectedTables,
          outputConfig,
          projectName,
        }, { timeout: 30000 });

        const uuids = (genResp.data?.jobs || []).map((j) => j.id);
        generatedUuids.push(...uuids);

        // Collect dbt files so they end up in the workspace ZIP
        for (const f of (genResp.data?.dbtFiles || [])) {
          if (f?.path && f?.content != null) extraFiles[f.path] = f.content;
        }
      } else {
        // API project — original path
        const baseUrl = project.baseUrl || '';
        const endpoints = projectJobs.map((j) => {
          const cfg = safeJson(j.config) || {};
          return {
            name: j.name,
            path: j.endpoint || cfg.path || '',
            method: 'GET',
            description: cfg.description || '',
            paginationStyle: cfg.paginationStyle || 'none',
            recordsPath: cfg.recordsPath || '$[*]',
            primaryKeys: cfg.primaryKeys || ['id'],
            selected: true,
          };
        });

        const genResp = await axios.post(`${ENGINE_URL}/api/engine/generate`, {
          apiName: project.name,
          baseUrl,
          auth: mapAuthConfig(authConfig),
          endpoints,
          outputType: 'json',
        }, { timeout: 30000 });

        const uuids = (genResp.data?.jobs || []).map((j) => j.id);
        generatedUuids.push(...uuids);
      }
    }

    // Allow dbt-only exports (no Talend jobs but has dbt files)
    if (generatedUuids.length === 0 && Object.keys(extraFiles).length === 0) {
      return res.status(500).json({ error: 'Java engine did not return any jobs or files' });
    }

    // 3) Call Java /export with the fresh UUIDs + any dbt files, stream the archive back
    const dbtFileList = Object.entries(extraFiles).map(([path, content]) => ({ path, content }));
    const exportResp = await axios.post(`${ENGINE_URL}/api/engine/export`, {
      projectName,
      jobIds: generatedUuids,
      extraFiles,          // Map<String,String> form
      dbtFiles: dbtFileList, // List<{path,content}> form — whichever the ExportRequest accepts
      format: useTarGz ? 'tar.gz' : 'zip',
    }, {
      responseType: 'arraybuffer',
      timeout: 60000,
      validateStatus: () => true,
    });

    if (exportResp.status !== 200) {
      // Java returned JSON error as bytes — decode
      const errText = Buffer.from(exportResp.data).toString('utf8');
      return res.status(exportResp.status).type('application/json').send(errText);
    }

    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = useTarGz ? '.tar.gz' : '.zip';
    const contentType = useTarGz ? 'application/gzip' : 'application/zip';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_workspace${ext}"`);
    res.setHeader('Content-Length', exportResp.data.length);

    // Mark jobs as exported
    runSql(`UPDATE jobs SET status = 'exported' WHERE id IN (${placeholders})`, jobIds);

    res.send(Buffer.from(exportResp.data));
  } catch (err) {
    logger.error({ msg: err.message, status: err.response?.status }, 'Export bridge failed');
    res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

function safeJson(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return null; }
}

// (mapAuthConfig moved to ../services/authMapper.js — shared with engine-proxy)

// POST /api/projects/:id/jobs
router.post('/:id/jobs', (req, res) => {
  try {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const { jobs } = req.body;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({ error: 'Jobs array is required' });
    }

    const created = [];
    for (const job of jobs) {
      const result = runSql(
        'INSERT INTO jobs (projectId, name, endpoint, config, status) VALUES (?, ?, ?, ?, ?)',
        [req.params.id, job.name, job.endpoint || null, JSON.stringify(job.config || {}), job.status || 'generated'],
      );
      const newJob = queryOne('SELECT * FROM jobs WHERE id = ?', [result.lastId]);
      if (newJob) created.push(newJob);
    }

    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, 'Failed to save jobs');
    res.status(500).json({ error: 'Failed to save jobs' });
  }
});

module.exports = router;
