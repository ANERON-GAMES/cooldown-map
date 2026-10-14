import { consumeEntry, entryAfterGrant, viewEntry } from "./charges.js";
import { hasMaxCharges, storedReadyAtMs } from "./charges.js";
import { CooldownReason, DEFAULT_DURATION_MS, DEFAULT_MAX_CHARGES } from "./constants.js";
import { isCanonicalState, readCallDuration, readKey, readNow } from "./validate.js";
import { readOptions, readState } from "./validate.js";

export function createCooldowns(options) {
  const read = readOptions(options);
  const durationMs = read.durationMs == null ? DEFAULT_DURATION_MS : read.durationMs;
  const maxCharges = read.maxCharges == null ? DEFAULT_MAX_CHARGES : read.maxCharges;
  return freezeState({ durationMs, maxCharges, maxKeys: read.maxKeys }, Object.create(null));
}

export function tryUse(state, key, nowMs, durationMs) {
  const current = readState(state);
  const name = readKey(key);
  const now = readNow(nowMs);
  const nextDuration = readCallDuration(durationMs, current.durationMs);
  if (!Object.hasOwn(current.entries, name)) {
    return grantKey(current, name, now, nextDuration);
  }
  const spent = consumeEntry(current.entries[name], now, current.maxCharges, nextDuration);
  if (spent.entry == null) {
    return useResult(publishState(state, current), false, spent.view, []);
  }
  const entries = copyEntries(current.entries);
  entries[name] = Object.freeze(spent.entry);
  return useResult(freezeState(current, entries), true, spent.view, []);
}

export function peek(state, key, nowMs) {
  const current = readState(state);
  const name = readKey(key);
  const now = readNow(nowMs);
  if (!Object.hasOwn(current.entries, name)) {
    return absentView(now, current.maxCharges);
  }
  return viewEntry(current.entries[name], now, current.maxCharges);
}

export function reset(state, key) {
  const current = readState(state);
  const name = readKey(key);
  if (!Object.hasOwn(current.entries, name)) {
    return { state: publishState(state, current), removed: false };
  }
  const entries = copyEntries(current.entries);
  delete entries[name];
  return { state: freezeState(current, entries), removed: true };
}

export function sweep(state, nowMs) {
  const current = readState(state);
  const now = readNow(nowMs);
  const keys = [];
  const entries = Object.create(null);
  for (const name of Object.keys(current.entries)) {
    if (hasMaxCharges(current.entries[name], now, current.maxCharges)) {
      keys.push(name);
      continue;
    }
    entries[name] = current.entries[name];
  }
  keys.sort(compareKeys);
  if (keys.length === 0) {
    return { state: publishState(state, current), removed: 0, keys };
  }
  return { state: freezeState(current, entries), removed: keys.length, keys };
}

function grantKey(current, key, nowMs, durationMs) {
  const entry = Object.freeze(entryAfterGrant(nowMs, current.maxCharges, durationMs));
  const view = viewEntry(entry, nowMs, current.maxCharges);
  const inserted = insertEntry(current.entries, key, entry, current.maxKeys);
  return useResult(freezeState(current, inserted.entries), true, view, inserted.evictedKeys);
}

function insertEntry(entries, key, entry, maxKeys) {
  const evictedKeys = [];
  const next = copyEntries(entries);
  if (maxKeys != null) {
    while (countKeys(next) >= maxKeys) {
      const victim = earliestKey(next);
      delete next[victim];
      evictedKeys.push(victim);
    }
  }
  next[key] = entry;
  return { entries: next, evictedKeys };
}

function earliestKey(entries) {
  let bestKey = null;
  let bestAt = 0;
  for (const key of Object.keys(entries)) {
    const readyAtMs = storedReadyAtMs(entries[key]);
    if (bestKey == null || readyAtMs < bestAt || (readyAtMs === bestAt && key < bestKey)) {
      bestKey = key;
      bestAt = readyAtMs;
    }
  }
  return bestKey;
}

function publishState(original, current) {
  if (isCanonicalState(original)) {
    return original;
  }
  return freezeState(current, current.entries);
}

function freezeState(meta, entries) {
  return Object.freeze({
    durationMs: meta.durationMs,
    maxCharges: meta.maxCharges,
    maxKeys: meta.maxKeys,
    entries: Object.freeze(entries)
  });
}

function copyEntries(entries) {
  const copy = Object.create(null);
  for (const key of Object.keys(entries)) {
    copy[key] = entries[key];
  }
  return copy;
}

function countKeys(entries) {
  return Object.keys(entries).length;
}

function absentView(nowMs, maxCharges) {
  return {
    allowed: true,
    remainingMs: 0,
    readyAtMs: nowMs,
    charges: maxCharges,
    reason: CooldownReason.Ready
  };
}

function useResult(state, allowed, view, evictedKeys) {
  return {
    state,
    allowed,
    remainingMs: view.remainingMs,
    readyAtMs: view.readyAtMs,
    charges: view.charges,
    reason: allowed ? CooldownReason.Ready : CooldownReason.Cooling,
    evictedKeys
  };
}

function compareKeys(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
