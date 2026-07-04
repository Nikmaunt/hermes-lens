import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'

describe('settings', () => {
  it('defaults to unconfigured on a fresh install', async () => {
    const settings = await loadSettings(new MemoryKV())
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.configured).toBe(false)
  })

  it('treats a pre-existing API setup as already configured', async () => {
    const kv = new MemoryKV()
    await kv.set(
      'settings',
      JSON.stringify({ source: 'api', apiBaseUrl: 'http://hermes-vps:8787', appLock: false }),
    )
    const settings = await loadSettings(kv)
    expect(settings.configured).toBe(true)
  })

  it('makes pre-existing mock users choose explicitly', async () => {
    const kv = new MemoryKV()
    await kv.set('settings', JSON.stringify({ source: 'mock' }))
    const settings = await loadSettings(kv)
    expect(settings.configured).toBe(false)
  })

  it('round-trips the configured flag once saved', async () => {
    const kv = new MemoryKV()
    await saveSettings(kv, { ...DEFAULT_SETTINGS, source: 'mock', configured: true })
    const settings = await loadSettings(kv)
    expect(settings.configured).toBe(true)
    expect(settings.source).toBe('mock')
  })

  it('ignores a legacy plaintext apiToken field without failing', async () => {
    const kv = new MemoryKV()
    await kv.set(
      'settings',
      JSON.stringify({ source: 'api', apiBaseUrl: 'http://x', apiToken: 'legacy' }),
    )
    const settings = await loadSettings(kv)
    expect(settings.apiBaseUrl).toBe('http://x')
    expect('apiToken' in settings).toBe(false)
  })
})
