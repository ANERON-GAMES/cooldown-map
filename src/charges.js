import { CooldownReason } from "./constants.js";

const CHARGE_COST = 1;

export function viewEntry(entry, nowMs, maxCharges) {
  const charges = projectCharges(entry, nowMs, maxCharges);
  if (charges >= CHARGE_COST) {
    return readyView(nowMs, charges);
  }
  const readyAtMs = storedReadyAtMs(entry);
  const remainingMs = readyAtMs - nowMs;
  if (!(remainingMs > 0)) {
    return readyView(nowMs, CHARGE_COST);
  }
  return {
    allowed: false,
    remainingMs,
    readyAtMs,
    charges,
    reason: CooldownReason.Cooling
  };
}

export function hasMaxCharges(entry, nowMs, maxCharges) {
  return viewEntry(entry, nowMs, maxCharges).charges >= maxCharges;
}

export function consumeEntry(entry, nowMs, maxCharges, durationMs) {
  const current = viewEntry(entry, nowMs, maxCharges);
  if (!current.allowed) {
    return { view: current, entry: null };
  }
  const next = entryAfterSpend(entry, current, nowMs, durationMs);
  return {
    view: viewEntry(next, nowMs, maxCharges),
    entry: next
  };
}

export function entryAfterGrant(nowMs, maxCharges, durationMs) {
  return {
    charges: maxCharges - CHARGE_COST,
    updatedAtMs: nowMs,
    durationMs
  };
}

export function storedReadyAtMs(entry) {
  const readyAtMs = readinessAtMs(entry);
  if (!Number.isFinite(readyAtMs)) {
    throw new RangeError("readyAtMs is not finite");
  }
  return readyAtMs;
}

function projectCharges(entry, nowMs, maxCharges) {
  const raw = entry.charges + elapsedSince(entry.updatedAtMs, nowMs) / entry.durationMs;
  if (!Number.isFinite(raw) || raw >= maxCharges) {
    return maxCharges;
  }
  if (raw < 0) {
    return 0;
  }
  return raw;
}

function readinessAtMs(entry) {
  if (entry.charges >= CHARGE_COST) {
    return entry.updatedAtMs;
  }
  return entry.updatedAtMs + (CHARGE_COST - entry.charges) * entry.durationMs;
}

function entryAfterSpend(entry, view, nowMs, durationMs) {
  return {
    charges: view.charges > CHARGE_COST ? view.charges - CHARGE_COST : 0,
    updatedAtMs: nowMs < entry.updatedAtMs ? entry.updatedAtMs : nowMs,
    durationMs
  };
}

function elapsedSince(updatedAtMs, nowMs) {
  if (nowMs < updatedAtMs) {
    return 0;
  }
  return nowMs - updatedAtMs;
}

function readyView(nowMs, charges) {
  return {
    allowed: true,
    remainingMs: 0,
    readyAtMs: nowMs,
    charges,
    reason: CooldownReason.Ready
  };
}
