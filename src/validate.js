const CHARGE_FIELDS = Object.freeze(["charges", "updatedAtMs", "durationMs"]);

export function readOptions(options) {
  const source = plainOptions(options);
  return {
    durationMs: readOptionalDuration(source.durationMs, "durationMs"),
    maxCharges: readOptionalMaxCharges(source.maxCharges, "maxCharges"),
    maxKeys: readOptionalMaxKeys(source.maxKeys, "maxKeys")
  };
}

export function readState(state) {
  if (!isPlainObject(state)) {
    throw new TypeError("state must be an object");
  }
  const durationMs = readDuration(state.durationMs, "state.durationMs");
  const maxCharges = readMaxCharges(state.maxCharges, "state.maxCharges");
  const maxKeys = readRequiredMaxKeys(state.maxKeys, "state.maxKeys");
  return {
    durationMs,
    maxCharges,
    maxKeys,
    entries: readEntries(state.entries, maxCharges)
  };
}

export function readKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("key must be a non-empty string");
  }
  return key;
}

export function readNow(value) {
  const nowMs = readFiniteNumber(value, "nowMs");
  if (nowMs < 0) {
    throw new RangeError("nowMs must be at least 0");
  }
  return nowMs;
}

export function readCallDuration(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return readDuration(value, "durationMs");
}

export function isCanonicalState(state) {
  if (!Object.isFrozen(state) || Object.keys(state).length !== 4) {
    return false;
  }
  if (!hasData(state, "durationMs") || !hasData(state, "maxCharges")) {
    return false;
  }
  if (!hasData(state, "maxKeys") || !hasData(state, "entries")) {
    return false;
  }
  const entries = state.entries;
  if (!isPlainObject(entries) || !Object.isFrozen(entries)) {
    return false;
  }
  if (Object.getPrototypeOf(entries) !== null) {
    return false;
  }
  for (const key of Object.keys(entries)) {
    if (!hasData(entries, key) || !isCanonicalEntry(entries[key])) {
      return false;
    }
  }
  return true;
}

function plainOptions(options) {
  if (options === undefined) {
    return {};
  }
  if (!isPlainObject(options)) {
    throw new TypeError("options must be an object");
  }
  return options;
}

function readOptionalDuration(value, label) {
  if (value === undefined) {
    return null;
  }
  return readDuration(value, label);
}

function readOptionalMaxCharges(value, label) {
  if (value === undefined) {
    return null;
  }
  return readMaxCharges(value, label);
}

function readOptionalMaxKeys(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  return readMaxKeysValue(value, label);
}

function readRequiredMaxKeys(value, label) {
  if (value === undefined) {
    throw new TypeError(`${label} must be null or an integer`);
  }
  if (value === null) {
    return null;
  }
  return readMaxKeysValue(value, label);
}

function readEntries(entries, maxCharges) {
  if (!isPlainObject(entries)) {
    throw new TypeError("state.entries must be an object");
  }
  const copy = Object.create(null);
  for (const key of Object.keys(entries)) {
    if (key.length === 0) {
      throw new TypeError("key must be a non-empty string");
    }
    copy[key] = readEntry(ownValue(entries, key), maxCharges, key);
  }
  return copy;
}

function readEntry(value, maxCharges, key) {
  if (!isPlainObject(value)) {
    throw new TypeError(`entry ${quote(key)} must be an object`);
  }
  const entry = {
    charges: readCharges(value.charges, maxCharges, key),
    updatedAtMs: readUpdatedAt(value.updatedAtMs, key),
    durationMs: readDuration(value.durationMs, `entry ${quote(key)} durationMs`)
  };
  if (isCanonicalEntry(value) && sameEntry(value, entry)) {
    return value;
  }
  return Object.freeze(entry);
}

function readCharges(value, maxCharges, key) {
  const charges = readFiniteNumber(value, `entry ${quote(key)} charges`);
  if (charges < 0) {
    throw new RangeError(`entry ${quote(key)} charges must be at least 0`);
  }
  if (charges > maxCharges) {
    throw new RangeError(`entry ${quote(key)} charges must be at most maxCharges`);
  }
  return charges;
}

function readUpdatedAt(value, key) {
  const updatedAtMs = readFiniteNumber(value, `entry ${quote(key)} updatedAtMs`);
  if (updatedAtMs < 0) {
    throw new RangeError(`entry ${quote(key)} updatedAtMs must be at least 0`);
  }
  return updatedAtMs;
}

function readDuration(value, label) {
  const durationMs = readFiniteNumber(value, label);
  if (durationMs <= 0) {
    throw new RangeError(`${label} must be greater than 0`);
  }
  return durationMs;
}

function readMaxCharges(value, label) {
  const maxCharges = readInteger(value, label);
  if (maxCharges < 1) {
    throw new RangeError(`${label} must be at least 1`);
  }
  if (maxCharges > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} must be at most ${Number.MAX_SAFE_INTEGER}`);
  }
  return maxCharges;
}

function readMaxKeysValue(value, label) {
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be null or an integer`);
  }
  const maxKeys = readInteger(value, label);
  if (maxKeys < 1) {
    throw new RangeError(`${label} must be at least 1`);
  }
  if (maxKeys > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} must be at most ${Number.MAX_SAFE_INTEGER}`);
  }
  return maxKeys;
}

function readInteger(value, label) {
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be an integer`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer`);
  }
  return value;
}

function readFiniteNumber(value, label) {
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be a finite number`);
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
  if (Object.is(value, -0)) {
    return 0;
  }
  return value;
}

function isCanonicalEntry(entry) {
  if (!isPlainObject(entry) || !Object.isFrozen(entry) || Object.keys(entry).length !== 3) {
    return false;
  }
  for (const field of CHARGE_FIELDS) {
    if (!hasData(entry, field) || Object.is(entry[field], -0)) {
      return false;
    }
  }
  return true;
}

function sameEntry(left, right) {
  return (
    left.charges === right.charges &&
    left.updatedAtMs === right.updatedAtMs &&
    left.durationMs === right.durationMs
  );
}

function hasData(record, key) {
  if (!Object.hasOwn(record, key)) {
    return false;
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor != null && Object.hasOwn(descriptor, "value");
}

function ownValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor == null || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`entry ${quote(key)} must be an object`);
  }
  return descriptor.value;
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function quote(key) {
  return JSON.stringify(key);
}
