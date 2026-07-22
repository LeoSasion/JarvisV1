export function HudPanel({ title, action, className = "", children, onClick }) {
  const Tag = onClick ? "button" : "section";

  return (
    <Tag
      className={`hud-panel ${className}`}
      onClick={onClick}
      type={onClick ? "button" : undefined}
    >
      {title ? (
        <header className="hud-panel__header">
          <span className="hud-panel__tick" aria-hidden="true" />
          <span>{title}</span>
          {action ? <span className="hud-panel__action">{action}</span> : null}
        </header>
      ) : null}
      <div className="hud-panel__body">{children}</div>
    </Tag>
  );
}
