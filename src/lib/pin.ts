import type { KV } from '@/data/kv'

const PIN_KEY = 'pin-credential'
const LOCKOUT_KEY = 'pin-lockout'
export const PIN_LENGTH = 6

/**
 * PBKDF2-HMAC-SHA256 iteration count, per the OWASP password-storage
 * recommendation (600k, 2023). A 6-digit PIN has only 10^6 combinations, so
 * the real defense is the escalating lockout below — the KDF cost just makes
 * offline brute force of an exfiltrated hash expensive (~minutes per guess on
 * commodity hardware instead of microseconds for the old single SHA-256).
 */
export const PBKDF2_ITERATIONS = 600_000

/** Legacy format (pre-hardening): single salted SHA-256, no version field. */
interface StoredPinV1 {
  saltHex: string
  hashHex: string
}

interface StoredPinV2 extends StoredPinV1 {
  version: 2
  iterations: number
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return bytesToHex(new Uint8Array(digest))
}

async function pbkdf2Hex(pin: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex) as BufferSource, iterations },
    keyMaterial,
    256,
  )
  return bytesToHex(new Uint8Array(bits))
}

/**
 * Compare hashes without early exit, so a wrong guess costs the same time
 * regardless of how many leading characters match.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function setPin(kv: KV, pin: string, iterations = PBKDF2_ITERATIONS): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = bytesToHex(salt)
  const stored: StoredPinV2 = {
    version: 2,
    saltHex,
    iterations,
    hashHex: await pbkdf2Hex(pin, saltHex, iterations),
  }
  await kv.set(PIN_KEY, JSON.stringify(stored))
}

export async function verifyPin(kv: KV, pin: string): Promise<boolean> {
  const raw = await kv.get(PIN_KEY)
  if (raw === null) return false
  try {
    const stored = JSON.parse(raw) as StoredPinV1 | StoredPinV2
    if ('version' in stored && stored.version === 2) {
      const hash = await pbkdf2Hex(pin, stored.saltHex, stored.iterations)
      return constantTimeEqualHex(hash, stored.hashHex)
    }
    // v1 legacy record: verify with the old scheme, then upgrade in place —
    // the "migration on next successful unlock". An upgrade failure must
    // never block the unlock (the v1 record simply stays until next time).
    const legacy = await sha256Hex(stored.saltHex + pin)
    if (!constantTimeEqualHex(legacy, stored.hashHex)) return false
    try {
      await setPin(kv, pin)
    } catch {
      // fail open: keep the working v1 credential
    }
    return true
  } catch {
    return false
  }
}

export async function hasPin(kv: KV): Promise<boolean> {
  return (await kv.get(PIN_KEY)) !== null
}

export async function clearPin(kv: KV): Promise<void> {
  await kv.remove(PIN_KEY)
  await kv.remove(LOCKOUT_KEY)
}

// ---------------------------------------------------------------------------
// Escalating lockout — persisted, so restarting the app does not reset it.

export interface LockoutState {
  failedCount: number
  /** Epoch ms until which PIN attempts are rejected; 0 = not locked. */
  lockedUntil: number
}

const NO_LOCKOUT: LockoutState = { failedCount: 0, lockedUntil: 0 }

/**
 * Delay schedule: attempts 1–4 are free (fat fingers), the 5th failure locks
 * for 30 s and every further failure doubles the wait, capped at 30 min.
 * With ~50 guesses/day at the cap, a 6-digit space stays out of reach.
 */
export function lockoutDelayMs(failedCount: number): number {
  if (failedCount < 5) return 0
  return Math.min(30_000 * 2 ** (failedCount - 5), 30 * 60_000)
}

export async function getLockout(kv: KV): Promise<LockoutState> {
  const raw = await kv.get(LOCKOUT_KEY)
  if (raw === null) return NO_LOCKOUT
  try {
    const parsed = JSON.parse(raw) as LockoutState
    return typeof parsed.failedCount === 'number' && typeof parsed.lockedUntil === 'number'
      ? parsed
      : NO_LOCKOUT
  } catch {
    return NO_LOCKOUT
  }
}

async function recordFailure(kv: KV, now: number): Promise<LockoutState> {
  const prev = await getLockout(kv)
  const failedCount = prev.failedCount + 1
  const delay = lockoutDelayMs(failedCount)
  const next: LockoutState = { failedCount, lockedUntil: delay > 0 ? now + delay : 0 }
  await kv.set(LOCKOUT_KEY, JSON.stringify(next))
  return next
}

export async function clearLockout(kv: KV): Promise<void> {
  await kv.remove(LOCKOUT_KEY)
}

export interface UnlockResult {
  ok: boolean
  /** >0 when the attempt was rejected (or just failed into) a lockout window. */
  lockedForMs: number
  failedCount: number
}

/**
 * The one entry point UI code should use for PIN checks: enforces the
 * persisted lockout window before hashing, counts failures, and resets the
 * counter on success.
 */
export async function attemptUnlock(kv: KV, pin: string, now = Date.now()): Promise<UnlockResult> {
  const lockout = await getLockout(kv)
  if (lockout.lockedUntil > now) {
    return { ok: false, lockedForMs: lockout.lockedUntil - now, failedCount: lockout.failedCount }
  }
  if (await verifyPin(kv, pin)) {
    await clearLockout(kv)
    return { ok: true, lockedForMs: 0, failedCount: 0 }
  }
  const next = await recordFailure(kv, now)
  return { ok: false, lockedForMs: Math.max(0, next.lockedUntil - now), failedCount: next.failedCount }
}
