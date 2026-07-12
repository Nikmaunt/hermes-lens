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
    /**
     * Max stored text + bigText size, combined, in UTF-8 BYTES. The sidecar
     * caps a stored capture at 4 KiB of UTF-8; 3800 leaves headroom for the
     * frontmatter it adds. A character cap would drift from that byte cap by
     * up to 4× on emoji/CJK content.
     */
    static final int BODY_MAX_BYTES = 3800;
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
     * text + bigText share the {@link #BODY_MAX_BYTES} budget: text first,
     * bigText gets the remainder. The budget is UTF-8 bytes (matching the
     * sidecar's byte cap), and cuts land on code point boundaries — a
     * surrogate pair is kept or dropped whole, never split into lone halves.
     * Returns {text, bigTextOrNull}; a bigText trimmed to nothing comes back
     * null so the JSON entry omits the field.
     */
    static String[] trimBodies(String text, String bigText) {
        String t = trimUtf8(safe(text), BODY_MAX_BYTES);
        String b = bigText;
        if (b != null) {
            b = trimUtf8(b, BODY_MAX_BYTES - utf8Length(t));
            if (b.isEmpty()) {
                b = null;
            }
        }
        return new String[] { t, b };
    }

    /**
     * Longest prefix of {@code s} that fits {@code maxBytes} of UTF-8. Walks
     * code points, so a supplementary character (emoji — a surrogate pair in
     * UTF-16) that does not fully fit is dropped whole; the result never ends
     * in a lone surrogate.
     */
    static String trimUtf8(String s, int maxBytes) {
        int bytes = 0;
        int i = 0;
        while (i < s.length()) {
            int cp = s.codePointAt(i);
            int cpBytes = utf8Bytes(cp);
            if (bytes + cpBytes > maxBytes) {
                break;
            }
            bytes += cpBytes;
            i += Character.charCount(cp);
        }
        return i == s.length() ? s : s.substring(0, i);
    }

    /** UTF-8 byte length of {@code s} (code point walk, no encoding pass). */
    static int utf8Length(String s) {
        int bytes = 0;
        int i = 0;
        while (i < s.length()) {
            int cp = s.codePointAt(i);
            bytes += utf8Bytes(cp);
            i += Character.charCount(cp);
        }
        return bytes;
    }

    /** UTF-8 byte size of one code point (1 for ASCII … 4 for emoji). */
    private static int utf8Bytes(int cp) {
        if (cp < 0x80) {
            return 1;
        }
        if (cp < 0x800) {
            return 2;
        }
        if (cp < 0x10000) {
            return 3;
        }
        return 4;
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
