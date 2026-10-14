# cooldown-map

Track a per-key cooldown, or a small pool of regenerating charges, with a clock the caller supplies.

A notification key, a command key, or an ability key stays blocked until its window has elapsed. The same map can hold a few charges and return one of them on a fixed period, including the fraction of a charge earned partway through that period. The caller passes `nowMs` on every call. The library does not read the clock, start a timer, or perform I/O. State is plain data, so it can be stored as JSON and passed back in later.

## Install

The package is an ES module. It needs Node.js 20 or newer. It has no runtime dependencies. The package name is `@aneron/cooldown-map`. It is not published to the npm registry.

Clone this repository and run the tests:

```bash
git clone https://github.com/ANERON-GAMES/cooldown-map.git
cd cooldown-map
npm install
npm test
```

`npm test` runs `node --test`. `npm run lint` runs ESLint. `npm run format:check` runs Prettier.

Install it as a dependency from the git repository:

```bash
npm install github:ANERON-GAMES/cooldown-map
```

```js
import { createCooldowns, tryUse } from "@aneron/cooldown-map";
```

Code in this repository imports the same entry point with `./src/index.js`.

## Usage

A one-charge map is a cooldown. The first use at 5000 ms is allowed and arms the key until 6000 ms. The use at 5400 ms is refused. The use at 6000 ms is allowed again.

```js
import { createCooldowns, peek, reset, sweep, tryUse } from "@aneron/cooldown-map";

const notify = createCooldowns({ durationMs: 1000 });
const first = tryUse(notify, "alert:disk", 5000);
const blocked = tryUse(first.state, "alert:disk", 5400);
const later = tryUse(blocked.state, "alert:disk", 6000);
const status = peek(later.state, "alert:disk", 6250);
```

`first.allowed` is `true`, `first.charges` is `0`, and `first.readyAtMs` is `6000`. `blocked.allowed` is `false`, `blocked.charges` is `0.4`, and `blocked.remainingMs` is `600`. `blocked.state` is `first.state`. `later.allowed` is `true` and `later.readyAtMs` is `7000`. `status.charges` is `0.25` and `status.remainingMs` is `750`.

`reset` drops one key. The next use of that key starts from a full pool. `sweep` drops keys that have already returned to full.

A charge pool uses the same functions. One charge comes back every `durationMs`. Time spent already full does not add extra charges.

```js
const powers = createCooldowns({ durationMs: 4000, maxCharges: 3 });
const opening = tryUse(powers, "dash", 10000);
const follow = tryUse(opening.state, "dash", 10000);
const empty = tryUse(follow.state, "dash", 10000);
const half = peek(empty.state, "dash", 12000);
const restored = peek(empty.state, "dash", 22000);
const cleaned = sweep(empty.state, 22000);
```

`opening.charges` is `2` and `opening.remainingMs` is `0`, so another use is allowed immediately. `follow.charges` is `1`. `empty.charges` is `0` and `empty.readyAtMs` is `14000`. `half.charges` is `0.5` and `half.remainingMs` is `2000`. `restored.charges` is `3`. `cleaned.removed` is `1`, and `dash` is gone. A missing key is a full pool, so keeping the full key would not change the next use.

## API reference

All functions are pure. They do not read the clock, the network, or the filesystem. They do not mutate the state, keys, or options you pass in. The state they return is frozen.

### Constants

| Export                | Value  | Meaning                                                                |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| `DEFAULT_DURATION_MS` | `1000` | Regeneration period used when `durationMs` is omitted.                 |
| `DEFAULT_MAX_CHARGES` | `1`    | Pool size used when `maxCharges` is omitted. One charge is a cooldown. |
| `DEFAULT_MAX_KEYS`    | `null` | Key cap used when `maxKeys` is omitted. `null` means the map is open.  |

### `CooldownReason`

Frozen. The fields and the strings are the same values.

| Field     | Value       | Meaning                                                           |
| --------- | ----------- | ----------------------------------------------------------------- |
| `Ready`   | `"ready"`   | `tryUse` consumed a charge, or `peek` sees at least one charge.   |
| `Cooling` | `"cooling"` | `tryUse` did not consume a charge, or `peek` sees fewer than one. |

`COOLDOWN_REASONS` is a frozen array of those strings, in the order `ready`, `cooling`.

`reason` agrees with `allowed`. On `tryUse`, both describe that call, not whether a further call would succeed. After a successful use spends the last charge, `allowed` is still `true` and `reason` is still `ready`, while `charges` is below 1 and `remainingMs` is the wait for the next one.

### `createCooldowns(options)`

Return a new cooldown map.

`options` may be omitted. A value that is not a plain object throws `TypeError` with the message `options must be an object`. `null`, an array, and a class instance are rejected. A frozen plain object and an object with a null prototype are accepted. Unknown fields are ignored. They are not copied onto the state.

| Field        | Type             | Role                                                                                                      |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `durationMs` | number           | Default period, in milliseconds. Omitted means `DEFAULT_DURATION_MS`. Must be finite and `> 0`.           |
| `maxCharges` | number           | Charges in a full pool. Omitted means `DEFAULT_MAX_CHARGES`. Integer from 1 through `2^53 - 1`.           |
| `maxKeys`    | number or `null` | Most keys stored at once. Omitted or `null` means no cap. Otherwise an integer from 1 through `2^53 - 1`. |

The return value is a frozen object:

```js
{
  durationMs: 1000,
  maxCharges: 1,
  maxKeys: null,
  entries: {}
}
```

`entries` is a frozen object with a null prototype. Each stored value is a frozen `{ charges, updatedAtMs, durationMs }`. `charges` is the pool at `updatedAtMs`. `durationMs` is the period used to regenerate that key. It can differ from the map default after a per-call duration. A key that has never been used is absent. Absence means the pool is full.

The object is JSON-serializable. `JSON.stringify` keeps the numbers and the keys. The next call freezes the parsed object again and restores the null prototype on `entries`.

### `tryUse(state, key, nowMs, durationMs)`

Consume one charge of `key` if one is available at `nowMs`.

| Argument     | Type   | Role                                                                                     |
| ------------ | ------ | ---------------------------------------------------------------------------------------- |
| `state`      | object | A map from `createCooldowns`, or the same shape parsed from JSON.                        |
| `key`        | string | Non-empty string. It is not trimmed and it is not case-folded.                           |
| `nowMs`      | number | Caller clock, in milliseconds. Finite and `>= 0`. `-0` is read as `0`.                   |
| `durationMs` | number | Optional period stored if this call consumes a charge. Omitted means `state.durationMs`. |

The checks run in this order. The first failure throws, and the input state is left as it was.

1. `state` must be a plain object with a finite `durationMs` greater than 0, an integer `maxCharges` of at least 1, a `maxKeys` of `null` or an integer of at least 1, and a plain `entries` object. Each entry must be a plain object whose `charges` are finite and from 0 through `maxCharges`, whose `updatedAtMs` is finite and at least 0, and whose `durationMs` is finite and greater than 0. An empty entry key is invalid.
2. `key` must be a non-empty string.
3. `nowMs` must be a finite number at least 0.
4. `durationMs`, when the argument is not `undefined`, must be a finite number greater than 0. A bad duration throws even when the key is cooling.
5. Project the key. A missing key projects to `maxCharges`.
6. Fewer than one charge: do not write. `evictedKeys` is empty. The duration argument is not stored.
7. Otherwise subtract one charge. A new key is inserted only after eviction has left a free slot, when `maxKeys` is not `null`.

The return value:

| Field         | Type    | Meaning                                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------------------- |
| `state`       | object  | Frozen map after the call. The same reference when a canonical state did not change.        |
| `allowed`     | boolean | `true` when this call consumed a charge.                                                    |
| `remainingMs` | number  | Wait until the next consume, after this call. `0` when a charge is still available.         |
| `readyAtMs`   | number  | `nowMs + remainingMs` when the key is cooling afterward. `nowMs` when a charge remains.     |
| `charges`     | number  | Projected charges after this call, capped at `maxCharges`.                                  |
| `reason`      | string  | `CooldownReason.Ready` when `allowed` is `true`. `CooldownReason.Cooling` otherwise.        |
| `evictedKeys` | array   | Keys removed to make room, earliest readiness first. Empty when this call inserted nothing. |

Projection uses the entry's stored period, not the optional argument. The argument becomes the stored period only when the use is allowed. The map's `durationMs` does not change.

A denied call on a state this library returned is the same state reference. A denied call on a plain object, including one from `JSON.parse`, returns a new frozen state with unknown fields removed. A second denied call on that frozen state returns the same reference. An allowed call always returns a new state object. Entry objects that were not changed keep their identity.

### `peek(state, key, nowMs)`

Report the key without writing.

The arguments follow the same rules as `tryUse`, without a duration. A bad state throws before the key is checked. A bad key throws before the clock is checked.

The return value is `{ allowed, remainingMs, readyAtMs, charges, reason }`. `allowed` is `true` when `tryUse` at the same `nowMs` would consume a charge. A missing key reports `charges` equal to `maxCharges`, `remainingMs` of `0`, `readyAtMs` equal to `nowMs`, and `reason` `ready`. `peek` does not insert, evict, or sweep.

### `reset(state, key)`

Drop one key.

| Argument | Type   | Role                     |
| -------- | ------ | ------------------------ |
| `state`  | object | Map to copy.             |
| `key`    | string | Non-empty key to delete. |

There is no clock argument. Charges are not projected, so `reset` can delete a key whose ready time is not finite.

The return value is `{ state, removed }`. `removed` is `true` when the key was present. A missing key on a canonical state returns that same state and `removed: false`. Other entries keep their identity. The next `peek` of the deleted key reports a full pool.

### `sweep(state, nowMs)`

Drop every key that has regenerated to `maxCharges`.

| Argument | Type   | Role                                           |
| -------- | ------ | ---------------------------------------------- |
| `state`  | object | Map to copy.                                   |
| `nowMs`  | number | Caller clock, with the same rules as `tryUse`. |

A key is expired when its projected charges are at least `maxCharges`. A key stored already full is expired even when `nowMs` is behind its anchor, because a backwards clock does not reduce stored charges. A key that still has room in the pool stays, including a key with a fractional charge.

The return value is `{ state, removed, keys }`. `removed` is the number of keys dropped. `keys` is those keys sorted ascending by UTF-16 code unit, which is the order used by `<` on strings. `"10"` sorts before `"2"`. When nothing is expired and the state is already canonical, `state` is the same reference and `keys` is empty. Sweep does not evict for `maxKeys`. It does not insert.

If any kept or removed key has a non-finite ready time, `sweep` throws `RangeError` and returns nothing. `reset` of that key does not need the ready time.

### Projection

For a stored entry the charge count at `nowMs` is:

```text
elapsedMs = max(0, nowMs - updatedAtMs)
projected = min(maxCharges, charges + elapsedMs / durationMs)
```

The division is IEEE-754. The result is not rounded to a fixed number of decimals. A charge is available when `projected >= 1`. If the anchor-based ready time is at or before `nowMs` while the division is still a rounding residue below 1, the key is treated as ready so it cannot cool past its own ready time. Inputs that divide evenly, such as 500 ms of a 1000 ms period, land on the exact fraction.

A missing key uses `projected = maxCharges` and has no anchor.

When a use is allowed and `nowMs` is at or after the anchor, the stored entry becomes:

```text
charges = projected - 1
updatedAtMs = nowMs
durationMs = the period chosen for this call
```

`projected` is already capped, so time spent above `maxCharges` is discarded before the subtraction. The pool cannot rise above `maxCharges` by waiting, and a later use cannot spend charges that were never stored.

When a use is allowed and `nowMs` is before the anchor, elapsed is 0. The stored charge count decreases by 1 and `updatedAtMs` stays where it was.

When the key is cooling, the public ready time uses the stored anchor, not a clock that has moved backward:

```text
readyAtMs = updatedAtMs + (1 - charges) * durationMs
remainingMs = readyAtMs - nowMs
```

When at least one charge is available, `remainingMs` is `0` and the public `readyAtMs` is the `nowMs` of that call.

### Eviction

`maxKeys` counts stored keys, not missing ones. Eviction runs only when `tryUse` inserts a new key and the stored count is at least `maxKeys`. The call removes keys until one slot is free, then inserts. A use of a key that is already stored does not evict, even if a hand-built state is already over the cap. A denied use does not evict.

The readiness used for eviction is not the public `readyAtMs`. The public value is `nowMs` for every key that is currently usable, so those keys would tie. Eviction uses the stored timestamp:

| Stored `charges` | Readiness                                       |
| ---------------- | ----------------------------------------------- |
| at least 1       | `updatedAtMs`, the anchor at which it was ready |
| below 1          | `updatedAtMs + (1 - charges) * durationMs`      |

The smallest timestamp is removed first. A key that has been ready since an earlier anchor goes before a key that is still cooling, when that cooling ready time is later. A tie uses the key string, ascending by UTF-16 code unit. `evictedKeys` is that removal order.

### Errors

Wrong types throw `TypeError`. Non-finite numbers, and numbers outside the allowed range, throw `RangeError`. The input is unchanged.

| Condition                             | Error        | Message                                       |
| ------------------------------------- | ------------ | --------------------------------------------- |
| `options` is not a plain object       | `TypeError`  | `options must be an object`                   |
| `durationMs` is not a number          | `TypeError`  | `durationMs must be a finite number`          |
| `durationMs` is `NaN` or an infinity  | `RangeError` | `durationMs must be a finite number`          |
| `durationMs` is `0` or negative       | `RangeError` | `durationMs must be greater than 0`           |
| `maxCharges` is not a number          | `TypeError`  | `maxCharges must be an integer`               |
| `maxCharges` is not an integer        | `RangeError` | `maxCharges must be an integer`               |
| `maxCharges` is below 1               | `RangeError` | `maxCharges must be at least 1`               |
| `maxCharges` is above `2^53 - 1`      | `RangeError` | `maxCharges must be at most 9007199254740991` |
| `maxKeys` is not `null` or a number   | `TypeError`  | `maxKeys must be null or an integer`          |
| `maxKeys` is not an integer           | `RangeError` | `maxKeys must be an integer`                  |
| `maxKeys` is below 1                  | `RangeError` | `maxKeys must be at least 1`                  |
| `state` is not a plain object         | `TypeError`  | `state must be an object`                     |
| `state.maxKeys` is omitted            | `TypeError`  | `state.maxKeys must be null or an integer`    |
| `state.entries` is not a plain object | `TypeError`  | `state.entries must be an object`             |
| `key` is not a non-empty string       | `TypeError`  | `key must be a non-empty string`              |
| `nowMs` is not a number               | `TypeError`  | `nowMs must be a finite number`               |
| `nowMs` is `NaN` or an infinity       | `RangeError` | `nowMs must be a finite number`               |
| `nowMs` is negative                   | `RangeError` | `nowMs must be at least 0`                    |
| computed ready time is not finite     | `RangeError` | `readyAtMs is not finite`                     |

Entry messages include the key as JSON text. A charge below 0 throws `RangeError` `entry "a" charges must be at least 0`. A charge above `maxCharges` throws `RangeError` `entry "a" charges must be at most maxCharges`. The same shape is used for `updatedAtMs` and `durationMs`. An entry that is not a plain object, including an accessor, throws `TypeError` `entry "a" must be an object`. The accessor is not called.

On `state` and on an entry, the field name is prefixed. `state.durationMs must be a finite number` and `entry "a" durationMs must be greater than 0` follow the same type and range split as the option fields.

## Design notes

A cooldown is a pool of one charge. `maxCharges` of 1 stores `0` after a use and projects back to `1` when `durationMs` has elapsed. A larger pool uses the same write path. There is no second algorithm for charges.

The fraction is part of the value, not a display hint. At 500 ms of a 1000 ms period a spent charge is `0.5`, and `tryUse` still refuses because the count is below 1. At 2500 ms a pool that started at `0` with `maxCharges` of 3 projects to `2.5`. A use then stores `1.5` at that clock reading. The next period continues from `1.5`, so the half charge is kept. Waiting from empty to far past full projects to `maxCharges`, not past it. The following use stores `maxCharges - 1` at the later clock. The extra time is not a hidden balance.

`charges` counts charges, not milliseconds. A per-call `durationMs` does not rescale charges already earned. It changes how long the next fraction takes. Earning `0.5` under a 1000 ms period and then storing a 2000 ms period leaves `0.5` charges. The remaining half takes 1000 ms of the new period. The projection that decided the use was allowed still used the old period.

The anchor does not move backward. Elapsed time is never negative. A call with `nowMs` before `updatedAtMs` does not refund a spent charge, does not clear a cooldown, and does not start the next charge early. If the stored count is already at least 1, the use is allowed and the anchor stays on the later timestamp while the count decreases by 1. Regeneration on a later forward reading starts at that same anchor, so the gap is not applied twice. If the stored count is below 1, the call is refused and `remainingMs` can be longer than `durationMs`, because both the anchor and the caller's early clock are in the subtraction. The result depends only on the state argument and `nowMs`. It does not depend on an earlier call's clock.

Keys are opaque strings. `"Alert"` and `"alert"` are different keys. A surrounding space is part of the key. The empty string is not a key. Order, player ids, and command names are the caller's concern. `entries` has a null prototype, and values are copied from own data properties, so a key named `__proto__` or `constructor` is stored as data. It does not change `Object.prototype`. After `JSON.parse`, the next call reads the own property again and copies it onto a null-prototype object.

Eviction prefers the key whose stored readiness is earliest. A key that still holds a charge has been ready since its anchor. A key with less than one charge becomes ready in the future. When the cap is reached, the key that became ready earlier is the one removed, and a key that is still cooling stays if its ready time is later. The public `readyAtMs` cannot make that distinction, because every usable key reports `nowMs`. The tie break is the key text, not insertion order, so two equal timestamps always drop the same key.

Sweep exists so a full key does not occupy the cap. Absence already means full. Sweep will not drop a partial pool: a key at two of three charges is still a real balance. Callers who want a bounded map can sweep before insert, or set `maxKeys` and let the next new key evict.

`-0` is `0` wherever a number is stored. A crafted entry that is otherwise canonical and holds `-0` is republished with `0` on the next write or denied use.

These functions do not schedule a callback, return a promise, or wake when a key becomes ready. They do not persist the map. They do not know what a key refers to. They spend one charge per allowed call, and they do not keep a history of uses. They do not sweep as a side effect of `peek` or of a denied `tryUse`. A ready time that overflows IEEE-754 throws `RangeError` with the message `readyAtMs is not finite` when that key is projected, evicted, or swept. The previous state is unchanged. `reset` can remove that key because it does not project it. `peek` of a different key does not project it either.

## License

Released under the MIT License. The full text is in [LICENSE](LICENSE).
