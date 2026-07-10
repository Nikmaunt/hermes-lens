import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { NOTIF_CONFIG_KEY, looksLikePackageName, writeNotifConfig } from './notifConfig'

describe('notif:config out-of-band channel', () => {
  it('writes the versioned JSON config under notif:config', async () => {
    const kv = new MemoryKV()
    await writeNotifConfig(kv, { enabled: true, allowlist: ['com.whatsapp', 'org.telegram.messenger'] })

    const raw = await kv.get(NOTIF_CONFIG_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '')).toEqual({
      enabled: true,
      allowlist: ['com.whatsapp', 'org.telegram.messenger'],
      v: 1,
    })
  })

  it('overwrites on every change — last write wins', async () => {
    const kv = new MemoryKV()
    await writeNotifConfig(kv, { enabled: true, allowlist: ['com.whatsapp'] })
    await writeNotifConfig(kv, { enabled: false, allowlist: [] })
    expect(JSON.parse((await kv.get(NOTIF_CONFIG_KEY)) ?? '')).toEqual({
      enabled: false,
      allowlist: [],
      v: 1,
    })
  })
})

describe('looksLikePackageName', () => {
  it('accepts real-world Android package names', () => {
    expect(looksLikePackageName('com.whatsapp')).toBe(true)
    expect(looksLikePackageName('org.telegram.messenger')).toBe(true)
    expect(looksLikePackageName('com.google.android.gm')).toBe(true)
    expect(looksLikePackageName('io.github.some_app.v2')).toBe(true)
  })

  it('rejects strings that are not package names', () => {
    expect(looksLikePackageName('')).toBe(false)
    expect(looksLikePackageName('whatsapp')).toBe(false) // no dot
    expect(looksLikePackageName('com..whatsapp')).toBe(false) // empty segment
    expect(looksLikePackageName('com.whatsapp.')).toBe(false) // trailing dot
    expect(looksLikePackageName('1com.whatsapp')).toBe(false) // digit-led segment
    expect(looksLikePackageName('com.whats app')).toBe(false) // whitespace
    expect(looksLikePackageName('WhatsApp notifications')).toBe(false)
  })
})
