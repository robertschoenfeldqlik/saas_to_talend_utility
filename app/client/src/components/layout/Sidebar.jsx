import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Search, Briefcase, Download, Settings, HelpCircle, Sun, Moon } from 'lucide-react';
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

  const offline = engineUp === false;

  return (
    <aside
      className="ed-ui flex flex-col h-full shrink-0"
      style={{ width: 236, background: '#15140f', color: '#e9e6da', padding: '24px 16px' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3" style={{ padding: '4px 6px 26px' }}>
        <div className="grid place-items-center shrink-0" style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--green)' }}>
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2.3" />
            <circle cx="18" cy="18" r="2.3" />
            <path d="M8.3 6H14a4 4 0 0 1 4 4v5.7" />
            <path d="M16 15.7 18 18l2-2.3" />
          </svg>
        </div>
        <div>
          <div className="ed-display text-white" style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.05 }}>SaaS to Talend</div>
          <div className="ed-mono uppercase" style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--green-300)', marginTop: 4 }}>Job Generator</div>
        </div>
      </div>

      {/* Nav groups */}
      {groups.map((g) => (
        <div key={g.label}>
          <div className="ed-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.16em', color: '#6b6757', padding: '14px 10px 8px' }}>{g.label}</div>
          <nav className="flex flex-col" style={{ gap: 3 }}>
            {g.items.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `ed-navitem flex items-center text-sm rounded-[11px] ${isActive ? 'active' : ''}`}
                style={{ gap: 13, padding: '11px 12px', fontWeight: 500 }}
              >
                <Icon style={{ width: 18, height: 18, strokeWidth: 1.8 }} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      ))}

      {/* Footer */}
      <div className="mt-auto">
        <div className="flex items-center gap-3" style={{ padding: 13, borderRadius: 13, background: '#211f17' }}>
          <span
            className={offline ? '' : 'ed-blink'}
            style={{ width: 9, height: 9, borderRadius: '50%', background: offline ? 'var(--coral)' : 'var(--green-300)', boxShadow: offline ? 'none' : '0 0 0 4px rgba(124,194,143,.18)', flexShrink: 0 }}
          />
          <div>
            <div className="text-white" style={{ fontWeight: 600, fontSize: 13 }}>{offline ? 'Engine offline' : 'Engine online'}</div>
            <div className="ed-mono" style={{ fontSize: 10, color: '#7c7868', marginTop: 2 }}>spring-boot · v2.4.1</div>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 mt-2 w-full ed-mono uppercase"
          style={{ fontSize: 10, letterSpacing: '.12em', color: '#6b6757', padding: '8px 10px', background: 'transparent', cursor: 'pointer' }}
        >
          {theme === 'dark' ? <Sun style={{ width: 13, height: 13 }} /> : <Moon style={{ width: 13, height: 13 }} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </aside>
  );
}
