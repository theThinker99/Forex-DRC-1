export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="between" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: '1.4rem' }}>{title}</h1>
        {subtitle && (
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}
