import { describe, expect, it } from 'vitest'
import { MemoryKV, type KV } from '@/data/kv'
import { loadApiToken, migrateApiToken, saveApiToken } from './tokenStore'

/** Secure store stand-in whose writes (or reads) blow up like a broken Keystore. */
class BrokenKV implements KV {
  constructor(
    private inner = new MemoryKV(),
    private failOn: 'set' | 'get' | 'none' = 'set',
  ) {}
  get(key: string): Promise<string | null> {
    if (this.failOn === 'get') return Promise.reject(new Error('keystore unavailable'))
    return this.inner.get(key)
  }
  set(key: string, value: string): Promise<void> {
    if (this.failOn === 'set') return Promise.reject(new Error('keystore unavailable'))
    return this.inner.set(key, value)
  }
  remove(key: string): Promise<void> {
    return this.inner.remove(key)
  }
}

const legacySettings = (token: string) =>
  JSON.stringify({ source: 'api', apiBaseUrl: 'http://hermes-vps:8787', apiToken: token })

describe('tokenStore migration', () => {
  it('moves the token out of the settings JSON into secure storage', async () => {
    const plain = new MemoryKV()
    const secure = new MemoryKV()
    await plain.set('settings', legacySettings('tok-123'))

    await migrateApiToken(plain, secure)

    expect(await secure.get('api-token')).toBe('tok-123')
    const scrubbed = JSON.parse((await plain.get('settings'))!) as Record<string, unknown>
    expect('apiToken' in scrubbed).toBe(false)
    expect(scrubbed.apiBaseUrl).toBe('http://hermes-vps:8787') // rest untouched
  })

  it('is idempotent — running twice changes nothing', async () => {
    const plain = new MemoryKV()
    const secure = new MemoryKV()
    await plain.set('settings', legacySettings('tok-123'))

    await migrateApiToken(plain, secure)
    const afterFirst = await plain.get('settings')
    await migrateApiToken(plain, secure)

    expect(await secure.get('api-token')).toBe('tok-123')
    expect(await plain.get('settings')).toBe(afterFirst)
  })

  it('keeps the already-migrated token when a stale legacy copy reappears', async () => {
    const plain = new MemoryKV()
    const secure = new MemoryKV()
    await secure.set('api-token', 'tok-new')
    await plain.set('settings', legacySettings('tok-stale'))

    await migrateApiToken(plain, secure)

    expect(await secure.get('api-token')).toBe('tok-new')
    expect(await plain.get('settings')).not.toContain('tok-stale')
  })

  it('fails open: broken secure writes keep the legacy copy readable', async () => {
    const plain = new MemoryKV()
    const secure = new BrokenKV(new MemoryKV(), 'set')
    await plain.set('settings', legacySettings('tok-123'))

    await migrateApiToken(plain, secure) // must not throw
    expect(await plain.get('settings')).toContain('tok-123') // not scrubbed

    // The token is still usable through the fallback path…
    expect(await loadApiToken(plain, secure)).toBe('tok-123')
  })

  it('fails open when even secure reads are broken', async () => {
    const plain = new MemoryKV()
    const secure = new BrokenKV(new MemoryKV(), 'get')
    await plain.set('settings', legacySettings('tok-123'))

    expect(await loadApiToken(plain, secure)).toBe('tok-123')
    expect(await plain.get('settings')).toContain('tok-123')
  })

  it('returns an empty token when nothing is stored anywhere', async () => {
    expect(await loadApiToken(new MemoryKV(), new MemoryKV())).toBe('')
  })

  it('saveApiToken persists securely and scrubs any legacy copy', async () => {
    const plain = new MemoryKV()
    const secure = new MemoryKV()
    await plain.set('settings', legacySettings('tok-old'))

    await saveApiToken(plain, secure, 'tok-new')

    expect(await secure.get('api-token')).toBe('tok-new')
    expect(await plain.get('settings')).not.toContain('tok-old')
    expect(await loadApiToken(plain, secure)).toBe('tok-new')
  })

  it('saveApiToken with an empty token clears secure storage', async () => {
    const plain = new MemoryKV()
    const secure = new MemoryKV()
    await saveApiToken(plain, secure, 'tok-1')
    await saveApiToken(plain, secure, '')
    expect(await loadApiToken(plain, secure)).toBe('')
  })

  it('saveApiToken throws on a broken Keystore so the caller can react', async () => {
    const plain = new MemoryKV()
    const secure = new BrokenKV(new MemoryKV(), 'set')
    await expect(saveApiToken(plain, secure, 'tok-1')).rejects.toThrow()
  })
})
