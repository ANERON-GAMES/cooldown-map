import assert from "node:assert/strict";
import test from "node:test";
import { CooldownReason, createCooldowns, peek, sweep, tryUse } from "../src/index.js";

test("three spends empty the pool and half a duration restores half a charge", () => {
  let state = createCooldowns({ durationMs: 1000, maxCharges: 3 });
  state = tryUse(state, "dash", 0).state;
  state = tryUse(state, "dash", 0).state;
  const empty = tryUse(state, "dash", 0);
  assert.equal(empty.allowed, true);
  assert.equal(empty.charges, 0);
  assert.equal(empty.remainingMs, 1000);
  assert.equal(empty.readyAtMs, 1000);
  assert.equal(peek(empty.state, "dash", 0).allowed, false);
  const mid = peek(empty.state, "dash", 500);
  assert.equal(mid.charges, 0.5);
  assert.equal(mid.allowed, false);
  assert.equal(mid.remainingMs, 500);
  assert.equal(mid.readyAtMs, 1000);
  assert.equal(tryUse(empty.state, "dash", 500).allowed, false);
  const ready = tryUse(empty.state, "dash", 1000);
  assert.equal(ready.allowed, true);
  assert.equal(ready.charges, 0);
  assert.equal(ready.state.entries.dash.updatedAtMs, 1000);
  assert.equal(ready.state.entries.dash.charges, 0);
});

test("fractional regeneration uses one division from the anchor", () => {
  const empty = spendAll(createCooldowns({ durationMs: 1000, maxCharges: 3 }), "dash", 0);
  assert.equal(peek(empty, "dash", 1).charges, 1 / 1000);
  const partial = tryUse(empty, "dash", 2500);
  assert.equal(partial.allowed, true);
  assert.equal(partial.charges, 1.5);
  assert.equal(partial.remainingMs, 0);
  assert.equal(partial.state.entries.dash.updatedAtMs, 2500);
  assert.equal(peek(partial.state, "dash", 3000).charges, 2);
  assert.equal(peek(partial.state, "dash", 4500).charges, 3);
  const spent = tryUse(partial.state, "dash", 4500);
  assert.equal(spent.charges, 2);
  assert.equal(spent.state.entries.dash.updatedAtMs, 4500);
  assert.equal(peek(spent.state, "dash", 4500).charges, 2);
});

test("time at full charges does not bank", () => {
  const started = tryUse(createCooldowns({ durationMs: 1000, maxCharges: 3 }), "a", 0);
  assert.equal(started.charges, 2);
  const later = tryUse(started.state, "a", 100000);
  assert.equal(later.allowed, true);
  assert.equal(later.charges, 2);
  assert.equal(later.state.entries.a.updatedAtMs, 100000);
  const second = tryUse(later.state, "a", 100000);
  const third = tryUse(second.state, "a", 100000);
  const fourth = tryUse(third.state, "a", 100000);
  assert.equal(second.charges, 1);
  assert.equal(third.charges, 0);
  assert.equal(third.remainingMs, 1000);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.charges, 0);
  assert.equal(fourth.state, third.state);
});

test("a single charge does not bank across a long gap", () => {
  const used = tryUse(createCooldowns({ durationMs: 1000 }), "a", 0);
  const later = tryUse(used.state, "a", 10000);
  assert.equal(later.allowed, true);
  assert.equal(later.charges, 0);
  assert.equal(later.remainingMs, 1000);
  assert.equal(later.readyAtMs, 11000);
  assert.equal(tryUse(later.state, "a", 10000).allowed, false);
  assert.equal(peek(used.state, "a", 5000).charges, 1);
});

test("a per-call duration replaces the period after a successful use", () => {
  const used = tryUse(createCooldowns(), "a", 0, 250);
  assert.equal(used.state.durationMs, 1000);
  assert.equal(used.state.entries.a.durationMs, 250);
  assert.equal(used.readyAtMs, 250);
  assert.equal(used.remainingMs, 250);
  assert.equal(peek(used.state, "a", 249).allowed, false);
  assert.equal(peek(used.state, "a", 250).allowed, true);
  const again = tryUse(used.state, "a", 250, 80);
  assert.equal(again.allowed, true);
  assert.equal(again.state.entries.a.durationMs, 80);
  assert.equal(again.readyAtMs, 330);
  assert.equal(again.state.durationMs, 1000);
});

test("a denied use ignores the duration argument", () => {
  const used = tryUse(createCooldowns({ durationMs: 1000 }), "a", 0);
  const denied = tryUse(used.state, "a", 100, 50);
  assert.equal(denied.allowed, false);
  assert.equal(denied.state, used.state);
  assert.equal(denied.state.entries.a.durationMs, 1000);
  assert.equal(denied.remainingMs, 900);
});

test("earned charges stay earned when the next period changes", () => {
  const empty = spendAll(createCooldowns({ durationMs: 1000, maxCharges: 3 }), "dash", 0);
  const used = tryUse(empty, "dash", 1500, 2000);
  assert.equal(used.allowed, true);
  assert.equal(used.charges, 0.5);
  assert.equal(used.state.entries.dash.durationMs, 2000);
  assert.equal(used.state.entries.dash.updatedAtMs, 1500);
  assert.equal(used.remainingMs, 1000);
  assert.equal(used.readyAtMs, 2500);
  const next = peek(used.state, "dash", 2500);
  assert.equal(next.charges, 1);
  assert.equal(next.allowed, true);
  assert.equal(peek(used.state, "dash", 2499).charges, 0.5 + 999 / 2000);
});

test("a backwards clock does not refund a single charge or move its anchor", () => {
  const used = tryUse(createCooldowns({ durationMs: 1000 }), "a", 5000);
  const denied = tryUse(used.state, "a", 1000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, CooldownReason.Cooling);
  assert.equal(denied.charges, 0);
  assert.equal(denied.remainingMs, 5000);
  assert.equal(denied.readyAtMs, 6000);
  assert.equal(denied.state, used.state);
  assert.equal(peek(used.state, "a", 1000).charges, 0);
  assert.equal(peek(used.state, "a", 5000).remainingMs, 1000);
  assert.equal(tryUse(used.state, "a", 6000).allowed, true);
});

test("a backwards spend keeps the later anchor so skipped time is not regenerated twice", () => {
  const started = tryUse(createCooldowns({ durationMs: 1000, maxCharges: 2 }), "a", 5000);
  assert.equal(started.charges, 1);
  const back = tryUse(started.state, "a", 1000);
  assert.equal(back.allowed, true);
  assert.equal(back.reason, CooldownReason.Ready);
  assert.equal(back.charges, 0);
  assert.equal(back.state.entries.a.charges, 0);
  assert.equal(back.state.entries.a.updatedAtMs, 5000);
  assert.equal(back.readyAtMs, 6000);
  assert.equal(back.remainingMs, 5000);
  assert.equal(peek(back.state, "a", 5000).charges, 0);
  assert.equal(peek(back.state, "a", 5000).allowed, false);
  assert.equal(peek(back.state, "a", 6000).charges, 1);
  assert.equal(peek(back.state, "a", 7000).charges, 2);
  assert.equal(tryUse(back.state, "a", 6000).charges, 0);
});

test("a backwards spend can replace the period without moving the anchor", () => {
  const started = tryUse(createCooldowns({ durationMs: 1000, maxCharges: 2 }), "a", 5000);
  const back = tryUse(started.state, "a", 1000, 250);
  assert.equal(back.allowed, true);
  assert.equal(back.state.entries.a.updatedAtMs, 5000);
  assert.equal(back.state.entries.a.charges, 0);
  assert.equal(back.state.entries.a.durationMs, 250);
  assert.equal(back.readyAtMs, 5250);
  assert.equal(back.remainingMs, 4250);
  assert.equal(peek(back.state, "a", 5250).charges, 1);
  assert.equal(peek(back.state, "a", 5500).charges, 2);
});

test("a backwards clock does not sweep a partial key and does sweep a stored full key", () => {
  const cooling = {
    durationMs: 1000,
    maxCharges: 2,
    maxKeys: null,
    entries: {
      partial: { charges: 0.5, updatedAtMs: 5000, durationMs: 1000 },
      full: { charges: 2, updatedAtMs: 5000, durationMs: 1000 }
    }
  };
  const early = sweep(cooling, 0);
  assert.deepEqual(early.keys, ["full"]);
  assert.equal(early.state.entries.partial.charges, 0.5);
  const view = peek(early.state, "partial", 0);
  assert.equal(view.charges, 0.5);
  assert.equal(view.allowed, false);
  assert.equal(view.readyAtMs, 5500);
  assert.equal(view.remainingMs, 5500);
  assert.equal(sweep(early.state, 0).removed, 0);
});

test("regeneration of one key does not move another key", () => {
  let state = spendAll(createCooldowns({ durationMs: 1000, maxCharges: 2 }), "a", 0);
  state = tryUse(state, "b", 100).state;
  assert.equal(peek(state, "a", 500).charges, 0.5);
  assert.equal(peek(state, "b", 100).charges, 1);
  assert.equal(peek(state, "b", 500).charges, 1.4);
  assert.equal(state.entries.b.updatedAtMs, 100);
});

function spendAll(state, key, nowMs) {
  let next = state;
  for (let count = 0; count < next.maxCharges; count += 1) {
    next = tryUse(next, key, nowMs).state;
  }
  return next;
}
