import { useState } from 'react';
import { ChevronDown, ChevronRight, Table as TableIcon, Key } from 'lucide-react';

// Normalize field names — Java engine returns tableName/tableType, but older code used name/type
const nm = (t) => t?.tableName || t?.name || '';
const ty = (t) => t?.tableType || t?.type || 'TABLE';

export default function TableList({ tables, selectedNames, onToggle, onToggleAll }) {
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState('');

  const toggleExpand = (name) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const filtered = tables.filter((t) => !search || nm(t).toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tables..."
          className="input py-2 flex-1"
        />
        <button onClick={onToggleAll} className="btn-ghost text-xs whitespace-nowrap">
          {selectedNames.size === tables.length ? 'Deselect All' : `Select All (${tables.length})`}
        </button>
      </div>
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {filtered.map((t) => {
          const name = nm(t);
          const isExpanded = expanded.has(name);
          const isSelected = selectedNames.has(name);
          return (
            <div key={name} className="rounded-xl overflow-hidden" style={{ background: 'rgb(var(--color-surface-alt))' }}>
              <div
                className={`flex items-center gap-3 p-3 cursor-pointer ${isSelected ? 'bg-brand-500/5 border border-brand-500/30' : ''}`}
                onClick={() => toggleExpand(name)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => { e.stopPropagation(); onToggle(name); }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                {isExpanded
                  ? <ChevronDown className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
                  : <ChevronRight className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />}
                <TableIcon className="w-4 h-4 text-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'rgb(var(--color-text))' }}>
                    {t.schema ? `${t.schema}.` : ''}{name}
                  </div>
                  <div className="text-[11px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                    {t.columns?.length || 0} columns
                    {t.primaryKeys?.length > 0 && ` · PK: ${t.primaryKeys.join(', ')}`}
                    {ty(t) === 'VIEW' && ' · VIEW'}
                  </div>
                </div>
              </div>
              {isExpanded && t.columns?.length > 0 && (
                <div className="px-3 py-2 pl-12 text-xs border-t" style={{ borderColor: 'rgb(var(--color-border))' }}>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {t.columns.map((c) => (
                      <div key={c.name} className="flex items-center gap-1.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                        {c.primaryKey && <Key className="w-3 h-3 text-amber-500" />}
                        <span className="font-mono font-medium">{c.name}</span>
                        <span style={{ color: 'rgb(var(--color-text-muted))' }}>
                          {c.talendType?.replace('id_', '') || c.sqlType}
                          {!c.nullable && ' · NOT NULL'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>
            {search ? 'No tables match your search' : 'No tables discovered'}
          </div>
        )}
      </div>
    </div>
  );
}
