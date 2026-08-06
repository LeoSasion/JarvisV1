import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_LAYOUT_MODES,
  LINKED_WORKSPACE_VARIANTS,
  getDockedWindowBounds,
  getLinkedWorkspaceVariant,
  getWorkspaceLayoutMode,
  isDockedWindow,
  isLinkedWindowSuppressed,
} from "../src/workspace-layout-mode.js";

function windowState(id, open = false, minimized = false) {
  return { id, open, minimized };
}

test("workspace modes promote Explorer and Pi into deliberate product states", () => {
  const windows = {
    explorer: windowState("explorer"),
    agent: windowState("agent"),
    terminal: windowState("terminal"),
  };
  assert.equal(getWorkspaceLayoutMode(windows), WORKSPACE_LAYOUT_MODES.DESKTOP);

  windows.explorer.open = true;
  assert.equal(getWorkspaceLayoutMode(windows), WORKSPACE_LAYOUT_MODES.EXPLORER_FOCUS);

  windows.agent.open = true;
  assert.equal(getWorkspaceLayoutMode(windows), WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED);

  windows.terminal.open = true;
  assert.equal(getWorkspaceLayoutMode(windows), WORKSPACE_LAYOUT_MODES.FLOATING);

  windows.terminal.minimized = true;
  assert.equal(getWorkspaceLayoutMode(windows), WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED);
});

test("linked layouts reserve the correct panes across desktop widths", () => {
  const wideViewport = { width: 1920, height: 1080, left: 12, right: 12, top: 62, bottom: 86 };
  const explorer = getDockedWindowBounds("explorer", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, wideViewport);
  const agent = getDockedWindowBounds("agent", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, wideViewport);
  assert.equal(explorer.x, 12);
  assert.equal(agent.x, explorer.x + explorer.width + 1);
  assert.ok(agent.x + agent.width < wideViewport.width - wideViewport.right);
  assert.equal(getLinkedWorkspaceVariant(wideViewport), LINKED_WORKSPACE_VARIANTS.THREE_PANE);

  const twoPaneViewport = { ...wideViewport, width: 1366 };
  const twoPaneExplorer = getDockedWindowBounds("explorer", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, twoPaneViewport);
  const twoPaneAgent = getDockedWindowBounds("agent", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, twoPaneViewport);
  assert.equal(twoPaneExplorer.width + twoPaneAgent.width + 1, twoPaneViewport.width - 24);
  assert.equal(getLinkedWorkspaceVariant(twoPaneViewport), LINKED_WORKSPACE_VARIANTS.TWO_PANE);

  const unevenTwoPaneViewport = { ...wideViewport, width: 1249 };
  const unevenExplorer = getDockedWindowBounds("explorer", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, unevenTwoPaneViewport);
  const unevenAgent = getDockedWindowBounds("agent", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, unevenTwoPaneViewport);
  assert.equal(unevenExplorer.width + unevenAgent.width + 1, unevenTwoPaneViewport.width - 24);
  assert.equal(unevenAgent.x + unevenAgent.width, unevenTwoPaneViewport.width - unevenTwoPaneViewport.right);

  const drawerViewport = { ...wideViewport, width: 1100 };
  const drawerExplorer = getDockedWindowBounds("explorer", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, drawerViewport);
  const drawerAgent = getDockedWindowBounds("agent", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, drawerViewport);
  assert.equal(drawerExplorer.width, drawerViewport.width - 24);
  assert.ok(drawerAgent.x > drawerExplorer.x);
  assert.equal(getLinkedWorkspaceVariant(drawerViewport), LINKED_WORKSPACE_VARIANTS.DRAWER);

  const singlePaneViewport = { ...wideViewport, width: 860 };
  assert.equal(getLinkedWorkspaceVariant(singlePaneViewport), LINKED_WORKSPACE_VARIANTS.SINGLE_PANE);
  assert.deepEqual(
    getDockedWindowBounds("explorer", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, singlePaneViewport),
    getDockedWindowBounds("agent", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED, singlePaneViewport),
  );
});

test("only the approved Explorer and Pi product states disable freeform gestures", () => {
  assert.equal(isDockedWindow("explorer", WORKSPACE_LAYOUT_MODES.EXPLORER_FOCUS), true);
  assert.equal(isDockedWindow("agent", WORKSPACE_LAYOUT_MODES.EXPLORER_FOCUS), false);
  assert.equal(isDockedWindow("agent", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED), true);
  assert.equal(isDockedWindow("terminal", WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED), false);
});

test("narrow linked layouts remove covered panes from focus and accessibility", () => {
  assert.equal(isLinkedWindowSuppressed("agent", LINKED_WORKSPACE_VARIANTS.DRAWER, false), true);
  assert.equal(isLinkedWindowSuppressed("agent", LINKED_WORKSPACE_VARIANTS.DRAWER, true), false);
  assert.equal(isLinkedWindowSuppressed("explorer", LINKED_WORKSPACE_VARIANTS.DRAWER, false), false);
  assert.equal(isLinkedWindowSuppressed("explorer", LINKED_WORKSPACE_VARIANTS.SINGLE_PANE, false), true);
  assert.equal(isLinkedWindowSuppressed("agent", LINKED_WORKSPACE_VARIANTS.SINGLE_PANE, false), true);
  assert.equal(isLinkedWindowSuppressed("terminal", LINKED_WORKSPACE_VARIANTS.SINGLE_PANE, false), false);
});

test("linked breakpoints include workspace insets exactly once", () => {
  const viewport = (width) => ({ width, height: 900, left: 12, right: 12, top: 62, bottom: 86 });
  assert.equal(getLinkedWorkspaceVariant(viewport(1463)), LINKED_WORKSPACE_VARIANTS.TWO_PANE);
  assert.equal(getLinkedWorkspaceVariant(viewport(1464)), LINKED_WORKSPACE_VARIANTS.THREE_PANE);
  assert.equal(getLinkedWorkspaceVariant(viewport(1203)), LINKED_WORKSPACE_VARIANTS.DRAWER);
  assert.equal(getLinkedWorkspaceVariant(viewport(1204)), LINKED_WORKSPACE_VARIANTS.TWO_PANE);
  assert.equal(getLinkedWorkspaceVariant(viewport(943)), LINKED_WORKSPACE_VARIANTS.SINGLE_PANE);
  assert.equal(getLinkedWorkspaceVariant(viewport(944)), LINKED_WORKSPACE_VARIANTS.DRAWER);
});
