import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { clearPin, hasPin, setPin, verifyPin } from './pin'

describe('pin', () => {
  it('verifies the correct pin and rejects wrong ones', async () => {
    const kv = new MemoryKV()
    expect(await hasPin(kv)).toBe(false)
    await setPin(kv, '123456')
    expect(await hasPin(kv)).toBe(true)
    expect(await verifyPin(kv, '123456')).toBe(true)
    expect(await verifyPin(kv, '654321')).toBe(false)
  })

  it('stores a salted hash, not the pin itself', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456')
    const raw = await kv.get('pin-credential')
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('123456')
  })

  it('salts differ between installs', async () => {
    const a = new MemoryKV()
    const b = new MemoryKV()
    await setPin(a, '123456')
    await setPin(b, '123456')
    expect(await a.get('pin-credential')).not.toEqual(await b.get('pin-credential'))
  })

  it('clears the pin', async () => {
    const kv = new MemoryKV()
    await setPin(kv, '123456')
    await clearPin(kv)
    expect(await hasPin(kv)).toBe(false)
    expect(await verifyPin(kv, '123456')).toBe(false)
  })
})
