import assert from "node:assert/strict";
import test from "node:test";
import { createCooldowns, peek, sweep, tryUse } from "../src/index.js";

test("a full map evicts the earliest readiness and keeps a key that is still cooling", () => {
  let state = createCooldowns({ durationMs: 1000, maxCharges: 2, maxKeys: 2 });
  state = tryUse(state, "hot", 0).state;
  state = tryUse(state, "cold", 0).state;
  state = tryUse(state, "cold", 0).state;
  const kept = state.entries.cold;
  const inserted = tryUse(state, "new", 100);
  assert.deepEqual(inserted.evictedKeys, ["hot"]);
  assert.equal(inserted.allowed, true);
  assert.equal(inserted.charges, 1);
  assert.equal(Object.hasOwn(inserted.state.entries, "hot"), false);
  assert.equal(inserted.state.entries.cold, kept);
  assert.equal(inserted.state.entries.cold.charges, 0);
  assert.deepEqual(Object.keys(inserted.state.entries).sort(), ["cold", "new"]);
  assert.equal(peek(inserted.state, "hot", 100).charges, 2);
});

test("equal readiness evicts the smaller key in code unit order", () => {
  let state = createCooldowns({ durationMs: 1000, maxKeys: 2 });
  state = tryUse(state, "b", 0).state;
  state = tryUse(state, "a", 0).state;
  const inserted = tryUse(state, "c", 50);
  assert.deepEqual(inserted.evictedKeys, ["a"]);
  assert.deepEqual(Object.keys(inserted.state.entries).sort(), ["b", "c"]);
  const numeric = createCooldowns({ durationMs: 1000, maxKeys: 2 });
  const ten = tryUse(tryUse(numeric, "2", 0).state, "10", 0).state;
  assert.deepEqual(tryUse(ten, "3", 10).evictedKeys, ["10"]);
});

test("updating a stored key does not evict even when the map is over the cap", () => {
  const state = {
    durationMs: 1000,
    maxCharges: 1,
    maxKeys: 1,
    entries: {
      a: { charges: 0, updatedAtMs: 0, durationMs: 1000 },
      b: { charges: 0, updatedAtMs: 0, durationMs: 1000 }
    }
  };
  const updated = tryUse(state, "a", 1000);
  assert.equal(updated.allowed, true);
  assert.deepEqual(updated.evictedKeys, []);
  assert.deepEqual(Object.keys(updated.state.entries).sort(), ["a", "b"]);
  assert.equal(updated.state.entries.a.updatedAtMs, 1000);
  assert.equal(updated.state.entries.b.updatedAtMs, 0);
});

test("an oversized map evicts until one slot is free, earliest readiness first", () => {
  let state = createCooldowns({ durationMs: 1000, maxCharges: 2, maxKeys: 1 });
  state = tryUse(state, "hot", 0).state;
  const plain = {
    durationMs: state.durationMs,
    maxCharges: state.maxCharges,
    maxKeys: 1,
    entries: {
      hot: { charges: 1, updatedAtMs: 0, durationMs: 1000 },
      cold: { charges: 0, updatedAtMs: 0, durationMs: 1000 }
    }
  };
  const inserted = tryUse(plain, "new", 100);
  assert.deepEqual(inserted.evictedKeys, ["hot", "cold"]);
  assert.deepEqual(Object.keys(inserted.state.entries), ["new"]);
  assert.equal(inserted.state.entries.new.charges, 1);
});

test("maxKeys of one replaces the only stored key", () => {
  const state = tryUse(createCooldowns({ durationMs: 1000, maxKeys: 1 }), "a", 0).state;
  const replaced = tryUse(state, "b", 10);
  assert.deepEqual(replaced.evictedKeys, ["a"]);
  assert.deepEqual(Object.keys(replaced.state.entries), ["b"]);
  assert.equal(peek(replaced.state, "a", 10).allowed, true);
  assert.equal(peek(replaced.state, "a", 10).charges, 1);
});

test("a missing cap stores every key", () => {
  let state = createCooldowns({ durationMs: 1000 });
  for (const key of ["a", "b", "c", "d", "e"]) {
    state = tryUse(state, key, 0).state;
  }
  assert.equal(Object.keys(state.entries).length, 5);
  assert.equal(state.maxKeys, null);
});

test("sweep removes only restored keys and sorts the removed names", () => {
  let state = createCooldowns({ durationMs: 1000, maxCharges: 2 });
  state = tryUse(state, "z", 0).state;
  state = tryUse(state, "a", 0).state;
  state = tryUse(state, "a", 0).state;
  const early = sweep(state, 999);
  assert.equal(early.removed, 0);
  assert.deepEqual(early.keys, []);
  assert.equal(early.state, state);
  const swept = sweep(state, 1000);
  assert.equal(swept.removed, 1);
  assert.deepEqual(swept.keys, ["z"]);
  assert.equal(Object.hasOwn(swept.state.entries, "z"), false);
  assert.equal(swept.state.entries.a.charges, 0);
  assert.equal(peek(swept.state, "z", 1000).charges, 2);
  const later = sweep(swept.state, 2000);
  assert.deepEqual(later.keys, ["a"]);
  assert.equal(later.removed, 1);
  assert.equal(Object.keys(later.state.entries).length, 0);
  assert.equal(sweep(later.state, 3000).state, later.state);
});

test("sweep at the exact single-charge boundary drops that key and keeps the later one", () => {
  let state = tryUse(createCooldowns({ durationMs: 1000 }), "a", 0).state;
  state = tryUse(state, "b", 1).state;
  const early = sweep(state, 1000);
  assert.deepEqual(early.keys, ["a"]);
  assert.equal(early.state.entries.b.updatedAtMs, 1);
  assert.equal(peek(early.state, "b", 1000).charges, 999 / 1000);
  const later = sweep(early.state, 1001);
  assert.deepEqual(later.keys, ["b"]);
});

test("a denied use and a sweep of a fresh use do not evict", () => {
  const state = tryUse(createCooldowns({ durationMs: 1000, maxKeys: 1 }), "a", 0).state;
  const denied = tryUse(state, "a", 10);
  assert.deepEqual(denied.evictedKeys, []);
  assert.equal(denied.state, state);
  assert.equal(sweep(state, 0).removed, 0);
  assert.equal(sweep(state, 0).state, state);
});

test("eviction keeps the later key's entry object", () => {
  let state = createCooldowns({ durationMs: 1000, maxKeys: 2 });
  state = tryUse(state, "b", 0).state;
  state = tryUse(state, "a", 10).state;
  const kept = state.entries.a;
  const inserted = tryUse(state, "c", 20);
  assert.equal(state.maxKeys, 2);
  assert.deepEqual(inserted.evictedKeys, ["b"]);
  assert.equal(inserted.state.entries.a, kept);
});
