import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Download, Briefcase, ArrowRight, TrendingUp } from 'lucide-react';
import { getProjectStats, getEngineHealth } from '../api/client';

const TILE_COLORS = ['#13853f', '#2563eb', '#7c3aed', '#e0623a', '#0891b2', '#b45309'];
function tileColor(s) {
  let h = 0;
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}
function initials(s) {
  const w = String(s || '?').trim().split(/\s+/);
  return (((w[0]?.[0] || '') + (w[1]?.[0] || w[0]?.[1] || '')).toUpperCase()) || '?';
}
function timeAgo(d) {
  if (!d) return '—';
  const t = new Date(d).getTime();
  if (isNaN(t)) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

const PAD = '0 44px';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ totalProjects: 0, totalJobs: 0, readyJobs: 0, recentProjects: [], jobsByStatus: [] });
  const [engineUp, setEngineUp] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const load = () => {
      getProjectStats()
        .then((data) => {
          const ready = data.jobsByStatus?.find((s) => s.status === 'exported')?.count || 0;
          setStats({ ...data, readyJobs: ready });
        })
        .catch(() => {});
      getEngineHealth().then(() => setEngineUp(true)).catch(() => setEngineUp(false));
    };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const { totalProjects, totalJobs, readyJobs, recentProjects = [] } = stats;
  const readyPct = totalJobs > 0 ? Math.round((readyJobs / totalJobs) * 100) : 0;
  const q = query.trim().toLowerCase();
  const projects = q
    ? recentProjects.filter((p) => `${p.name} ${p.apiName || ''} ${p.baseUrl || ''}`.toLowerCase().includes(q))
    : recentProjects;

  const rule = { borderBottom: '1.5px solid var(--ink)' };
  const kicker = { fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '.22em', color: 'var(--green)' };

  return (
    <div className="ed-root min-h-full" style={{ color: 'var(--ink)' }}>
      {/* ── Topbar ── */}
      <div className="flex items-center justify-between gap-4 ed-rise" style={{ padding: '22px 44px', ...rule }}>
        <div className="ed-mono text-[12px] uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '.14em' }}>
          Workspace · Dashboard
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden sm:block">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects…"
              className="ed-ui text-sm pl-9 pr-4 py-2.5 w-56"
              style={{ border: '1.5px solid var(--ink)', borderRadius: 30, background: 'var(--card-ed)', color: 'var(--ink)', outline: 'none' }}
            />
          </div>
          <button onClick={() => navigate('/discover')} className="ed-btn ed-btn-primary">
            <Search className="w-4 h-4" /> New source
          </button>
        </div>
      </div>

      {/* ── Hero ── */}
      <div className="relative overflow-hidden ed-rise" style={{ padding: '46px 44px 42px', ...rule }}>
        <div className="flex items-center gap-3 mb-5">
          <span style={{ display: 'inline-block', width: 46, height: 2, background: 'var(--green)' }} />
          <span className="text-[12px]" style={kicker}>THE PIPELINE</span>
        </div>
        <h1 className="ed-display" style={{ fontWeight: 800, fontSize: 'clamp(44px, 7vw, 76px)', lineHeight: 0.92, letterSpacing: '-0.03em', maxWidth: 620 }}>
          Discover.<br />Generate.<br /><span style={{ color: 'var(--green)' }}>Export.</span>
        </h1>
        <p className="ed-ui mt-5 text-[17px]" style={{ color: 'var(--ink-2)', maxWidth: 520, lineHeight: 1.5 }}>
          Turn any SaaS API, database, or dbt project into ready-to-import Talend Studio jobs — deterministically, with no hallucinated endpoints.
        </p>
        <div className="flex flex-wrap gap-3 mt-7">
          <button onClick={() => navigate('/discover')} className="ed-btn ed-btn-primary"><Search className="w-4 h-4" /> Discover a source</button>
          <button onClick={() => navigate('/export')} className="ed-btn"><Download className="w-4 h-4" /> Export workspace</button>
        </div>

        {/* Floating engine card */}
        <div
          className="hidden lg:block absolute"
          style={{ top: 44, right: 44, width: 286, background: 'var(--ink)', color: 'var(--paper)', borderRadius: 18, padding: 22, boxShadow: '0 30px 60px -24px rgba(20,20,12,.5)' }}
        >
          <div className="flex items-center justify-between ed-mono text-[11px]" style={{ color: 'var(--ink-3)', letterSpacing: '.12em' }}>
            <span>ENGINE</span><span>v2.4.1</span>
          </div>
          <div className="ed-display flex items-center gap-2.5 mt-3" style={{ fontWeight: 700, fontSize: 30, color: engineUp ? 'var(--green-300)' : 'var(--coral)' }}>
            <span className={engineUp ? 'ed-blink' : ''} style={{ width: 13, height: 13, borderRadius: '50%', background: engineUp ? 'var(--green-300)' : 'var(--coral)', boxShadow: engineUp ? '0 0 0 4px rgba(124,194,143,.16)' : 'none' }} />
            {engineUp ? 'Online' : 'Offline'}
          </div>
          <div style={{ borderTop: '1px solid #2c2a20', margin: '18px 0 0' }} />
          {[['Projects', totalProjects], ['Jobs generated', totalJobs], ['Jobs ready', readyJobs]].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid #2c2a20' }}>
              <span className="ed-ui text-[13px]" style={{ color: 'var(--ink-3)' }}>{k}</span>
              <span className="ed-display text-[15px]" style={{ fontWeight: 700, color: 'var(--paper)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stat band ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 ed-rise" style={rule}>
        {[
          { label: 'Total Projects', value: totalProjects, sub: 'across all sources', delta: false },
          { label: 'Total Jobs', value: totalJobs, sub: 'generated to date', delta: false },
          { label: 'Jobs Ready', value: readyJobs, sub: `${readyPct}% of total`, delta: true },
          { label: 'Engine Status', engine: true },
        ].map((f, i) => (
          <div key={f.label} style={{ padding: '30px 44px', borderRight: i < 3 ? '1px solid var(--line-2)' : 'none' }}>
            <div className="ed-mono text-[11px] uppercase mb-3" style={{ color: 'var(--ink-3)', letterSpacing: '.12em' }}>{f.label}</div>
            {f.engine ? (
              <div className="ed-display flex items-center gap-2.5" style={{ fontWeight: 700, fontSize: 46, letterSpacing: '-0.02em', color: engineUp ? 'var(--green)' : 'var(--coral)' }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: engineUp ? 'var(--green)' : 'var(--coral)', boxShadow: engineUp ? '0 0 0 4px var(--green-pale)' : 'none' }} />
                {engineUp ? 'Online' : 'Offline'}
              </div>
            ) : (
              <div className="ed-display" style={{ fontWeight: 700, fontSize: 62, lineHeight: 1, letterSpacing: '-0.03em' }}>{f.value}</div>
            )}
            <div className="ed-mono text-[11px] mt-2 flex items-center gap-1" style={{ color: f.delta ? 'var(--green-700)' : 'var(--ink-3)' }}>
              {f.delta && <TrendingUp className="w-3 h-3" />}
              {f.engine ? (engineUp ? 'spring-boot running' : 'engine not detected') : f.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── Quick actions ── */}
      <div style={{ padding: '34px 44px' }}>
        <h2 className="ed-display mb-5" style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            { n: '01', title: 'Discover source', desc: 'API, database, or dbt → Talend jobs', icon: Search, to: '/discover' },
            { n: '02', title: 'View all jobs', desc: 'Manage and edit generated jobs', icon: Briefcase, to: '/jobs' },
            { n: '03', title: 'Export workspace', desc: 'Download a Talend workspace ZIP', icon: Download, to: '/export' },
          ].map(({ n, title, desc, icon: Icon, to }) => (
            <button
              key={n}
              onClick={() => navigate(to)}
              className="ed-qcard text-left"
              style={{ background: 'var(--card-ed)', border: '1.5px solid var(--ink)', borderRadius: 18, padding: 24 }}
            >
              <div className="ed-qnum ed-mono text-[12px] mb-4" style={{ color: 'var(--green)', letterSpacing: '.1em' }}>{n}</div>
              <div className="ed-qi flex items-center justify-center mb-4" style={{ width: 48, height: 48, borderRadius: 13, background: 'var(--green-pale)', transition: 'background .16s ease' }}>
                <Icon className="w-5 h-5" style={{ color: 'var(--green-700)' }} />
              </div>
              <div className="ed-display flex items-center justify-between" style={{ fontWeight: 700, fontSize: 21 }}>
                {title}
                <ArrowRight className="ed-ar w-5 h-5" />
              </div>
              <div className="ed-qx ed-ui text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Recent projects ── */}
      <div style={{ padding: '34px 44px 48px' }}>
        <div className="flex items-end justify-between mb-5">
          <h2 className="ed-display" style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Recent projects</h2>
          {recentProjects.length > 0 && (
            <button onClick={() => navigate('/jobs')} className="ed-mono text-[12px] inline-flex items-center gap-1.5" style={{ color: 'var(--ink-2)', borderBottom: '1.5px solid var(--ink)', paddingBottom: 3 }}>
              View all <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {recentProjects.length === 0 ? (
          <div className="text-center" style={{ border: '1.5px dashed var(--line-2)', borderRadius: 18, padding: '56px 24px' }}>
            <div className="ed-display" style={{ fontWeight: 700, fontSize: 22 }}>Discover your first source</div>
            <p className="ed-ui mt-1.5 text-[14px]" style={{ color: 'var(--ink-2)' }}>Point the tool at an API spec, OData $metadata, or docs page to generate Talend jobs.</p>
            <button onClick={() => navigate('/discover')} className="ed-btn ed-btn-primary mt-5"><Search className="w-4 h-4" /> Discover a source</button>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="ed-mono text-[11px] uppercase items-center hidden md:grid" style={{ gridTemplateColumns: '2.5fr 1fr .8fr 1fr .7fr', gap: 18, color: 'var(--ink-3)', letterSpacing: '.1em', padding: '0 6px 12px', borderBottom: '2px solid var(--ink)' }}>
              <span>Source</span><span>Type</span><span>Jobs</span><span>Status</span><span>Updated</span>
            </div>
            {projects.map((p) => {
              const ready = (p.jobCount || 0) > 0;
              return (
                <div
                  key={p.id}
                  onClick={() => navigate(`/jobs?project=${p.id}`)}
                  className="ed-row grid items-center cursor-pointer"
                  style={{ gridTemplateColumns: '2.5fr 1fr .8fr 1fr .7fr', gap: 18, padding: '18px 6px', borderBottom: '1px solid var(--line-2)' }}
                >
                  {/* Source */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="ed-display flex items-center justify-center shrink-0 text-white" style={{ width: 40, height: 40, borderRadius: 11, background: tileColor(p.name), fontWeight: 700, fontSize: 14 }}>
                      {initials(p.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="ed-display truncate" style={{ fontWeight: 600, fontSize: 16 }}>{p.name}</div>
                      <div className="ed-mono text-[11px] truncate" style={{ color: 'var(--ink-3)' }}>{p.apiName || p.baseUrl || 'no url'}</div>
                    </div>
                  </div>
                  {/* Type */}
                  <div>
                    <span className="ed-ui inline-block text-[12px]" style={{ border: '1.5px solid var(--ink)', borderRadius: 30, padding: '3px 12px' }}>REST API</span>
                  </div>
                  {/* Jobs */}
                  <div className="flex items-baseline gap-1.5">
                    <span className="ed-display" style={{ fontWeight: 700, fontSize: 20 }}>{p.jobCount || 0}</span>
                    <span className="ed-mono text-[11px]" style={{ color: 'var(--ink-3)' }}>jobs</span>
                  </div>
                  {/* Status */}
                  <div>
                    <span className="ed-ui inline-flex items-center gap-1.5 text-[12px]" style={{ border: `1.5px solid ${ready ? 'var(--green)' : 'var(--line-2)'}`, color: ready ? 'var(--green-700)' : 'var(--ink-3)', borderRadius: 30, padding: '3px 12px' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ready ? 'var(--green)' : 'var(--ink-3)', display: 'inline-block' }} />
                      {ready ? 'ready' : 'draft'}
                    </span>
                  </div>
                  {/* Updated */}
                  <div className="ed-mono text-[11px]" style={{ color: 'var(--ink-3)' }}>{timeAgo(p.updatedAt)}</div>
                </div>
              );
            })}
            {projects.length === 0 && (
              <div className="ed-ui text-center py-8 text-[14px]" style={{ color: 'var(--ink-3)' }}>No projects match “{query}”.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
