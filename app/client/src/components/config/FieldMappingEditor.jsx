import { useState } from 'react';
import { Plus, Trash2, ArrowRight } from 'lucide-react';

const fieldTypes = ['STRING', 'INTEGER', 'LONG', 'DOUBLE', 'BOOLEAN', 'DATE', 'TIMESTAMP'];

export default function FieldMappingEditor({ mappings = [], onChange }) {
  const [rows, setRows] = useState(
    mappings.length > 0
      ? mappings
      : [{ source: '', target: '', type: 'STRING' }],
  );

  const updateRow = (index, field, value) => {
    const updated = rows.map((r, i) =>
      i === index ? { ...r, [field]: value } : r,
    );
    setRows(updated);
    onChange?.(updated);
  };

  const addRow = () => {
    const updated = [...rows, { source: '', target: '', type: 'STRING' }];
    setRows(updated);
    onChange?.(updated);
  };

  const removeRow = (index) => {
    if (rows.length <= 1) return;
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated);
    onChange?.(updated);
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_auto] gap-2 items-center text-xs font-medium px-1" style={{ color: 'rgb(var(--color-text-secondary))' }}>
        <span>Source Field</span>
        <span />
        <span>Target Field</span>
        <span>Type</span>
        <span />
      </div>

      {/* Rows */}
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto_auto] gap-2 items-center">
          <input
            type="text"
            value={row.source}
            onChange={(e) => updateRow(i, 'source', e.target.value)}
            placeholder="source_field"
            className="input py-2 text-xs font-mono"
          />
          <ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'rgb(var(--color-text-muted))' }} />
          <input
            type="text"
            value={row.target}
            onChange={(e) => updateRow(i, 'target', e.target.value)}
            placeholder="target_field"
            className="input py-2 text-xs font-mono"
          />
          <select
            value={row.type}
            onChange={(e) => updateRow(i, 'type', e.target.value)}
            className="input py-2 text-xs w-28"
          >
            {fieldTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={() => removeRow(i)}
            disabled={rows.length <= 1}
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-30"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      ))}

      <button
        onClick={addRow}
        className="btn-ghost flex items-center gap-1.5 text-xs text-brand-600"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Field
      </button>
    </div>
  );
}
