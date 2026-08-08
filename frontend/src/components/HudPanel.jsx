import { ChevronDownRegular } from "@fluentui/react-icons";

export function HudPanel({
  title,
  action,
  className = "",
  children,
  collapsible = false,
  open = true,
  onToggle,
}) {
  return (
    <section className={`hud-panel ${className} ${open ? "is-open" : "is-collapsed"}`}>
      {title ? (
        <header className="hud-panel__header">
          {collapsible ? (
            <button
              type="button"
              className="hud-panel__toggle"
              aria-expanded={open}
              onClick={onToggle}
            >
              <span className="hud-panel__tick" aria-hidden="true" />
              <span>{title}</span>
              <ChevronDownRegular aria-hidden="true" />
            </button>
          ) : (
            <>
              <span className="hud-panel__tick" aria-hidden="true" />
              <span>{title}</span>
            </>
          )}
          {action ? <span className="hud-panel__action">{action}</span> : null}
        </header>
      ) : null}
      {open ? <div className="hud-panel__body">{children}</div> : null}
    </section>
  );
}
