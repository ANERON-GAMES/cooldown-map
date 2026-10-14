export const DEFAULT_DURATION_MS = 1000;
export const DEFAULT_MAX_CHARGES = 1;
export const DEFAULT_MAX_KEYS = null;

export const CooldownReason = Object.freeze({
  Ready: "ready",
  Cooling: "cooling"
});

export const COOLDOWN_REASONS = Object.freeze([CooldownReason.Ready, CooldownReason.Cooling]);
