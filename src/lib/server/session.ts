// Admin session tokens. Web Crypto only: runs in Edge middleware and Node routes.

export const SESSION_COOKIE = "wd_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();
const TOKEN_PATTERN = /^admin\.(\d+)\.([0-9a-f]{64})$/;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time for equal-length strings; unequal lengths are not secret here. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

export async function signSession(secret: string, expMs: number): Promise<string> {
  const payload = `admin.${expMs}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifySession(secret: string, token: string, nowMs: number): Promise<boolean> {
  const match = TOKEN_PATTERN.exec(token);
  if (match === null) return false;
  const expMs = Number(match[1]);
  if (!Number.isSafeInteger(expMs) || expMs <= nowMs) return false;
  const expected = await hmacHex(secret, `admin.${expMs}`);
  return equalConstantTime(expected, match[2]);
}

export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  return equalConstantTime(a, b);
}

/** True when the request cookie value is a valid, unexpired admin token. */
export async function isAdminToken(secret: string, token: string | undefined): Promise<boolean> {
  if (token === undefined) return false;
  return verifySession(secret, token, Date.now());
}
