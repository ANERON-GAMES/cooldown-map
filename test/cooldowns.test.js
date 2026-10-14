import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  COOLDOWN_REASONS,
  CooldownReason,
  DEFAULT_DURATION_MS,
  DEFAULT_MAX_CHARGES,
  DEFAULT_MAX_KEYS,
  createCooldowns,
  peek,
  reset,
  sweep,
  tryUse
} from "../src/index.js";

test("defaults and reason names stay fixed", () => {
  assert.equal(DEFAULT_DURATION_MS, 1000);
  assert.equal(DEFAULT_MAX_CHARGES, 1);
  assert.equal(DEFAULT_MAX_KEYS, null);
  assert.equal(CooldownReason.Ready, "ready");
  assert.equal(CooldownReason.Cooling, "cooling");
  assert.deepEqual(COOLDOWN_REASONS, ["ready", "cooling"]);
  assert.equal(Object.isFrozen(CooldownReason), true);
  assert.equal(Object.isFrozen(COOLDOWN_REASONS), true);
  assert.throws(() => {
    CooldownReason.Ready = "other";
  }, TypeError);
  assert.throws(() => {
    COOLDOWN_REASONS.push("other");
  }, TypeError);
});

test("createCooldowns uses the defaults and returns a frozen empty map", () => {
  const state = createCooldowns();
  assert.equal(state.durationMs, 1000);
  assert.equal(state.maxCharges, 1);
  assert.equal(state.maxKeys, null);
  assert.deepEqual(Object.keys(state.entries), []);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.entries), true);
  assert.equal(Object.getPrototypeOf(state.entries), null);
  assert.throws(() => {
    state.durationMs = 5;
  }, TypeError);
  assert.throws(() => {
    state.entries.a = { charges: 0, updatedAtMs: 0, durationMs: 1 };
  }, TypeError);
});

test("each createCooldowns call returns its own state", () => {
  const left = createCooldowns();
  const right = createCooldowns();
  assert.notEqual(left, right);
  assert.notEqual(left.entries, right.entries);
});

test("options override the defaults and unknown fields are dropped", () => {
  const options = { durationMs: 50, maxCharges: 2, maxKeys: 3, label: "nope" };
  const state = createCooldowns(options);
  options.durationMs = 9;
  assert.equal(state.durationMs, 50);
  assert.equal(state.maxCharges, 2);
  assert.equal(state.maxKeys, 3);
  assert.equal(Object.hasOwn(state, "label"), false);
  assert.deepEqual(Object.keys(state).sort(), ["durationMs", "entries", "maxCharges", "maxKeys"]);
});

test("a null maxKeys and a frozen or null-prototype options object are unlimited or custom", () => {
  assert.equal(createCooldowns({ maxKeys: null }).maxKeys, null);
  assert.equal(createCooldowns(Object.freeze({ durationMs: 25 })).durationMs, 25);
  const options = Object.create(null);
  options.durationMs = 40;
  options.maxCharges = 4;
  assert.equal(createCooldowns(options).durationMs, 40);
  assert.equal(createCooldowns(options).maxCharges, 4);
});

test("the safe integer bounds are accepted and the next integer is rejected", () => {
  const state = createCooldowns({
    maxCharges: Number.MAX_SAFE_INTEGER,
    maxKeys: Number.MAX_SAFE_INTEGER
  });
  assert.equal(state.maxCharges, Number.MAX_SAFE_INTEGER);
  assert.equal(state.maxKeys, Number.MAX_SAFE_INTEGER);
  const used = tryUse(state, "a", 0);
  assert.equal(used.charges, Number.MAX_SAFE_INTEGER - 1);
  assert.throws(() => createCooldowns({ maxCharges: Number.MAX_SAFE_INTEGER + 1 }), {
    name: "RangeError",
    message: `maxCharges must be at most ${Number.MAX_SAFE_INTEGER}`
  });
  assert.throws(() => createCooldowns({ maxKeys: Number.MAX_SAFE_INTEGER + 1 }), {
    name: "RangeError",
    message: `maxKeys must be at most ${Number.MAX_SAFE_INTEGER}`
  });
});

test("createCooldowns rejects a bad options object", () => {
  assert.throws(() => createCooldowns(null), {
    name: "TypeError",
    message: "options must be an object"
  });
  assert.throws(() => createCooldowns([]), TypeError);
  assert.throws(() => createCooldowns(new Date(0)), TypeError);
  assert.throws(() => createCooldowns("1000"), TypeError);
  assert.throws(() => createCooldowns({ durationMs: "1000" }), {
    name: "TypeError",
    message: "durationMs must be a finite number"
  });
  assert.throws(() => createCooldowns({ durationMs: Number.NaN }), {
    name: "RangeError",
    message: "durationMs must be a finite number"
  });
  assert.throws(() => createCooldowns({ durationMs: Number.POSITIVE_INFINITY }), RangeError);
  assert.throws(() => createCooldowns({ durationMs: 0 }), {
    name: "RangeError",
    message: "durationMs must be greater than 0"
  });
  assert.throws(() => createCooldowns({ durationMs: -5 }), RangeError);
  assert.throws(() => createCooldowns({ durationMs: -0 }), RangeError);
  assert.throws(() => createCooldowns({ maxCharges: "1" }), {
    name: "TypeError",
    message: "maxCharges must be an integer"
  });
  assert.throws(() => createCooldowns({ maxCharges: 1.5 }), {
    name: "RangeError",
    message: "maxCharges must be an integer"
  });
  assert.throws(() => createCooldowns({ maxCharges: 0 }), {
    name: "RangeError",
    message: "maxCharges must be at least 1"
  });
  assert.throws(() => createCooldowns({ maxCharges: -1 }), RangeError);
  assert.throws(() => createCooldowns({ maxCharges: Number.NaN }), RangeError);
  assert.throws(() => createCooldowns({ maxKeys: true }), {
    name: "TypeError",
    message: "maxKeys must be null or an integer"
  });
  assert.throws(() => createCooldowns({ maxKeys: 1.5 }), {
    name: "RangeError",
    message: "maxKeys must be an integer"
  });
  assert.throws(() => createCooldowns({ maxKeys: 0 }), {
    name: "RangeError",
    message: "maxKeys must be at least 1"
  });
  assert.throws(() => createCooldowns({ maxKeys: -2 }), RangeError);
});

test("the readme notification sample refuses until the window elapses", () => {
  const notify = createCooldowns({ durationMs: 1000 });
  const first = tryUse(notify, "alert:disk", 5000);
  const blocked = tryUse(first.state, "alert:disk", 5400);
  const later = tryUse(blocked.state, "alert:disk", 6000);
  const status = peek(later.state, "alert:disk", 6250);

  assert.equal(first.allowed, true);
  assert.equal(first.reason, CooldownReason.Ready);
  assert.equal(first.charges, 0);
  assert.equal(first.remainingMs, 1000);
  assert.equal(first.readyAtMs, 6000);
  assert.deepEqual(first.evictedKeys, []);
  assert.deepEqual(first.state.entries["alert:disk"], {
    charges: 0,
    updatedAtMs: 5000,
    durationMs: 1000
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, CooldownReason.Cooling);
  assert.equal(blocked.charges, 0.4);
  assert.equal(blocked.remainingMs, 600);
  assert.equal(blocked.readyAtMs, 6000);
  assert.equal(blocked.state, first.state);
  assert.deepEqual(blocked.evictedKeys, []);

  assert.equal(later.allowed, true);
  assert.equal(later.charges, 0);
  assert.equal(later.remainingMs, 1000);
  assert.equal(later.readyAtMs, 7000);
  assert.equal(later.state.entries["alert:disk"].updatedAtMs, 6000);

  assert.deepEqual(status, {
    allowed: false,
    remainingMs: 750,
    readyAtMs: 7000,
    charges: 0.25,
    reason: CooldownReason.Cooling
  });
});

test("the readme charge sample regenerates one charge per duration and sweep drops a full key", () => {
  const powers = createCooldowns({ durationMs: 4000, maxCharges: 3 });
  const opening = tryUse(powers, "dash", 10000);
  const follow = tryUse(opening.state, "dash", 10000);
  const empty = tryUse(follow.state, "dash", 10000);
  const half = peek(empty.state, "dash", 12000);
  const restored = peek(empty.state, "dash", 22000);
  const cleaned = sweep(empty.state, 22000);

  assert.equal(opening.allowed, true);
  assert.equal(opening.charges, 2);
  assert.equal(opening.remainingMs, 0);
  assert.equal(opening.readyAtMs, 10000);
  assert.equal(follow.charges, 1);
  assert.equal(follow.remainingMs, 0);
  assert.equal(empty.allowed, true);
  assert.equal(empty.reason, CooldownReason.Ready);
  assert.equal(empty.charges, 0);
  assert.equal(empty.remainingMs, 4000);
  assert.equal(empty.readyAtMs, 14000);
  assert.deepEqual(half, {
    allowed: false,
    remainingMs: 2000,
    readyAtMs: 14000,
    charges: 0.5,
    reason: CooldownReason.Cooling
  });
  assert.equal(restored.allowed, true);
  assert.equal(restored.charges, 3);
  assert.equal(restored.remainingMs, 0);
  assert.equal(cleaned.removed, 1);
  assert.deepEqual(cleaned.keys, ["dash"]);
  assert.equal(Object.hasOwn(cleaned.state.entries, "dash"), false);
});

test("a missing key is a full pool and peek does not insert it", () => {
  const state = createCooldowns({ maxCharges: 3, durationMs: 1000 });
  const view = peek(state, "never", 250);
  assert.deepEqual(view, {
    allowed: true,
    remainingMs: 0,
    readyAtMs: 250,
    charges: 3,
    reason: CooldownReason.Ready
  });
  assert.equal(Object.keys(state.entries).length, 0);
  assert.equal(sweep(state, 250).state, state);
});

test("reset deletes one key and the next use starts from a full pool", () => {
  const notify = createCooldowns({ durationMs: 1000 });
  const later = tryUse(tryUse(notify, "alert:disk", 5000).state, "other", 5100).state;
  const kept = later.entries.other;
  const cleared = reset(later, "alert:disk");
  assert.equal(cleared.removed, true);
  assert.equal(Object.hasOwn(cleared.state.entries, "alert:disk"), false);
  assert.equal(cleared.state.entries.other, kept);
  const fresh = tryUse(cleared.state, "alert:disk", 6250);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.charges, 0);
  assert.equal(fresh.remainingMs, 1000);
  assert.equal(fresh.readyAtMs, 7250);
  const missing = reset(cleared.state, "alert:disk");
  assert.equal(missing.removed, false);
  assert.equal(missing.state, cleared.state);
});

test("a use at the ready time is allowed and one millisecond earlier is not", () => {
  const used = tryUse(createCooldowns({ durationMs: 1000 }), "a", 0);
  assert.equal(tryUse(used.state, "a", 999).allowed, false);
  assert.equal(peek(used.state, "a", 999).remainingMs, 1);
  const ready = tryUse(used.state, "a", 1000);
  assert.equal(ready.allowed, true);
  assert.equal(ready.charges, 0);
  assert.equal(ready.readyAtMs, 2000);
  assert.equal(ready.state.entries.a.updatedAtMs, 1000);
});

test("keys are independent and a whitespace key is kept", () => {
  let state = tryUse(createCooldowns({ durationMs: 1000 }), "left", 0).state;
  state = tryUse(state, " ", 100).state;
  assert.equal(peek(state, "left", 100).charges, 0.1);
  assert.equal(peek(state, " ", 100).charges, 0);
  assert.equal(peek(state, "right", 100).charges, 1);
  assert.equal(tryUse(state, "left", 100).allowed, false);
  assert.equal(tryUse(state, " ", 100).allowed, false);
});

test("zero and negative zero are the origin and a fractional duration is exact", () => {
  const used = tryUse(createCooldowns({ durationMs: 0.5 }), "a", -0);
  assert.equal(Object.is(used.state.entries.a.updatedAtMs, 0), true);
  assert.equal(used.readyAtMs, 0.5);
  assert.equal(peek(used.state, "a", 0.25).charges, 0.5);
  assert.equal(peek(used.state, "a", 0.25).remainingMs, 0.25);
});

test("validation checks state, then the key, then the clock, then the duration", () => {
  const state = createCooldowns();
  assert.throws(() => tryUse(null, "", -1), {
    name: "TypeError",
    message: "state must be an object"
  });
  assert.throws(() => tryUse([], "a", 0), TypeError);
  assert.throws(() => tryUse("state", "a", 0), TypeError);
  assert.throws(() => peek(state, "", -1), {
    name: "TypeError",
    message: "key must be a non-empty string"
  });
  assert.throws(() => tryUse(state, 1, 0), TypeError);
  assert.throws(() => tryUse(state, "a", -1, 0), {
    name: "RangeError",
    message: "nowMs must be at least 0"
  });
  assert.throws(() => reset(null, ""), {
    name: "TypeError",
    message: "state must be an object"
  });
  assert.throws(() => reset(state, ""), TypeError);
  assert.throws(() => sweep(null, -1), TypeError);
  assert.throws(() => sweep(state, -1), {
    name: "RangeError",
    message: "nowMs must be at least 0"
  });
  assert.throws(() => tryUse(state, "a", 0, 0), {
    name: "RangeError",
    message: "durationMs must be greater than 0"
  });
});

test("clocks and durations reject non-finite values and the wrong type", () => {
  const state = createCooldowns();
  for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => peek(state, "a", nowMs), {
      name: "RangeError",
      message: "nowMs must be a finite number"
    });
  }
  for (const nowMs of ["0", null, undefined, true]) {
    assert.throws(() => peek(state, "a", nowMs), {
      name: "TypeError",
      message: "nowMs must be a finite number"
    });
  }
  assert.throws(() => tryUse(state, "a", 0, Number.NaN), {
    name: "RangeError",
    message: "durationMs must be a finite number"
  });
  assert.throws(() => tryUse(state, "a", 0, "1000"), {
    name: "TypeError",
    message: "durationMs must be a finite number"
  });
  assert.throws(() => tryUse(state, "a", 0, null), TypeError);
  assert.throws(() => tryUse(state, Symbol("a"), 0), TypeError);
  assert.throws(() => tryUse(state, "a", 0, -10), RangeError);
});

test("a bad duration is rejected even while the key is cooling", () => {
  const used = tryUse(createCooldowns(), "a", 0);
  assert.throws(() => tryUse(used.state, "a", 10, 0), {
    name: "RangeError",
    message: "durationMs must be greater than 0"
  });
  assert.equal(used.state.entries.a.durationMs, 1000);
});

test("malformed state is rejected before a use is recorded", () => {
  const input = {
    durationMs: 1000,
    maxCharges: 1,
    maxKeys: null,
    entries: {
      good: { charges: 0, updatedAtMs: 0, durationMs: 1000 },
      bad: { charges: -1, updatedAtMs: 0, durationMs: 1000 }
    }
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  assert.throws(() => tryUse(input, "good", 1000), {
    name: "RangeError",
    message: 'entry "bad" charges must be at least 0'
  });
  assert.deepEqual(input, snapshot);
  assert.throws(() => peek({ durationMs: 1, maxCharges: 1, maxKeys: null }, "a", 0), {
    name: "TypeError",
    message: "state.entries must be an object"
  });
  assert.throws(
    () =>
      peek(
        {
          durationMs: 1000,
          maxCharges: 1,
          maxKeys: null,
          entries: []
        },
        "a",
        0
      ),
    TypeError
  );
  assert.throws(
    () =>
      peek(
        {
          durationMs: 1000,
          maxCharges: 1,
          maxKeys: null,
          entries: { "": { charges: 0, updatedAtMs: 0, durationMs: 1000 } }
        },
        "a",
        0
      ),
    {
      name: "TypeError",
      message: "key must be a non-empty string"
    }
  );
  assert.throws(
    () =>
      peek(
        {
          durationMs: 1000,
          maxCharges: 1,
          maxKeys: null,
          entries: { a: { charges: 2, updatedAtMs: 0, durationMs: 1000 } }
        },
        "a",
        0
      ),
    {
      name: "RangeError",
      message: 'entry "a" charges must be at most maxCharges'
    }
  );
  assert.throws(
    () =>
      peek(
        {
          durationMs: 1000,
          maxCharges: 1,
          maxKeys: null,
          entries: { a: null }
        },
        "a",
        0
      ),
    {
      name: "TypeError",
      message: 'entry "a" must be an object'
    }
  );
  assert.throws(
    () =>
      peek(
        {
          durationMs: 1000,
          maxCharges: 1,
          maxKeys: null,
          entries: { a: { charges: 0, updatedAtMs: -1, durationMs: 1000 } }
        },
        "a",
        0
      ),
    {
      name: "RangeError",
      message: 'entry "a" updatedAtMs must be at least 0'
    }
  );
  assert.throws(
    () =>
      peek(
        {
          durationMs: 0,
          maxCharges: 1,
          maxKeys: null,
          entries: {}
        },
        "a",
        0
      ),
    {
      name: "RangeError",
      message: "state.durationMs must be greater than 0"
    }
  );
  assert.throws(
    () =>
      peek(
        {
          durationMs: 1000,
          maxCharges: 1,
          entries: {}
        },
        "a",
        0
      ),
    {
      name: "TypeError",
      message: "state.maxKeys must be null or an integer"
    }
  );
});

test("an accessor on entries is rejected without calling it", () => {
  let called = false;
  const entries = {};
  Object.defineProperty(entries, "a", {
    enumerable: true,
    get() {
      called = true;
      return { charges: 0, updatedAtMs: 0, durationMs: 1000 };
    }
  });
  assert.throws(() => peek({ durationMs: 1000, maxCharges: 1, maxKeys: null, entries }, "a", 0), {
    name: "TypeError",
    message: 'entry "a" must be an object'
  });
  assert.equal(called, false);
});

test("inputs are not mutated and a canonical no-op returns the same state", () => {
  const plain = {
    durationMs: 1000,
    maxCharges: 1,
    maxKeys: null,
    note: "drop",
    entries: {
      a: { charges: 0, updatedAtMs: 0, durationMs: 1000, note: "drop" }
    }
  };
  const snapshot = JSON.parse(JSON.stringify(plain));
  const denied = tryUse(plain, "a", 10);
  assert.deepEqual(plain, snapshot);
  assert.equal(Object.isFrozen(plain), false);
  assert.equal(denied.allowed, false);
  assert.equal(Object.hasOwn(denied.state, "note"), false);
  assert.equal(Object.hasOwn(denied.state.entries.a, "note"), false);
  assert.equal(Object.isFrozen(denied.state), true);
  assert.equal(Object.getPrototypeOf(denied.state.entries), null);
  const again = tryUse(denied.state, "a", 20);
  assert.equal(again.state, denied.state);
  const granted = tryUse(plain, "a", 1000);
  assert.deepEqual(plain, snapshot);
  assert.equal(granted.allowed, true);
  assert.equal(granted.state.entries.a.updatedAtMs, 1000);
});

test("json round trip keeps the cooldown and restores a frozen null-prototype map", () => {
  const used = tryUse(createCooldowns({ durationMs: 1000 }), "a", 50);
  const parsed = JSON.parse(JSON.stringify(used.state));
  assert.deepEqual(peek(parsed, "a", 550), peek(used.state, "a", 550));
  const denied = tryUse(parsed, "a", 550);
  assert.equal(denied.allowed, false);
  assert.notEqual(denied.state, parsed);
  assert.equal(Object.isFrozen(parsed), false);
  assert.equal(parsed.entries.a.charges, 0);
  const second = tryUse(denied.state, "a", 560);
  assert.equal(second.state, denied.state);
  const saved = JSON.parse(JSON.stringify(denied.state));
  assert.equal(tryUse(saved, "a", 1050).allowed, true);
});

test("proto and constructor keys stay on the map and do not change object.prototype", () => {
  const used = tryUse(createCooldowns(), "__proto__", 0);
  assert.equal(used.allowed, true);
  assert.equal(used.state.entries.__proto__.charges, 0);
  assert.equal(Object.prototype.charges, undefined);
  const both = tryUse(used.state, "constructor", 0);
  assert.equal(typeof both.state.entries.constructor, "object");
  assert.equal(both.state.entries.constructor.charges, 0);
  const parsed = JSON.parse(JSON.stringify(used.state));
  const denied = tryUse(parsed, "__proto__", 500);
  assert.equal(denied.allowed, false);
  assert.equal(Object.prototype.charges, undefined);
  assert.equal(denied.state.entries.__proto__.charges, 0);
  assert.equal(Object.getPrototypeOf(denied.state.entries), null);
});

test("negative zero stored on an entry is normalized when the state is republished", () => {
  const entries = Object.create(null);
  entries.a = Object.freeze({ charges: -0, updatedAtMs: -0, durationMs: 1000 });
  const state = Object.freeze({
    durationMs: 1000,
    maxCharges: 1,
    maxKeys: null,
    entries: Object.freeze(entries)
  });
  const denied = tryUse(state, "a", 0);
  assert.equal(denied.allowed, false);
  assert.equal(Object.is(denied.state.entries.a.charges, 0), true);
  assert.equal(Object.is(denied.state.entries.a.updatedAtMs, 0), true);
});

test("a non-finite ready time throws and leaves the previous state unchanged", () => {
  const entries = Object.create(null);
  entries.a = Object.freeze({
    charges: 0,
    updatedAtMs: Number.MAX_VALUE,
    durationMs: Number.MAX_VALUE
  });
  const state = Object.freeze({
    durationMs: Number.MAX_VALUE,
    maxCharges: 1,
    maxKeys: 1,
    entries: Object.freeze(entries)
  });
  assert.throws(() => peek(state, "a", 0), {
    name: "RangeError",
    message: "readyAtMs is not finite"
  });
  assert.throws(() => tryUse(state, "b", 0), {
    name: "RangeError",
    message: "readyAtMs is not finite"
  });
  assert.equal(Object.hasOwn(state.entries, "b"), false);
  assert.deepEqual(peek(state, "b", 0), {
    allowed: true,
    remainingMs: 0,
    readyAtMs: 0,
    charges: 1,
    reason: CooldownReason.Ready
  });
  assert.throws(() => sweep(state, 0), {
    name: "RangeError",
    message: "readyAtMs is not finite"
  });
  const cleared = reset(state, "a");
  assert.equal(cleared.removed, true);
  assert.equal(Object.keys(cleared.state.entries).length, 0);
  assert.throws(
    () => tryUse(createCooldowns({ durationMs: Number.MAX_VALUE }), "a", Number.MAX_VALUE),
    {
      name: "RangeError",
      message: "readyAtMs is not finite"
    }
  );
});

test("unchanged entries keep their identity", () => {
  let state = tryUse(createCooldowns({ durationMs: 1000 }), "a", 0).state;
  state = tryUse(state, "b", 10).state;
  const kept = state.entries.b;
  const used = tryUse(state, "a", 1000);
  assert.equal(used.state.entries.b, kept);
  assert.notEqual(used.state.entries.a, state.entries.a);
  assert.equal(Object.isFrozen(used.state.entries.a), true);
  const swept = sweep(used.state, 10);
  assert.equal(swept.removed, 0);
  assert.equal(swept.state, used.state);
});

test("the same inputs produce the same view", () => {
  const state = tryUse(createCooldowns(), "a", 0).state;
  assert.deepEqual(peek(state, "a", 400), peek(state, "a", 400));
  assert.deepEqual(Object.keys(peek(state, "a", 400)).sort(), [
    "allowed",
    "charges",
    "readyAtMs",
    "reason",
    "remainingMs"
  ]);
  assert.deepEqual(Object.keys(tryUse(state, "a", 400)).sort(), [
    "allowed",
    "charges",
    "evictedKeys",
    "readyAtMs",
    "reason",
    "remainingMs",
    "state"
  ]);
});

test("package metadata names the public module", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "@aneron/cooldown-map");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.exports, "./src/index.js");
  assert.equal(pkg.main, "./src/index.js");
  assert.deepEqual(pkg.engines, { node: ">=20" });
  assert.deepEqual(pkg.files, ["src", "LICENSE", "README.md"]);
  assert.equal(pkg.repository.url, "git+https://github.com/ANERON-GAMES/cooldown-map.git");
});

test("the license is MIT and names the copyright holder", () => {
  const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Vadim Gubin\n/);
});

test("source files import only sibling modules and do not touch the clock", () => {
  const directory = new URL("../src/", import.meta.url);
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .sort();
  assert.deepEqual(names, [
    "charges.js",
    "constants.js",
    "cooldowns.js",
    "index.js",
    "validate.js"
  ]);
  for (const name of names) {
    const source = readFileSync(new URL(name, directory), "utf8");
    const lines = source.split("\n").filter((line) => line.startsWith("import "));
    for (const line of lines) {
      assert.match(line, /from "\.\/[a-z]+\.js";$/);
    }
    assert.equal(source.includes("node:"), false);
    assert.equal(source.includes("Date"), false);
    assert.equal(source.includes("setTimeout"), false);
    assert.equal(source.includes("setInterval"), false);
    assert.equal(source.includes("setImmediate"), false);
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("process"), false);
    for (const line of source.split("\n")) {
      assert.equal(line.includes("//"), false);
      assert.equal(line.includes("/*"), false);
      assert.equal(line.includes("*/"), false);
    }
  }
});
