import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';

export default function NodeConfigPanel({ node, onUpdate, onClose }) {
  const [params, setParams] = useState({});

  useEffect(() => {
    if (node?.params) {
      // Deep copy params
      const copy = {};
      for (const [key, param] of Object.entries(node.params)) {
        copy[key] = { ...param };
      }
      setParams(copy);
    }
  }, [node]);

  const handleChange = (key, value) => {
    setParams((prev) => ({
      ...prev,
      [key]: { ...prev[key], value },
    }));
  };

  const handleSave = () => {
    if (onUpdate) {
      onUpdate(node.id, params);
    }
  };

  if (!node) return null;

  return (
    <div
      className="w-80 border-l flex flex-col shrink-0 animate-slide-in"
      style={{
        background: 'rgb(var(--color-surface))',
        borderColor: 'rgb(var(--color-border))',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'rgb(var(--color-border))' }}
      >
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
            {node.label || node.type}
          </h3>
          <p className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Component Properties
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <X className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
        </button>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(params).map(([key, param]) => (
          <div key={key}>
            <label className="input-label">{key.replace(/_/g, ' ')}</label>

            {param.type === 'CHECK' ? (
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!param.value}
                  onChange={(e) => handleChange(key, e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm" style={{ color: 'rgb(var(--color-text))' }}>
                  {param.value ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            ) : param.type === 'CLOSED_LIST' ? (
              <select
                value={param.value || ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="input"
              >
                {(param.options || []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={param.value || ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="input"
                placeholder={`Enter ${key.toLowerCase()}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t" style={{ borderColor: 'rgb(var(--color-border))' }}>
        <button onClick={handleSave} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
}
