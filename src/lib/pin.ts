import type { KV } from '@/data/kv'

const PIN_KEY = 'pin-credential'
export const PIN_LENGTH = 6

interface StoredPin {
  saltHex: string
  hashHex: string
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return bytesToHex(new Uint8Array(digest))
}

export async function setPin(kv: KV, pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = bytesToHex(salt)
  const stored: StoredPin = { saltHex, hashHex: await sha256Hex(saltHex + pin) }
  await kv.set(PIN_KEY, JSON.stringify(stored))
}

export async function verifyPin(kv: KV, pin: string): Promise<boolean> {
  const raw = await kv.get(PIN_KEY)
  if (raw === null) return false
  try {
    const stored = JSON.parse(raw) as StoredPin
    return (await sha256Hex(stored.saltHex + pin)) === stored.hashHex
  } catch {
    return false
  }
}

export async function hasPin(kv: KV): Promise<boolean> {
  return (await kv.get(PIN_KEY)) !== null
}

export async function clearPin(kv: KV): Promise<void> {
  await kv.remove(PIN_KEY)
}
