import assert from "node:assert/strict";
import test from "node:test";
import { createVolumeCommitScheduler } from "../src/volume-commit-model.js";

function createFakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    setTimeout(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      callbacks.delete(id);
    },
    run() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
  };
}

test("volume commits coalesce rapid changes and clamp the final value", () => {
  const commits = [];
  const timers = createFakeTimers();
  const scheduler = createVolumeCommitScheduler((value) => commits.push(value), 160, timers);
  scheduler.schedule(20);
  scheduler.schedule(42.4);
  scheduler.schedule(143);
  timers.run();

  assert.deepEqual(commits, [100]);
});

test("volume finalization flushes immediately, avoids duplicates, and cancels cleanup", () => {
  const commits = [];
  const timers = createFakeTimers();
  const scheduler = createVolumeCommitScheduler((value) => commits.push(value), 160, timers);
  scheduler.schedule(33);
  assert.equal(scheduler.flush(34), true);
  assert.equal(scheduler.flush(34), false);
  scheduler.schedule(50);
  scheduler.cancel();
  timers.run();

  assert.deepEqual(commits, [34]);
});
