import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AGENT_CONTEXT_ITEMS,
  agentContextReducer,
  createAgentContextModel,
  createAgentContextPrompt,
  createAgentPromptForContext,
  getLatestAgentRelationMessage,
  getSuggestedAgentDirective,
  isAgentContextArmed,
  isAgentMessageInRelation,
  normalizeAgentContextItems,
} from "../src/agent-context-model.js";

function entry(path, overrides = {}) {
  const name = path.split(/[\\/]/u).at(-1);
  return {
    id: `id:${path}`,
    path,
    name,
    kind: "document",
    typeLabel: "Text Document",
    sizeBytes: 128,
    modified: "2026-08-05T01:02:03.000Z",
    isDirectory: false,
    isLinked: false,
    ...overrides,
  };
}

test("normalizes immutable display metadata, deduplicates Windows paths, and caps five items", () => {
  const source = entry("C:\\Work\\Alpha.txt", {
    content: "must not be retained",
    secret: "must not be retained",
  });
  const entries = [
    source,
    entry("c:\\work\\ALPHA.TXT", { name: "duplicate.txt" }),
    entry("C:\\Work\\Bravo.txt"),
    entry("C:\\Work\\Charlie.txt"),
    entry("C:\\Work\\Delta.txt"),
    entry("C:\\Work\\Echo.txt"),
    entry("C:\\Work\\Foxtrot.txt"),
  ];

  const normalized = normalizeAgentContextItems(entries);
  source.name = "mutated.txt";
  source.path = "C:\\Mutated.txt";
  source.sizeBytes = 999;

  assert.equal(MAX_AGENT_CONTEXT_ITEMS, 5);
  assert.equal(normalized.length, 5);
  assert.equal(normalized[0].name, "Alpha.txt");
  assert.equal(normalized[0].path, "C:\\Work\\Alpha.txt");
  assert.equal(normalized[0].sizeBytes, 128);
  assert.deepEqual(Object.keys(normalized[0]), [
    "id",
    "path",
    "name",
    "kind",
    "typeLabel",
    "sizeBytes",
    "modified",
    "isDirectory",
    "isLinked",
  ]);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized[0]), true);
  assert.equal(Object.hasOwn(normalized[0], "content"), false);
  assert.equal(Object.hasOwn(normalized[0], "secret"), false);
});

test("moves through empty, staged, submitting, running, and complete phases", () => {
  let model = createAgentContextModel();
  assert.deepEqual(model, {
    phase: "empty",
    items: [],
    relationId: null,
    clientMessageId: null,
    runId: null,
    error: null,
  });

  model = agentContextReducer(model, {
    type: "stage",
    entries: [entry("C:\\Work\\Alpha.txt")],
    relationId: "relation-1",
  });
  assert.equal(model.phase, "staged");
  assert.equal(model.items.length, 1);
  assert.equal(model.relationId, "relation-1");
  assert.equal(isAgentContextArmed(model), true);

  model = agentContextReducer(model, { type: "submit", clientMessageId: "client-1" });
  assert.equal(model.phase, "submitting");
  assert.equal(model.clientMessageId, "client-1");

  model = agentContextReducer(model, { type: "run-start", runId: "run-1" });
  assert.equal(model.phase, "running");
  assert.equal(model.runId, "run-1");

  model = agentContextReducer(model, {
    type: "run-end",
    runId: "run-1",
    status: "complete",
  });
  assert.equal(model.phase, "complete");
  assert.equal(model.items.length, 1);
  assert.equal(model.relationId, "relation-1");
  assert.equal(isAgentContextArmed(model), false);

  model = agentContextReducer(model, { type: "clear" });
  assert.equal(model.phase, "empty");
  assert.deepEqual(model.items, []);
});

test("error and aborted phases retain context for retry while session reset clears it", () => {
  const staged = createAgentContextModel([entry("C:\\Work\\Retry.txt")]);
  let model = agentContextReducer(staged, { type: "submit", clientMessageId: "client-error" });
  model = agentContextReducer(model, {
    type: "error",
    error: { code: "FILE_CHANGED", message: "The file changed.", retryable: true },
  });
  assert.equal(model.phase, "error");
  assert.equal(model.items[0].name, "Retry.txt");
  assert.deepEqual(model.error, {
    code: "FILE_CHANGED",
    message: "The file changed.",
    retryable: true,
  });

  model = agentContextReducer(model, { type: "submit", clientMessageId: "client-retry" });
  model = agentContextReducer(model, { type: "run-start", runId: "run-retry" });
  model = agentContextReducer(model, { type: "aborted" });
  assert.equal(model.phase, "aborted");
  assert.equal(model.items.length, 1);

  model = agentContextReducer(model, { type: "session-reset" });
  assert.equal(model.phase, "empty");
  assert.deepEqual(model.items, []);
});

test("builds an explicitly metadata-only prompt without leaking unapproved fields", () => {
  const context = [entry("C:\\Work\\Plan.txt", {
    content: "private file body",
    extractedText: "also private",
  })];
  const prompt = createAgentContextPrompt("Suggest a safe next step.", context);

  assert.match(prompt, /METADATA ONLY/u);
  assert.match(prompt, /File contents were not shared/u);
  assert.match(prompt, /Do not claim to have read, opened, inspected, or analyzed/u);
  assert.match(prompt, /C:\\\\Work\\\\Plan\.txt/u);
  assert.match(prompt, /Suggest a safe next step\./u);
  assert.doesNotMatch(prompt, /private file body/u);
  assert.doesNotMatch(prompt, /also private/u);
});

test("suggested directives never imply that file contents were read", () => {
  const single = getSuggestedAgentDirective([entry("C:\\Work\\Plan.txt")]);
  const multiple = getSuggestedAgentDirective([
    entry("C:\\Work\\Plan.txt"),
    entry("C:\\Work\\Budget.xlsx"),
  ]);

  assert.match(single, /only the shared metadata/u);
  assert.match(single, /Do not infer its file contents/u);
  assert.match(multiple, /only the shared metadata/u);
  assert.match(multiple, /Do not infer their file contents/u);
  assert.equal(createAgentContextPrompt("Plain question", []), "Plain question");
});

test("only the newest message from the active file relation becomes the route target", () => {
  let context = createAgentContextModel();
  context = agentContextReducer(context, {
    type: "stage",
    entries: [entry("C:\\Work\\Plan.txt")],
    relationId: "relation-plan",
  });
  context = agentContextReducer(context, {
    type: "submit",
    clientMessageId: "client-plan",
  });
  context = agentContextReducer(context, { type: "run-start", runId: "run-plan" });

  const messages = [
    { id: "client-plan", role: "user", clientMessageId: "client-plan", runId: "run-plan" },
    { id: "assistant-plan", role: "assistant", clientMessageId: null, runId: "run-plan" },
    { id: "system-plan", role: "system", clientMessageId: null, runId: "run-plan" },
    { id: "unrelated-user", role: "user", clientMessageId: "client-other", runId: "run-other" },
    { id: "unrelated-assistant", role: "assistant", clientMessageId: null, runId: "run-other" },
  ];

  assert.equal(isAgentMessageInRelation(messages[0], context), true);
  assert.equal(isAgentMessageInRelation(messages[2], context), false);
  assert.equal(isAgentMessageInRelation(messages[3], context), false);
  assert.equal(getLatestAgentRelationMessage(messages, context)?.id, "assistant-plan");
});

test("explicit relink creates a new armed relation while terminal history stays one-shot", () => {
  let context = createAgentContextModel();
  context = agentContextReducer(context, {
    type: "stage",
    entries: [entry("C:\\Work\\Plan.txt")],
    relationId: "relation-old",
  });
  context = agentContextReducer(context, { type: "submit", clientMessageId: "client-old" });
  context = agentContextReducer(context, { type: "run-start", runId: "run-old" });
  context = agentContextReducer(context, { type: "run-end", runId: "run-old", status: "complete" });
  assert.equal(isAgentContextArmed(context), false);
  assert.equal(
    createAgentPromptForContext("Unrelated ordinary question", context),
    "Unrelated ordinary question",
  );

  context = agentContextReducer(context, { type: "clear" });
  context = agentContextReducer(context, {
    type: "stage",
    entries: [entry("C:\\Work\\Plan.txt")],
    relationId: "relation-new",
  });
  assert.equal(context.relationId, "relation-new");
  assert.equal(isAgentContextArmed(context), true);
  assert.match(createAgentPromptForContext("Use the linked file", context), /METADATA ONLY/u);
});
