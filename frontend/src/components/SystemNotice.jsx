import {
  AlertRegular,
  CheckmarkCircleRegular,
  DismissRegular,
  InfoRegular,
} from "@fluentui/react-icons";

export function SystemNotice({ notice, onDismiss, placement = "desktop-bottom-end" }) {
  if (!notice) return null;
  const Icon = notice.severity === "ok"
    ? CheckmarkCircleRegular
    : notice.severity === "info"
      ? InfoRegular
      : AlertRegular;
  const urgent = notice.severity === "warning" || notice.severity === "error";

  return (
    <section
      className={`system-notice is-${notice.severity} is-placement-${placement}`}
      data-placement={placement}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon className="system-notice__icon" aria-hidden="true" />
      <span className="system-notice__copy">
        <strong>{notice.title}</strong>
        {notice.detail ? <small>{notice.detail}</small> : null}
      </span>
      {notice.actions.length > 0 ? (
        <span className="system-notice__actions">
          {notice.actions.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              type="button"
              onClick={() => {
                onDismiss();
                void Promise.resolve(action.onInvoke()).catch(() => {});
              }}
            >
              {action.label}
            </button>
          ))}
        </span>
      ) : null}
      <button type="button" className="system-notice__dismiss" onClick={onDismiss} aria-label="Dismiss notification">
        <DismissRegular />
      </button>
    </section>
  );
}
