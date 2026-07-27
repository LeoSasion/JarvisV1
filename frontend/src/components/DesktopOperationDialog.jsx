import { useEffect, useRef, useState } from "react";

export function DesktopOperationDialog({
  confirmLabel = "确认",
  danger = false,
  description,
  initialValue = "",
  inputLabel,
  onCancel,
  onConfirm,
  title,
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const normalized = inputLabel ? value.trim() : value;
    if (inputLabel && !normalized) {
      setError("名称不能为空。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(normalized);
    } catch (nextError) {
      setError(nextError?.message ?? "操作失败。");
      setBusy(false);
    }
  };

  return (
    <div className="desktop-operation-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="desktop-operation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-operation-title"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span>FILE OPERATION</span>
          <strong id="desktop-operation-title">{title}</strong>
        </header>
        {description ? <p>{description}</p> : null}
        {inputLabel ? (
          <label>
            <span>{inputLabel}</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
              maxLength={255}
            />
          </label>
        ) : null}
        {error ? <div className="desktop-operation-error" role="alert">{error}</div> : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>取消</button>
          <button className={danger ? "is-danger" : "is-primary"} type="submit" disabled={busy}>
            {busy ? "处理中…" : confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
