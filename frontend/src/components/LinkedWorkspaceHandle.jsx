import { ChevronLeftRegular, ChevronRightRegular } from "@fluentui/react-icons";
import {
  getLinkedPaneToggleTarget,
  isCompactLinkedVariant,
} from "../workspace-layout-mode.js";

export function LinkedWorkspaceHandle({ activeId, variant, onActivate }) {
  if (!isCompactLinkedVariant(variant)) return null;
  const targetId = getLinkedPaneToggleTarget(activeId, variant);
  if (!targetId) return null;
  const Icon = targetId === "agent" ? ChevronLeftRegular : ChevronRightRegular;
  const targetLabel = targetId === "agent" ? "Agent" : "Explorer";

  return (
    <button
      type="button"
      className={`linked-workspace-handle is-${activeId === "agent" ? "agent" : "explorer"}`}
      aria-label={`Show ${targetLabel} pane. Agent remains linked.`}
      aria-controls={`workspace-window-${targetId}`}
      aria-keyshortcuts="Alt+F8"
      aria-pressed={activeId === "agent"}
      onClick={() => onActivate(targetId)}
    >
      <Icon aria-hidden="true" />
      <span><strong>AGENT · LINKED</strong><small>ALT F8 · SHOW {targetLabel.toUpperCase()}</small></span>
    </button>
  );
}
