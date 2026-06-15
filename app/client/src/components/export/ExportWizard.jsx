import { useState, useEffect } from 'react';
import {
  Download,
  Package,
  CheckSquare,
  Square,
  Loader2,
  FileCode,
  CheckCircle,
} from 'lucide-react';
import { getProjects, getProjectJobs, exportProjectJobs } from '../../api/client';
import XmlPreview from './XmlPreview';

export default function ExportWizard() {
  const [projects, setProjects] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [selectedJobs, setSelectedJobs] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoadError(null);
    try {
      const projectList = await getProjects();
      setProjects(projectList);

      const allJobs = [];
      for (const p of projectList) {
        const pJobs = await getProjectJobs(p.id);
        allJobs.push(...pJobs.map((j) => ({ ...j, projectName: p.name })));
      }
      setJobs(allJobs);
      if (projectList.length > 0) {
        setProjectName(projectList[0].name || 'TalendWorkspace');
      }
    } catch (err) {
      // No demo/placeholder fallback — surface the real failure and show an
      // empty list so the user knows there are genuinely no jobs to export.
      console.error('Failed to load projects/jobs for export:', err);
      setJobs([]);
      setLoadError(err.response?.data?.error || err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  const toggleJob = (id) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedJobs.size === jobs.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(jobs.map((j) => j.id)));
    }
  };

  const [exportError, setExportError] = useState(null);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const jobIds = Array.from(selectedJobs);
      // ZIP is the format Talend Studio's "Import existing project" wizard
      // accepts when the archive contains an Eclipse .project marker inside.
      const blob = await exportProjectJobs({ projectName, jobIds, format: 'zip' });

      if (!(blob instanceof Blob) || blob.size < 100) {
        throw new Error('Server returned an empty or invalid archive');
      }

      // Trigger download with the correct extension
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.replace(/\s+/g, '_')}_workspace.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExported(true);
    } catch (err) {
      // If the server returned a JSON error body wrapped in a Blob, read it
      let msg = err.message;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          msg = parsed.error || text;
        } catch {}
      } else if (err.response?.data?.error) {
        msg = err.response.data.error;
      }
      setExportError(`Export failed: ${msg}`);
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Project Name */}
      <div className="card p-6">
        <h3 className="text-base font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
          Workspace Configuration
        </h3>
        <div>
          <label className="input-label">Project Name</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="MyTalendProject"
            className="input max-w-md"
          />
        </div>
        <div className="mt-4">
          <label className="input-label">Format</label>
          <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgb(var(--color-surface-alt))' }}>
            <Package className="w-5 h-5 text-brand-500" />
            <div>
              <div className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>
                Talend Workspace ZIP
              </div>
              <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                For Talend Studio 8.0.1: File → Import existing project → Select archive
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Job Selection */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
            Select Jobs ({selectedJobs.size} of {jobs.length})
          </h3>
          <button onClick={toggleAll} className="btn-ghost text-xs">
            {selectedJobs.size === jobs.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {loadError && (
          <div className="mb-3 p-3 rounded-lg text-xs"
               style={{ background: 'rgb(254 226 226)', color: 'rgb(127 29 29)' }}>
            Couldn&apos;t load jobs: {loadError}
          </div>
        )}
        {jobs.length === 0 && !loadError && (
          <div className="p-4 rounded-lg text-sm text-center"
               style={{ background: 'rgb(var(--color-surface-alt))', color: 'rgb(var(--color-text-secondary))' }}>
            No jobs yet. Generate some from the Discover page first.
          </div>
        )}

        <div className="space-y-2">
          {jobs.map((job) => (
            <label
              key={job.id}
              className={`flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all border ${
                selectedJobs.has(job.id)
                  ? 'border-brand-500/30 bg-brand-500/5'
                  : 'border-transparent'
              }`}
              style={!selectedJobs.has(job.id) ? { background: 'rgb(var(--color-surface-alt))' } : undefined}
            >
              <input
                type="checkbox"
                checked={selectedJobs.has(job.id)}
                onChange={() => toggleJob(job.id)}
                className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>
                  {job.name}
                </div>
                <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  {job.endpoint || 'No endpoint'} &middot; {job.projectName}
                </div>
              </div>
              <span className={`badge text-[10px] ${
                job.status === 'exported'
                  ? 'bg-brand-500/10 text-brand-600'
                  : job.status === 'generated'
                    ? 'bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-secondary))]'
                    : 'bg-gray-400/10 text-gray-500'
              }`}>
                {job.status}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Preview */}
      {selectedJobs.size > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
              Export Preview
            </h3>
            <button
              onClick={() => setShowPreview((p) => !p)}
              className="btn-ghost text-xs flex items-center gap-1.5"
            >
              <FileCode className="w-3.5 h-3.5" />
              {showPreview ? 'Hide XML' : 'Show XML Preview'}
            </button>
          </div>

          <div className="space-y-1.5 text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            <div>Workspace: <span className="font-medium" style={{ color: 'rgb(var(--color-text))' }}>{projectName}/</span></div>
            {jobs.filter((j) => selectedJobs.has(j.id)).map((j) => (
              <div key={j.id} className="pl-4">
                process/{j.name}/{j.name}.item
              </div>
            ))}
            <div className="pl-4">talend.project</div>
          </div>

          {showPreview && (
            <div className="mt-4">
              <XmlPreview
                projectName={projectName}
                jobName={jobs.find((j) => selectedJobs.has(j.id))?.name || 'Job'}
              />
            </div>
          )}
        </div>
      )}

      {exportError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600">
          {exportError}
        </div>
      )}

      {/* Export button */}
      <div className="flex items-center justify-between">
        {exported ? (
          <div className="flex items-center gap-2 text-brand-500">
            <CheckCircle className="w-5 h-5" />
            <span className="text-sm font-medium">Workspace exported successfully</span>
          </div>
        ) : (
          <div />
        )}
        <button
          onClick={handleExport}
          disabled={selectedJobs.size === 0 || !projectName || exporting}
          className="btn-primary flex items-center gap-2"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {exporting ? 'Exporting...' : 'Export & Download'}
        </button>
      </div>
    </div>
  );
}
