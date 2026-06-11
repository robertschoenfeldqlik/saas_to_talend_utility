import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Briefcase,
  Download,
  Trash2,
  Filter,
  ChevronDown,
  ChevronRight,
  Layers,
  Globe,
  Package,
} from 'lucide-react';
import { getProjects, getProjectJobs, deleteJobs, deleteProject } from '../api/client';

const statusColors = {
  draft: 'bg-gray-400/10 text-gray-500',
  generated: 'bg-blue-500/10 text-blue-600',
  exported: 'bg-brand-500/10 text-brand-600',
};

export default function JobListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedProject, setSelectedProject] = useState(searchParams.get('project') || 'all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set()); // Collapsed project IDs

  // Inline confirmation state — replaces native confirm() which is silently
  // blocked in some browser configurations and Electron environments.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const projectList = await getProjects();
      setProjects(projectList);

      const allJobs = [];
      for (const p of projectList) {
        const pJobs = await getProjectJobs(p.id);
        allJobs.push(...pJobs.map((j) => ({
          ...j,
          projectName: p.name,
          projectApiName: p.apiName,
          projectBaseUrl: p.baseUrl,
        })));
      }
      setJobs(allJobs);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredJobs = useMemo(() => jobs.filter((j) => {
    if (selectedProject !== 'all' && j.projectId !== Number(selectedProject)) return false;
    if (statusFilter !== 'all' && j.status !== statusFilter) return false;
    return true;
  }), [jobs, selectedProject, statusFilter]);

  // Group jobs by SaaS (project) — include empty projects so users can delete them
  const groupedJobs = useMemo(() => {
    const groups = new Map();
    for (const p of projects) {
      // Respect the project filter
      if (selectedProject !== 'all' && p.id !== Number(selectedProject)) continue;
      const projectJobs = filteredJobs.filter((j) => j.projectId === p.id);
      // When filtering by status, hide projects that have no matching jobs
      if (statusFilter !== 'all' && projectJobs.length === 0) continue;
      groups.set(p.id, { project: p, jobs: projectJobs });
    }
    return Array.from(groups.values());
  }, [projects, filteredJobs, selectedProject, statusFilter]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredJobs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredJobs.map((j) => j.id)));
    }
  };

  const toggleGroup = (projectId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleDeleteSingle = (e, jobId, jobName) => {
    e.stopPropagation();
    setActionError(null);
    setPendingDelete({
      type: 'jobs',
      jobIds: [jobId],
      label: `Delete job "${jobName}"?`,
    });
  };

  const requestDeleteProject = (e, projectId, projectName, jobCount) => {
    e.stopPropagation();
    setActionError(null);
    setPendingDelete({
      type: 'project',
      projectId,
      label: jobCount > 0
        ? `Delete SaaS project "${projectName}" and all ${jobCount} of its jobs?`
        : `Delete SaaS project "${projectName}"?`,
    });
  };

  const requestBulkDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setActionError(null);
    setPendingDelete({
      type: 'jobs',
      jobIds: ids,
      label: `Delete ${ids.length} selected job${ids.length > 1 ? 's' : ''}?`,
    });
  };

  const cancelDelete = () => {
    setPendingDelete(null);
    setActionError(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setActionError(null);
    try {
      if (pendingDelete.type === 'project') {
        const projectId = pendingDelete.projectId;
        await deleteProject(projectId);
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
        setJobs((prev) => prev.filter((j) => j.projectId !== projectId));
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of prev) {
            if (jobs.find((j) => j.id === id)?.projectId === projectId) next.delete(id);
          }
          return next;
        });
      } else if (pendingDelete.type === 'jobs') {
        const ids = pendingDelete.jobIds;
        await deleteJobs(ids);
        setJobs((prev) => prev.filter((j) => !ids.includes(j.id)));
        setSelected(new Set());
      }
      setPendingDelete(null);
    } catch (err) {
      setActionError(`Failed to delete: ${err.response?.data?.error || err.message || 'unknown error'}`);
    } finally {
      setDeleting(false);
    }
  };

  // Legacy alias kept so the JSX further down doesn't have to change yet
  const handleDeleteProject = requestDeleteProject;

  const selectGroup = (projectJobs) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = projectJobs.every((j) => next.has(j.id));
      if (allSelected) {
        projectJobs.forEach((j) => next.delete(j.id));
      } else {
        projectJobs.forEach((j) => next.add(j.id));
      }
      return next;
    });
  };

  // Derive SaaS display name from project
  const getSaasName = (project) => {
    if (!project) return 'Unknown';
    if (project.apiName && !project.apiName.startsWith('http')) return project.apiName;
    if (project.baseUrl) {
      try {
        return new URL(project.baseUrl).hostname.replace(/^www\./, '');
      } catch {
        return project.baseUrl;
      }
    }
    return project.name;
  };

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in-up">
      {/* ── Inline delete confirmation modal ─────────────────────────────
            Replaces the native window.confirm() which is silently blocked
            in some browser configurations and Electron, leading users to
            think the delete button doesn't work. ─────────────────────── */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={cancelDelete}
        >
          <div
            className="card p-6 max-w-md w-full mx-4 animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'rgb(var(--color-surface))' }}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold mb-1" style={{ color: 'rgb(var(--color-text))' }}>
                  Confirm deletion
                </h3>
                <p className="text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  {pendingDelete.label}
                </p>
              </div>
            </div>
            {actionError && (
              <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-600">
                {actionError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelDelete}
                disabled={deleting}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="btn-danger text-sm flex items-center gap-2"
              >
                {deleting ? <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-header">Jobs</h1>
          <p className="page-subtitle">Jobs grouped by SaaS source API</p>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <button className="btn-primary flex items-center gap-2 text-sm">
              <Download className="w-4 h-4" />
              Export Selected ({selected.size})
            </button>
            <button
              onClick={requestBulkDelete}
              className="btn-danger flex items-center gap-2 text-sm"
            >
              <Trash2 className="w-4 h-4" />
              Delete ({selected.size})
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="input py-2 w-56"
          >
            <option value="all">All SaaS Sources ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{getSaasName(p)}</option>
            ))}
          </select>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input py-2 w-36"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="generated">Generated</option>
          <option value="exported">Exported</option>
        </select>
        {filteredJobs.length > 0 && (
          <button onClick={toggleAll} className="btn-ghost text-xs">
            {selected.size === filteredJobs.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
        <div className="ml-auto text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
          {filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''} in {groupedJobs.length} SaaS source{groupedJobs.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Grouped Job List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : groupedJobs.length > 0 ? (
        <div className="space-y-4">
          {groupedJobs.map(({ project, jobs: projectJobs }) => {
            const isCollapsed = collapsed.has(project.id);
            const allGroupSelected = projectJobs.length > 0 && projectJobs.every((j) => selected.has(j.id));
            return (
              <section key={project.id} className="card overflow-hidden">
                {/* Group Header */}
                <header
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  style={{ borderBottom: isCollapsed ? 'none' : '1px solid rgb(var(--color-border))' }}
                  onClick={() => toggleGroup(project.id)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleGroup(project.id); }}
                    className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
                    ) : (
                      <ChevronDown className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
                    )}
                  </button>
                  <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-brand-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold truncate" style={{ color: 'rgb(var(--color-text))' }}>
                      {getSaasName(project)}
                    </h3>
                    {project.baseUrl && (
                      <p className="text-xs truncate flex items-center gap-1" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                        <Globe className="w-3 h-3" />
                        {project.baseUrl}
                      </p>
                    )}
                  </div>
                  <span className="badge bg-brand-500/10 text-brand-600">
                    {projectJobs.length} job{projectJobs.length !== 1 ? 's' : ''}
                  </span>
                  {projectJobs.length > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); selectGroup(projectJobs); }}
                      className="btn-ghost text-xs"
                    >
                      {allGroupSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                  <button
                    onClick={(e) => handleDeleteProject(e, project.id, getSaasName(project), projectJobs.length)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                    title="Delete this SaaS project and all its jobs"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </header>

                {/* Group Body */}
                {!isCollapsed && (
                  projectJobs.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                      {projectJobs.map((job) => {
                        const config = typeof job.config === 'string' ? safeJsonParse(job.config) : job.config;
                        const componentCount = config?.components?.length || config?.nodes?.length || 4;
                        return (
                          <div
                            key={job.id}
                            className={`card-interactive p-4 ${selected.has(job.id) ? 'ring-2 ring-brand-500' : ''}`}
                            style={{ background: 'rgb(var(--color-surface-alt))' }}
                            onClick={() => navigate(`/jobs/${job.id}`)}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={selected.has(job.id)}
                                  onChange={(e) => { e.stopPropagation(); toggleSelect(job.id); }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                                />
                                <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                  <Briefcase className="w-3.5 h-3.5 text-blue-500" />
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className={`badge ${statusColors[job.status] || statusColors.draft}`}>
                                  {job.status}
                                </span>
                                <button
                                  onClick={(e) => handleDeleteSingle(e, job.id, job.name)}
                                  className="p-1 rounded hover:bg-red-500/10 transition-colors"
                                  title="Delete job"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                </button>
                              </div>
                            </div>
                            <h4 className="text-sm font-semibold truncate" style={{ color: 'rgb(var(--color-text))' }}>
                              {job.name}
                            </h4>
                            <p className="text-[11px] truncate mb-2 font-mono" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                              {job.endpoint || 'No endpoint'}
                            </p>
                            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                              <Layers className="w-3 h-3" />
                              {componentCount} components
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
                      No jobs in this SaaS source yet
                    </div>
                  )
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card p-16 text-center">
          <Briefcase className="w-12 h-12 mx-auto mb-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'rgb(var(--color-text))' }}>
            No jobs found
          </h3>
          <p className="text-sm mb-6" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Generate jobs by discovering an API, database, or dbt project
          </p>
          <button onClick={() => navigate('/discover')} className="btn-primary">
            Discover Source
          </button>
        </div>
      )}
    </div>
  );
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}
