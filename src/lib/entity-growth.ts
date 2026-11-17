// Entity growth and source diversity. Pure: time enters only through `now`.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECENT_MS = 72 * HOUR_MS;
const WINDOW_MS = 336 * HOUR_MS;
const RECENT_DAYS = RECENT_MS / DAY_MS;
const PRIOR_DAYS = 11;
const RATIO_FLOOR = 0.3;
const DAILY_DAYS = 14;
const RISING_MIN_RECENT = 3;
const RISING_MIN_RATIO = 3;
const FALLING_MIN_USUAL = 0.5;
const FALLING_MAX_RATIO = 0.5;
const RATIO_CAP = 10;

export type GrowthState = "New" | "Rising" | "Falling" | "Steady" | "WarmingUp";
export interface HourlyCount { hourStart: Date; count: number }
// totals: mentions of ALL entities per hour (collection volume). Recent counts
// are scaled to the usual volume, so collecting more articles is not growth.
// Empty totals means no scaling.
export interface GrowthInput { hourly: HourlyCount[]; totals: HourlyCount[]; firstSeenAt: Date | null; tracked: boolean; now: Date }
export interface Growth {
  recent72h: number;      // sum of counts with now-72h <= hourStart < now
  usualPerDay: number;    // sum over now-336h <= hourStart < now-72h, divided by 11 (raw, no floor)
  ratio: number;          // (recent72h / 3 * volumeScale) / max(usualPerDay, 0.3)
  volumeScale: number;    // usual daily volume / recent daily volume; 1 when either is 0
  state: GrowthState;
  daily: number[];        // length 14, index 0 = oldest day (13 to 14 days ago), index 13 = last 24h
}

export type DiversityLabel = "No sources" | "Single source" | "2 sources" | "Multi-source";

function assertValidDate(value: unknown, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
}

function assertValidCount(count: number): void {
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`count must be a finite non-negative number, got ${count}`);
  }
}

function validateInput(input: GrowthInput): void {
  assertValidDate(input.now, "now");
  if (input.firstSeenAt !== null) {
    assertValidDate(input.firstSeenAt, "firstSeenAt");
  }
  for (const entry of [...input.hourly, ...input.totals]) {
    assertValidDate(entry.hourStart, "hourStart");
    assertValidCount(entry.count);
  }
}

function volumeScale(totals: HourlyCount[], nowMs: number): number {
  const usualVolume = sumCounts(totals, nowMs - WINDOW_MS, nowMs - RECENT_MS) / PRIOR_DAYS;
  const recentVolume = sumCounts(totals, nowMs - RECENT_MS, nowMs) / RECENT_DAYS;
  if (usualVolume === 0 || recentVolume === 0) {
    return 1;
  }
  return usualVolume / recentVolume;
}

// Half-open range: from <= hourStart < to.
function inRange(hourStart: Date, from: number, to: number): boolean {
  const t = hourStart.getTime();
  return from <= t && t < to;
}

function sumCounts(hourly: HourlyCount[], from: number, to: number): number {
  let total = 0;
  for (const entry of hourly) {
    if (inRange(entry.hourStart, from, to)) {
      total += entry.count;
    }
  }
  return total;
}

// Maps an age in ms, in (0, 336h], to a daily index. Ages (0, 24h] map to 13,
// (24h, 48h] to 12, and so on. Subtracting 1 keeps an age of exactly 24h in its own bucket.
function dailyIndex(ageMs: number): number {
  const daysAgo = Math.floor((ageMs - 1) / DAY_MS);
  return DAILY_DAYS - 1 - daysAgo;
}

function buildDaily(hourly: HourlyCount[], nowMs: number): number[] {
  const daily = new Array<number>(DAILY_DAYS).fill(0);
  for (const entry of hourly) {
    if (inRange(entry.hourStart, nowMs - WINDOW_MS, nowMs)) {
      const index = dailyIndex(nowMs - entry.hourStart.getTime());
      daily[index] += entry.count;
    }
  }
  return daily;
}

function isNewState(input: GrowthInput, nowMs: number): boolean {
  if (input.tracked || input.firstSeenAt === null) {
    return false;
  }
  return input.firstSeenAt.getTime() >= nowMs - RECENT_MS;
}

function isWarmingUpState(input: GrowthInput, nowMs: number): boolean {
  if (input.firstSeenAt === null) {
    return true;
  }
  return input.firstSeenAt.getTime() > nowMs - RECENT_MS;
}

function classifyState(input: GrowthInput, recent72h: number, usualPerDay: number, ratio: number): GrowthState {
  const nowMs = input.now.getTime();
  if (isNewState(input, nowMs)) {
    return "New";
  }
  if (isWarmingUpState(input, nowMs)) {
    return "WarmingUp";
  }
  if (recent72h >= RISING_MIN_RECENT && ratio >= RISING_MIN_RATIO) {
    return "Rising";
  }
  if (usualPerDay >= FALLING_MIN_USUAL && ratio < FALLING_MAX_RATIO) {
    return "Falling";
  }
  return "Steady";
}

export function computeGrowth(input: GrowthInput): Growth {
  validateInput(input);
  const nowMs = input.now.getTime();
  const recent72h = sumCounts(input.hourly, nowMs - RECENT_MS, nowMs);
  const priorTotal = sumCounts(input.hourly, nowMs - WINDOW_MS, nowMs - RECENT_MS);
  const usualPerDay = priorTotal / PRIOR_DAYS;
  const scale = volumeScale(input.totals, nowMs);
  const ratio = ((recent72h / RECENT_DAYS) * scale) / Math.max(usualPerDay, RATIO_FLOOR);
  return {
    recent72h,
    usualPerDay,
    ratio,
    volumeScale: scale,
    state: classifyState(input, recent72h, usualPerDay, ratio),
    daily: buildDaily(input.hourly, nowMs),
  };
}

export function ratioText(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new Error(`ratio must be a finite non-negative number, got ${ratio}`);
  }
  if (ratio >= RATIO_CAP) {
    return "10+";
  }
  return ratio.toFixed(1);
}

function distinctNames(sourceNames: string[]): Set<string> {
  if (!Array.isArray(sourceNames)) {
    throw new Error("sourceNames must be an array");
  }
  const names = new Set<string>();
  for (const name of sourceNames) {
    if (typeof name !== "string") {
      throw new Error(`source name must be a string, got ${typeof name}`);
    }
    const trimmed = name.trim();
    if (trimmed !== "") {
      names.add(trimmed);
    }
  }
  return names;
}

function diversityLabel(count: number): DiversityLabel {
  if (count === 0) {
    return "No sources";
  }
  if (count === 1) {
    return "Single source";
  }
  if (count === 2) {
    return "2 sources";
  }
  return "Multi-source";
}

export function diversity(sourceNames: string[]): { count: number; label: DiversityLabel } {
  const count = distinctNames(sourceNames).size;
  return { count, label: diversityLabel(count) };
}
