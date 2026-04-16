import CONNECTOR_TEMPLATES from '../../data/connectorTemplates';

export default function TemplateSelector({ onSelect }) {
  // Use first 8 templates for the quick-start grid
  const templates = (CONNECTOR_TEMPLATES || []).slice(0, 8);

  if (templates.length === 0) {
    // Fallback templates if connectorTemplates is empty or not in expected format
    const fallback = [
      { name: 'Salesforce', category: 'CRM', icon: 'SF', color: '#00A1E0' },
      { name: 'HubSpot', category: 'Marketing', icon: 'HS', color: '#FF7A59' },
      { name: 'Stripe', category: 'Payments', icon: 'ST', color: '#635BFF' },
      { name: 'GitHub', category: 'DevOps', icon: 'GH', color: '#24292E' },
      { name: 'Jira', category: 'Project Mgmt', icon: 'JR', color: '#0052CC' },
      { name: 'Shopify', category: 'E-commerce', icon: 'SH', color: '#96BF48' },
      { name: 'Zendesk', category: 'Support', icon: 'ZD', color: '#03363D' },
      { name: 'Slack', category: 'Communication', icon: 'SL', color: '#4A154B' },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {fallback.map((t) => (
          <button
            key={t.name}
            onClick={() => onSelect({ name: t.name, baseUrl: '' })}
            className="card-interactive p-4 text-center"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 text-white text-xs font-bold"
              style={{ background: t.color }}
            >
              {t.icon}
            </div>
            <div className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>
              {t.name}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
              {t.category}
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {templates.map((template, i) => (
        <button
          key={template.name || i}
          onClick={() => onSelect(template)}
          className="card-interactive p-4 text-center"
        >
          {template.icon ? (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 bg-brand-500/10">
              <span className="text-brand-600 text-lg">{template.icon}</span>
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 text-white text-xs font-bold"
              style={{ background: template.color || '#009845' }}
            >
              {(template.name || '').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="text-sm font-medium truncate" style={{ color: 'rgb(var(--color-text))' }}>
            {template.name}
          </div>
          <div className="text-[10px] mt-0.5 truncate" style={{ color: 'rgb(var(--color-text-muted))' }}>
            {template.category || template.description || ''}
          </div>
        </button>
      ))}
    </div>
  );
}
