import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  Briefcase,
  CheckCircle,
  Activity,
  Search,
  ArrowRight,
  Download,
  Clock,
} from 'lucide-react';
import { getProjectStats, getEngineHealth } from '../api/client';

const statCards = [
  { key: 'totalProjects', label: 'Total Projects', icon: FolderOpen, color: 'bg-blue-500' },
  { key: 'totalJobs', label: 'Total Jobs', icon: Briefcase, color: 'bg-brand-500' },
  { key: 'readyJobs', label: 'Jobs Ready', icon: CheckCircle, color: 'bg-emerald-500' },
  { key: 'engineStatus', label: 'Engine Status', icon: Activity, color: 'bg-purple-500' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalJobs: 0,
    readyJobs: 0,
    recentProjects: [],
    jobsByStatus: [],
  });
  const [engineUp, setEngineUp] = useState(false);

  useEffect(() => {
    const loadStats = () => {
      getProjectStats()
        .then((data) => {
          const ready = data.jobsByStatus?.find((s) => s.status === 'exported')?.count || 0;
          setStats({ ...data, readyJobs: ready });
        })
        .catch(() => {});

      getEngineHealth()
        .then(() => setEngineUp(true))
        .catch(() => setEngineUp(false));
    };

    loadStats();

    // Refetch when window regains focus (user coming back from another page/tab)
    const onFocus = () => loadStats();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const getStatValue = (key) => {
    if (key === 'engineStatus') return engineUp ? 'Online' : 'Offline';
    return stats[key] ?? 0;
  };

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="page-header">Dashboard</h1>
        <p className="page-subtitle">
          Generate Talend integration jobs from SaaS API specifications
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                {label}
              </span>
              <div className={`w-9 h-9 rounded-xl ${color} flex items-center justify-center`}>
                <Icon className="w-4.5 h-4.5 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold" style={{ color: 'rgb(var(--color-text))' }}>
              {getStatValue(key)}
            </div>
            {key === 'engineStatus' && (
              <div className={`mt-1 text-xs font-medium ${engineUp ? 'text-brand-500' : 'text-red-500'}`}>
                {engineUp ? 'Spring Boot engine running' : 'Engine not detected'}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => navigate('/discover')}
            className="card-interactive p-5 flex items-center gap-4 text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
              <Search className="w-5 h-5 text-brand-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
                Discover New Source
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                API, database, or dbt project → Talend jobs
              </div>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'rgb(var(--color-text-muted))' }} />
          </button>

          <button
            onClick={() => navigate('/jobs')}
            className="card-interactive p-5 flex items-center gap-4 text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
                View All Jobs
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                Manage and edit generated Talend jobs
              </div>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'rgb(var(--color-text-muted))' }} />
          </button>

          <button
            onClick={() => navigate('/export')}
            className="card-interactive p-5 flex items-center gap-4 text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5 text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
                Export Workspace
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                Download jobs as a Talend workspace ZIP
              </div>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'rgb(var(--color-text-muted))' }} />
          </button>
        </div>
      </div>

      {/* Recent Projects */}
      <div>
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
          Recent Projects
        </h2>
        {stats.recentProjects?.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {stats.recentProjects.map((project) => (
              <div
                key={project.id}
                className="card-interactive p-5 cursor-pointer"
                onClick={() => navigate(`/jobs?project=${project.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center">
                    <FolderOpen className="w-5 h-5 text-brand-500" />
                  </div>
                  <span className="badge bg-brand-500/10 text-brand-600">
                    {project.jobCount} jobs
                  </span>
                </div>
                <h3 className="text-sm font-semibold mb-1" style={{ color: 'rgb(var(--color-text))' }}>
                  {project.name}
                </h3>
                <p className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  {project.apiName || project.baseUrl || 'No API configured'}
                </p>
                <div className="flex items-center gap-1.5 mt-3 text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  <Clock className="w-3 h-3" />
                  {new Date(project.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-12 text-center">
            <FolderOpen className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgb(var(--color-text-muted))' }} />
            <p className="text-sm font-medium mb-1" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              No projects yet
            </p>
            <p className="text-xs mb-4" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Start by discovering an API, database, or dbt project to generate Talend jobs
            </p>
            <button onClick={() => navigate('/discover')} className="btn-primary text-sm">
              Discover Source
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
