package app.hermes.lens;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Pure, static pieces of the notification-capture pipeline: the OTP/2FA
 * filter, content trimming, the stable entry id and the ring-buffer cap.
 *
 * Deliberately free of any android.* import so plain JVM unit tests
 * (src/test) can exercise the exact code the listener service runs — device
 * behaviour is otherwise unverifiable from CI.
 */
final class NotifCapture {

    /** Max stored title length (characters). */
    static final int TITLE_MAX = 200;
    /** Max stored text + bigText length, combined (characters). */
    static final int BODY_MAX = 2000;
    /** Ring buffer capacity: overflow evicts the oldest entries. */
    static final int RING_MAX = 200;

    /**
     * OTP/2FA vocabulary across the app's locales (en/ru/pl + banking codes).
     * Substring match on purpose: "подтверж" catches every inflection of
     * "подтверждение", "verif" catches verify/verification/vérification.
     */
    private static final Pattern OTP_KEYWORD = Pattern.compile(
            "code|код|kod|otp|2fa|verif|подтверж|pin|cvv|cvc|пароль|password|hasło",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    /** A 4–8 digit run with no digit neighbours — the shape of an OTP code. */
    private static final Pattern ISOLATED_DIGITS = Pattern.compile("(?<![0-9])[0-9]{4,8}(?![0-9])");

    private NotifCapture() {}

    /**
     * True when the notification smells like an OTP/2FA/security message: an
     * OTP keyword AND an isolated 4–8 digit code anywhere across
     * title+text+bigText. Such notifications are dropped WHOLE — a bank's
     * transfer-confirmation code must not leave the native layer even though
     * the bank app itself is on the allowlist.
     */
    static boolean looksLikeOtp(String title, String text, String bigText) {
        String combined = safe(title) + "\n" + safe(text) + "\n" + safe(bigText);
        return OTP_KEYWORD.matcher(combined).find()
                && ISOLATED_DIGITS.matcher(combined).find();
    }

    /** Title capped at {@link #TITLE_MAX}. */
    static String trimTitle(String title) {
        String s = safe(title);
        return s.length() <= TITLE_MAX ? s : s.substring(0, TITLE_MAX);
    }

    /**
     * text + bigText share the {@link #BODY_MAX} budget: text first, bigText
     * gets the remainder. Returns {text, bigTextOrNull}; a bigText trimmed to
     * nothing comes back null so the JSON entry omits the field.
     */
    static String[] trimBodies(String text, String bigText) {
        String t = safe(text);
        if (t.length() > BODY_MAX) {
            t = t.substring(0, BODY_MAX);
        }
        String b = bigText;
        if (b != null) {
            int remaining = BODY_MAX - t.length();
            if (b.length() > remaining) {
                b = b.substring(0, remaining);
            }
            if (b.isEmpty()) {
                b = null;
            }
        }
        return new String[] { t, b };
    }

    /**
     * Stable identity of a buffer entry: same notification (re)posted again
     * yields the same id, so the buffer dedups it and the web layer derives
     * the same clientId on replay (see notifDrain.stableClientId).
     */
    static String entryId(String pkg, long postTime, String title, String text) {
        return pkg + ":" + postTime + ":" + hash12(safe(title) + "|" + safe(text));
    }

    /** FNV-1a 64-bit, formatted as 12 hex chars (48 bits kept). */
    static String hash12(String s) {
        long h = 0xcbf29ce484222325L;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i);
            h *= 0x100000001b3L;
        }
        return String.format(Locale.US, "%012x", h & 0xFFFFFFFFFFFFL);
    }

    /** Keeps the newest {@code max} entries, evicting from the front (oldest). */
    static List<String> pruneRing(List<String> entries, int max) {
        if (entries.size() <= max) {
            return entries;
        }
        return new ArrayList<>(entries.subList(entries.size() - max, entries.size()));
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }
}
