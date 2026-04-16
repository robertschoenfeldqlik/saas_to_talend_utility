import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Globe, Braces, Shuffle, FileOutput, Terminal, Database } from 'lucide-react';

const typeIcons = {
  tRESTClient: Globe,
  tExtractJSONFields: Braces,
  tMap: Shuffle,
  tFileOutputJSON: FileOutput,
  tLogRow: Terminal,
  tMysqlOutput: Database,
};

function getSummary(data) {
  const params = data.params || {};
  switch (data.type) {
    case 'tRESTClient':
      return params.URL?.value || 'Configure URL';
    case 'tExtractJSONFields':
      return params.JSON_PATH?.value || 'Configure JSONPath';
    case 'tMap':
      return params.FIELDS?.value ? `${params.FIELDS.value.split(',').length} fields` : 'Configure mapping';
    case 'tFileOutputJSON':
      return params.FILE_PATH?.value || 'Configure output path';
    case 'tLogRow':
      return 'Console output';
    default:
      return data.type;
  }
}

function CanvasNode({ data, selected }) {
  const Icon = typeIcons[data.type] || Globe;
  const color = data.color || '#6B7280';
  const summary = getSummary(data);

  return (
    <div
      className={`rounded-xl shadow-card min-w-[200px] overflow-hidden transition-all ${
        selected ? 'ring-2 ring-brand-500 shadow-lg' : ''
      }`}
      style={{
        background: 'rgb(var(--color-surface))',
        border: '1px solid rgb(var(--color-border))',
      }}
    >
      {/* Color header */}
      <div className="h-1.5" style={{ background: color }} />

      <div className="p-3.5">
        <div className="flex items-center gap-2.5 mb-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${color}15` }}
          >
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <span
            className="text-xs font-bold tracking-tight"
            style={{ color: 'rgb(var(--color-text))' }}
          >
            {data.label}
          </span>
        </div>
        <p
          className="text-[11px] truncate max-w-[180px]"
          style={{ color: 'rgb(var(--color-text-secondary))' }}
        >
          {summary}
        </p>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !border-2 !border-white"
        style={{ background: color }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !border-white"
        style={{ background: color }}
      />
    </div>
  );
}

export default memo(CanvasNode);
