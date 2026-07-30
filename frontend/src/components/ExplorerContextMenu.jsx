import {
  ArrowClockwiseRegular,
  ClipboardPasteRegular,
  CodeRegular,
  CopyRegular,
  CutRegular,
  DeleteRegular,
  DocumentRegular,
  FolderAddRegular,
  FolderRegular,
  OpenRegular,
  RenameRegular,
} from "@fluentui/react-icons";
import { Fragment, useEffect, useRef, useState } from "react";
import { getExplorerContextMenuKeyboardTarget } from "../explorer-context-menu-model.js";

const actionIcons = Object.freeze({
  open: OpenRegular,
  "open-in-windows": FolderRegular,
  copy: CopyRegular,
  cut: CutRegular,
  "copy-path": CodeRegular,
  rename: RenameRegular,
  properties: DocumentRegular,
  recycle: DeleteRegular,
  "new-folder": FolderAddRegular,
  paste: ClipboardPasteRegular,
  refresh: ArrowClockwiseRegular,
});

export function ExplorerContextMenu({
  menu,
  actions,
  onAction,
  onDismiss,
}) {
  const itemRefs = useRef(new Map());
  const [activeIndex, setActiveIndex] = useState(() =>
    getExplorerContextMenuKeyboardTarget(actions, -1, "Home"));

  useEffect(() => {
    const nextIndex = getExplorerContextMenuKeyboardTarget(actions, -1, "Home");
    setActiveIndex(nextIndex);
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current.get(nextIndex)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actions, menu.id]);

  const focusIndex = (index) => {
    if (index < 0) return;
    setActiveIndex(index);
    itemRefs.current.get(index)?.focus();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss(true);
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    focusIndex(getExplorerContextMenuKeyboardTarget(
      actions,
      activeIndex,
      event.key,
    ));
  };

  return (
    <div
      className="explorer-context-menu"
      role="menu"
      aria-label={menu.kind === "item"
        ? "Selected file commands"
        : "Current folder commands"}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      <header>
        <strong>{menu.kind === "item" ? "ITEM COMMANDS" : "FOLDER COMMANDS"}</strong>
        <small>{menu.kind === "item"
          ? `${menu.paths.length} SELECTED`
          : "CURRENT LOCATION"}</small>
      </header>
      <div className="explorer-context-menu__items">
        {actions.map((action, index) => {
          const Icon = actionIcons[action.id] ?? DocumentRegular;
          const previousGroup = actions[index - 1]?.group;
          return (
            <Fragment key={action.id}>
              {previousGroup && previousGroup !== action.group
                ? <div className="explorer-context-menu__separator" role="separator" />
                : null}
              <button
                ref={(element) => {
                  if (element) itemRefs.current.set(index, element);
                  else itemRefs.current.delete(index);
                }}
                type="button"
                role="menuitem"
                className={action.danger ? "is-danger" : ""}
                disabled={action.disabled}
                aria-disabled={action.disabled}
                tabIndex={activeIndex === index ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                onClick={() => onAction(action.id)}
              >
                <Icon aria-hidden="true" />
                <span>{action.label}</span>
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
