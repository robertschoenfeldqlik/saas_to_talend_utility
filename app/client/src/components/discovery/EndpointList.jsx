import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const methodColors = {
  GET: 'bg-blue-500/10 text-blue-600',
  POST: 'bg-green-500/10 text-green-600',
  PUT: 'bg-amber-500/10 text-amber-600',
  DELETE: 'bg-red-500/10 text-red-600',
  PATCH: 'bg-purple-500/10 text-purple-600',
};

export default function EndpointList({ endpoints, selected, onToggle }) {
  const [expanded, setExpanded] = useState(new Set());

  const toggleExpand = (index) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {endpoints.map((ep, i) => (
        <div
          key={i}
          className="rounded-xl border transition-all"
          style={{
            background: selected.has(i) ? 'rgb(var(--color-surface-alt))' : 'rgb(var(--color-surface))',
            borderColor: selected.has(i) ? 'rgb(var(--brand-500) / 0.3)' : 'rgb(var(--color-border))',
          }}
        >
          <div className="flex items-center gap-3 p-3.5">
            <input
              type="checkbox"
              checked={selected.has(i)}
              onChange={() => onToggle(i)}
              className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 shrink-0"
            />
            <button
              onClick={() => toggleExpand(i)}
              className="p-0.5 rounded hover:bg-gray-200/50 transition-colors shrink-0"
            >
              {expanded.has(i) ? (
                <ChevronDown className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
              ) : (
                <ChevronRight className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
              )}
            </button>
            <span className={`badge text-[10px] ${methodColors[ep.method] || methodColors.GET}`}>
              {ep.method || 'GET'}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>
                {ep.name}
              </span>
              <span className="text-xs ml-2 font-mono" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                {ep.path}
              </span>
            </div>
            {ep.pagination && ep.pagination !== 'none' && (
              <span className="badge bg-purple-500/10 text-purple-600 text-[10px]">
                {ep.pagination}
              </span>
            )}
          </div>

          {expanded.has(i) && (
            <div
              className="px-12 pb-3.5 pt-0 text-xs space-y-1.5"
              style={{ color: 'rgb(var(--color-text-secondary))' }}
            >
              {ep.records_path && (
                <div>
                  <span className="font-medium">Records Path:</span>{' '}
                  <code className="px-1.5 py-0.5 rounded font-mono text-[11px]" style={{ background: 'rgb(var(--color-surface-hover))' }}>
                    {ep.records_path}
                  </code>
                </div>
              )}
              {ep.pagination && (
                <div>
                  <span className="font-medium">Pagination:</span> {ep.pagination}
                </div>
              )}
              {ep.description && <div>{ep.description}</div>}
            </div>
          )}
        </div>
      ))}

      {endpoints.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>
            No endpoints discovered. Try a different specification.
          </p>
        </div>
      )}
    </div>
  );
}
