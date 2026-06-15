import { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';

const LAYER_STYLES = {
  staging: 'bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-secondary))]',
  intermediate: 'bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-secondary))]',
  marts: 'bg-brand-500/10 text-brand-600',
  other: 'bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-muted))]',
};

export default function DbtModelList({ models = [], selectedNames, onToggle, onToggleAll }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.path || '').toLowerCase().includes(q) ||
        (m.layer || '').toLowerCase().includes(q),
    );
  }, [models, query]);

  const toggleExpand = (name) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allSelected = models.length > 0 && selectedNames.size === models.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'rgb(var(--color-text-muted))' }}
          />
          <input
            type="text"
            className="input pl-9"
            placeholder="Search models by name, path, or layer..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button onClick={onToggleAll} className="btn-secondary whitespace-nowrap">
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <div
            className="p-8 text-center rounded-xl text-sm"
            style={{ background: 'rgb(var(--color-surface-alt))', color: 'rgb(var(--color-text-muted))' }}
          >
            No models match.
          </div>
        )}
        {filtered.map((m) => {
          const checked = selectedNames.has(m.name);
          const isOpen = expanded.has(m.name);
          const layerClass = LAYER_STYLES[m.layer] || LAYER_STYLES.other;
          return (
            <div
              key={m.name}
              className="rounded-xl border transition-all"
              style={{ borderColor: 'rgb(var(--color-border))', background: 'rgb(var(--color-surface))' }}
            >
              <div className="flex items-start gap-3 p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  onChange={() => onToggle(m.name)}
                />
                <button
                  onClick={() => toggleExpand(m.name)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: 'rgb(var(--color-text))' }}>
                      {m.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-md ${layerClass}`}>{m.layer}</span>
                    {m.materialization && m.materialization !== 'view' && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600">
                        {m.materialization}
                      </span>
                    )}
                    <span
                      className="text-xs font-mono truncate"
                      style={{ color: 'rgb(var(--color-text-muted))' }}
                    >
                      {m.path}
                    </span>
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 ml-auto" style={{ color: 'rgb(var(--color-text-muted))' }} />
                    ) : (
                      <ChevronRight className="w-4 h-4 ml-auto" style={{ color: 'rgb(var(--color-text-muted))' }} />
                    )}
                  </div>
                  {(m.sources?.length > 0 || m.refs?.length > 0) && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      {m.sources?.map((s) => (
                        <span
                          key={`src-${s}`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-secondary))] font-mono"
                        >
                          src:{s}
                        </span>
                      ))}
                      {m.refs?.map((r) => (
                        <span
                          key={`ref-${r}`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-600 font-mono"
                        >
                          ref:{r}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </div>
              {isOpen && (
                <div className="px-3 pb-3">
                  <pre
                    className="text-xs font-mono p-3 rounded-lg overflow-x-auto whitespace-pre-wrap"
                    style={{
                      background: 'rgb(var(--color-surface-alt))',
                      color: 'rgb(var(--color-text))',
                      maxHeight: '320px',
                      overflowY: 'auto',
                    }}
                  >
                    {m.sql}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
