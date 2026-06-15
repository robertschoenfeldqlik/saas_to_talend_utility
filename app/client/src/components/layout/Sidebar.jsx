import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Search,
  Briefcase,
  Download,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { getEngineHealth } from '../../api/client';

const groups = [
  {
    label: 'Workspace',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/discover', icon: Search, label: 'Discover' },
      { to: '/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/export', icon: Download, label: 'Export' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings' },
      { to: '/help', icon: HelpCircle, label: 'Help' },
    ],
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [engineUp, setEngineUp] = useState(null);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      getEngineHealth()
        .then(() => alive && setEngineUp(true))
        .catch(() => alive && setEngineUp(false));
    ping();
    const id = setInterval(ping, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <aside
      className={`ed-ui flex flex-col h-full shrink-0 transition-all duration-300 ${collapsed ? 'w-[68px]' : 'w-[236px]'}`}
      style={{ background: 'var(--ink)', color: '#e9e6da' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-[72px]" style={{ borderBottom: '1px solid #2c2a20' }}>
        <div
          className="flex items-center justify-center shrink-0"
          style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--green)' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="6" r="2.3" />
            <circle cx="19" cy="18" r="2.3" />
            <path d="M5 8.3v3.7a3 3 0 0 0 3 3h8.7" />
          </svg>
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="ed-display text-[15px] text-white tracking-tight whitespace-nowrap" style={{ fontWeight: 700 }}>
              SaaS to Talend
            </div>
            <div className="ed-mono text-[9px] uppercase whitespace-nowrap" style={{ color: 'var(--green-300)', letterSpacing: '.18em' }}>
              Job Generator
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2.5 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.label} className="mb-5">
            {!collapsed && (
              <div className="ed-mono px-2.5 mb-2 text-[10px] uppercase" style={{ color: 'var(--ink-3)', letterSpacing: '.16em' }}>
                {g.label}
              </div>
            )}
            <div className="space-y-0.5">
              {g.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  title={label}
                  className={({ isActive }) =>
                    `ed-navitem flex items-center gap-3 px-2.5 py-2.5 text-sm font-medium rounded-[11px] ${isActive ? 'active' : ''} ${collapsed ? 'justify-center' : ''}`
                  }
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" />
                  {!collapsed && <span className="whitespace-nowrap">{label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-2.5 pb-3 space-y-1.5">
        {/* Engine chip */}
        {!collapsed ? (
          <div className="px-3 py-2.5 rounded-[13px]" style={{ background: '#211f17' }}>
            <div className="flex items-center gap-2">
              <span
                className={engineUp ? 'ed-blink' : ''}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: engineUp === false ? 'var(--coral)' : 'var(--green-300)',
                  boxShadow: engineUp === false ? 'none' : '0 0 0 3px rgba(124,194,143,.18)',
                  display: 'inline-block',
                }}
              />
              <span className="text-[13px] font-medium" style={{ color: '#e9e6da' }}>
                {engineUp === false ? 'Engine offline' : 'Engine online'}
              </span>
            </div>
            <div className="ed-mono text-[10px] mt-1" style={{ color: 'var(--ink-3)', letterSpacing: '.04em' }}>
              spring-boot · v2.4.1
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-2">
            <span
              className={engineUp ? 'ed-blink' : ''}
              style={{ width: 9, height: 9, borderRadius: '50%', background: engineUp === false ? 'var(--coral)' : 'var(--green-300)' }}
            />
          </div>
        )}

        {/* Theme toggle */}
        <button onClick={toggleTheme} className={`ed-footbtn flex items-center gap-3 w-full px-2.5 py-2.5 rounded-[11px] text-sm ${collapsed ? 'justify-center' : ''}`}>
          {theme === 'dark' ? <Sun className="w-[18px] h-[18px] shrink-0" /> : <Moon className="w-[18px] h-[18px] shrink-0" />}
          {!collapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>

        {/* Collapse */}
        <button onClick={() => setCollapsed((c) => !c)} className={`ed-footbtn flex items-center gap-3 w-full px-2.5 py-2.5 rounded-[11px] text-sm ${collapsed ? 'justify-center' : ''}`}>
          {collapsed ? <ChevronRight className="w-[18px] h-[18px] shrink-0" /> : <ChevronLeft className="w-[18px] h-[18px] shrink-0" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
