import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import {
  attemptUnlock,
  clearPin,
  getLockout,
  hasPin,
  lockoutDelayMs,
  setPin,
  verifyPin,
} from './pin'

// Full-strength PBKDF2 everywhere would make this file slow; a low count
// exercises identical code paths (the count is stored per-credential).
const FAST = 1_000

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Write a legacy (pre-hardening) v1 credential: single salted SHA-256. */
async function seedLegacyPin(kv: MemoryKV, pin: string): Promise<void> {
  const saltHex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  await kv.set(
    'pin-credential',
    JSON.stringify({ saltHex, hashHex: await sha256Hex(saltHex + pin) }),
  )
}

describe('pin', () => {
  it('verifies the correct pin and rejects wrong ones', async () => {
    const kv = new MemoryKV()
    expect(await hasPin(kv)).toBe(false)
    await setPin(kv, '123456', FAST)
    expect(await hasPin(kv)).toBe(true)
    expect(await verifyPin(kv, '123456')).toBe(true)
    expect(await verifyPin(kv, '654321')).toBe(false)
  })

  it('stores a versioned PBKDF2 record, not the pin itself', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456', FAST)
    const raw = await kv.get('pin-credential')
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('123456')
    const parsed = JSON.parse(raw!) as { version: number; iterations: number; hashHex: string }
    expect(parsed.version).toBe(2)
    expect(parsed.iterations).toBe(FAST)
    expect(parsed.hashHex).toHaveLength(64) // 256-bit derived key
  })

  it('uses the documented iteration count by default', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456')
    const parsed = JSON.parse((await kv.get('pin-credential'))!) as { iterations: number }
    expect(parsed.iterations).toBe(600_000)
  })

  it('salts differ between installs', async () => {
    const a = new MemoryKV()
    const b = new MemoryKV()
    await setPin(a, '123456', FAST)
    await setPin(b, '123456', FAST)
    expect(await a.get('pin-credential')).not.toEqual(await b.get('pin-credential'))
  })

  it('clears the pin and the lockout with it', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456', FAST)
    await attemptUnlock(kv, '000000')
    await clearPin(kv)
    expect(await hasPin(kv)).toBe(false)
    expect(await verifyPin(kv, '123456')).toBe(false)
    expect((await getLockout(kv)).failedCount).toBe(0)
  })

  it('migrates a legacy v1 hash to v2 on the next successful unlock', async () => {
    const kv = new MemoryKV()
    await seedLegacyPin(kv, '123456')

    // Wrong pin against a v1 record: rejected, record untouched.
    expect(await verifyPin(kv, '999999')).toBe(false)
    expect(await kv.get('pin-credential')).not.toContain('version')

    // Correct pin: accepted AND upgraded in place.
    expect(await verifyPin(kv, '123456')).toBe(true)
    const upgraded = JSON.parse((await kv.get('pin-credential'))!) as { version: number }
    expect(upgraded.version).toBe(2)

    // Still verifies (and still rejects wrong pins) after the upgrade.
    expect(await verifyPin(kv, '123456')).toBe(true)
    expect(await verifyPin(kv, '999999')).toBe(false)
  })
})

describe('pin lockout', () => {
  it('follows the documented escalation schedule', () => {
    expect(lockoutDelayMs(1)).toBe(0)
    expect(lockoutDelayMs(4)).toBe(0)
    expect(lockoutDelayMs(5)).toBe(30_000)
    expect(lockoutDelayMs(6)).toBe(60_000)
    expect(lockoutDelayMs(7)).toBe(120_000)
    expect(lockoutDelayMs(20)).toBe(30 * 60_000) // capped at 30 min
  })

  it('locks after 5 failures and rejects even the correct pin while locked', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456', FAST)
    const t0 = 1_000_000

    for (let i = 1; i <= 4; i++) {
      const res = await attemptUnlock(kv, '000000', t0)
      expect(res.ok).toBe(false)
      expect(res.lockedForMs).toBe(0) // first four failures are free
      expect(res.failedCount).toBe(i)
    }

    const fifth = await attemptUnlock(kv, '000000', t0)
    expect(fifth.ok).toBe(false)
    expect(fifth.lockedForMs).toBe(30_000)

    // Inside the window even the CORRECT pin is rejected…
    const during = await attemptUnlock(kv, '123456', t0 + 10_000)
    expect(during.ok).toBe(false)
    expect(during.lockedForMs).toBe(20_000)
    expect(during.failedCount).toBe(5) // a blocked attempt is not counted

    // …and once it expires, the correct pin unlocks and resets the counter.
    const after = await attemptUnlock(kv, '123456', t0 + 30_001)
    expect(after.ok).toBe(true)
    expect((await getLockout(kv)).failedCount).toBe(0)
  })

  it('escalates the window on repeated failures past the threshold', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456', FAST)
    let now = 1_000_000
    for (let i = 1; i <= 5; i++) await attemptUnlock(kv, '000000', now)

    now += 31_000 // wait out the 30 s window, fail again → 60 s
    const sixth = await attemptUnlock(kv, '000000', now)
    expect(sixth.failedCount).toBe(6)
    expect(sixth.lockedForMs).toBe(60_000)
  })

  it('persists the lockout across a "restart" (same KV, fresh call site)', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456', FAST)
    const t0 = 1_000_000
    for (let i = 1; i <= 5; i++) await attemptUnlock(kv, '000000', t0)

    // Simulates the app relaunching: state comes only from the KV.
    const relaunch = await attemptUnlock(kv, '123456', t0 + 5_000)
    expect(relaunch.ok).toBe(false)
    expect(relaunch.lockedForMs).toBe(25_000)
  })
})
