import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { Capacitor } from '@capacitor/core'

/** True when the device offers biometry we can use. Always false on web dev. */
export async function biometryAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await BiometricAuth.checkBiometry()
    return result.isAvailable
  } catch {
    return false
  }
}

/** Run the native biometric prompt. Resolves false on cancel/failure. */
export async function biometricAuthenticate(reason: string): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Use PIN',
      androidTitle: 'Hermes Lens',
      androidSubtitle: reason,
      allowDeviceCredential: false, // our own PIN pad is the fallback
    })
    return true
  } catch {
    return false
  }
}
