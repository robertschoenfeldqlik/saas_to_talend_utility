import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';

const methodColors = {
  GET: 'bg-brand-500/10 text-brand-600',
  POST: 'bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-secondary))]',
  PUT: 'bg-amber-500/10 text-amber-600',
  DELETE: 'bg-red-500/10 text-red-600',
  PATCH: 'bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-secondary))]',
};

// First non-parameter path segment, used to group endpoints by resource.
function resourceOf(path) {
  const segs = String(path || '').replace(/^\/+/, '').split('/');
  for (const s of segs) {
    if (!s) continue;
    if (/^[{(:<]/.test(s) || /[})>]$/.test(s)) continue; // skip {id} / (id) / :id
    return s;
  }
  return segs[0] || 'other';
}

export default function EndpointList({ endpoints, selected, onToggle }) {
  const [expanded, setExpanded] = useState(new Set());
  const [query, setQuery] = useState('');

  const toggleExpand = (idx) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });

  const indexed = useMemo(() => endpoints.map((ep, idx) => ({ ep, idx })), [endpoints]);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? indexed.filter(({ ep }) => `${ep.name} ${ep.path} ${ep.description || ''}`.toLowerCase().includes(q))
    : indexed;

  // Group by resource (alphabetical) so large APIs stay navigable.
  const groups = useMemo(() => {
    const m = new Map();
    for (const item of filtered) {
      const r = resourceOf(item.ep.path);
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(item);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const groupAllSelected = (items) => items.length > 0 && items.every(({ idx }) => selected.has(idx));
  const toggleGroup = (items) => {
    const allOn = groupAllSelected(items);
    items.forEach(({ idx }) => {
      // Only flip the ones that need changing (onToggle is a toggle).
      if (allOn ? selected.has(idx) : !selected.has(idx)) onToggle(idx);
    });
  };

  if (endpoints.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>
          No endpoints discovered. Try a different specification.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {endpoints.length > 8 && (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgb(var(--color-text-muted))' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${endpoints.length} endpoints by name or path…`}
            className="input pl-9 w-full text-sm"
          />
        </div>
      )}
      {q && (
        <div className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
          {filtered.length} of {endpoints.length} match
        </div>
      )}

      {groups.map(([resource, items]) => (
        <div key={resource} className="space-y-1.5">
          {groups.length > 1 && (
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                {resource} <span className="font-normal opacity-60">({items.length})</span>
              </span>
              <button onClick={() => toggleGroup(items)} className="btn-ghost text-[11px]">
                {groupAllSelected(items) ? 'Deselect group' : 'Select group'}
              </button>
            </div>
          )}
          {items.map(({ ep, idx }) => {
            const pg = ep.paginationStyle || ep.pagination;
            const rp = ep.recordsPath || ep.records_path;
            const pks = ep.primaryKeys || ep.primary_keys || [];
            return (
              <div
                key={idx}
                className="rounded-xl border transition-all"
                style={{
                  background: selected.has(idx) ? 'rgb(var(--color-surface-alt))' : 'rgb(var(--color-surface))',
                  borderColor: selected.has(idx) ? 'rgb(var(--brand-500) / 0.3)' : 'rgb(var(--color-border))',
                }}
              >
                <div className="flex items-center gap-3 p-3.5">
                  <input
                    type="checkbox"
                    checked={selected.has(idx)}
                    onChange={() => onToggle(idx)}
                    className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 shrink-0"
                  />
                  <button onClick={() => toggleExpand(idx)} className="p-0.5 rounded hover:bg-gray-200/50 transition-colors shrink-0">
                    {expanded.has(idx)
                      ? <ChevronDown className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
                      : <ChevronRight className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />}
                  </button>
                  <span className={`badge text-[10px] ${methodColors[ep.method] || methodColors.GET}`}>{ep.method || 'GET'}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>{ep.name}</span>
                    <span className="text-xs ml-2 font-mono break-all" style={{ color: 'rgb(var(--color-text-secondary))' }}>{ep.path}</span>
                  </div>
                  {pg && pg !== 'none' && (
                    <span className="badge bg-[rgb(var(--color-surface-alt))] text-[rgb(var(--color-text-secondary))] text-[10px] shrink-0">{pg}</span>
                  )}
                </div>

                {expanded.has(idx) && (
                  <div className="px-12 pb-3.5 pt-0 text-xs space-y-1.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    {rp && (
                      <div>
                        <span className="font-medium">Records path:</span>{' '}
                        <code className="px-1.5 py-0.5 rounded font-mono text-[11px]" style={{ background: 'rgb(var(--color-surface-hover))' }}>{rp}</code>
                      </div>
                    )}
                    {pks.length > 0 && (
                      <div><span className="font-medium">Primary keys:</span> {pks.join(', ')}</div>
                    )}
                    {pg && <div><span className="font-medium">Pagination:</span> {pg}</div>}
                    {ep.description && <div>{ep.description}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
