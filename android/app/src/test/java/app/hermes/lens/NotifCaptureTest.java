package app.hermes.lens;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * JVM tests for the pure pieces of the capture pipeline. Device behaviour
 * (binding, SharedPreferences, the buffer file) is covered by the manual
 * checklist; everything filter-shaped lives here.
 */
public class NotifCaptureTest {

    // ------------------------------------------------------------ OTP filter

    @Test
    public void bankTransferConfirmationCodeIsDropped() {
        // The main OTP leak path: the bank app IS on the allowlist, and the
        // notification carries a transfer-confirmation code. Must drop whole.
        assertTrue(NotifCapture.looksLikeOtp(
                "СберБанк",
                "Перевод 5 000 ₽ получателю И. Иванов. Код подтверждения: 39284. Никому не сообщайте.",
                null));
    }

    @Test
    public void englishVerificationCodeIsDropped() {
        assertTrue(NotifCapture.looksLikeOtp(
                "Google", "Your verification code is 483920", null));
    }

    @Test
    public void twoFactorCodeInBigTextOnlyIsDropped() {
        assertTrue(NotifCapture.looksLikeOtp(
                "Mail", "New message",
                "2FA: use 771204 to finish signing in"));
    }

    @Test
    public void polishOneTimePasswordIsDropped() {
        assertTrue(NotifCapture.looksLikeOtp(
                "Bank", "Twoje jednorazowe hasło: 1234", null));
    }

    @Test
    public void upperCaseCyrillicKeywordIsDropped() {
        // UNICODE_CASE: "КОД" must match "код" case-insensitively.
        assertTrue(NotifCapture.looksLikeOtp(
                "Банк", "КОД ПОДТВЕРЖДЕНИЯ 4821", null));
    }

    @Test
    public void pinAndCvvStyleMessagesAreDropped() {
        assertTrue(NotifCapture.looksLikeOtp("Card", "Your new PIN is 0412", null));
        assertTrue(NotifCapture.looksLikeOtp("Card", "CVV 8891 for the virtual card", null));
    }

    @Test
    public void ordinaryMessageWithoutKeywordsIsKept() {
        assertFalse(NotifCapture.looksLikeOtp(
                "Мария", "Встречаемся завтра в 14:30 у входа", null));
    }

    @Test
    public void keywordWithoutIsolatedDigitsIsKept() {
        // "password" alone, no 4-8 digit code → not an OTP.
        assertFalse(NotifCapture.looksLikeOtp(
                "GitHub", "Your password was changed successfully", null));
    }

    @Test
    public void digitsWithoutKeywordAreKept() {
        assertFalse(NotifCapture.looksLikeOtp(
                "DHL", "Paket 4821 wurde zugestellt", null));
    }

    @Test
    public void longDigitRunsDoNotCountAsCodes() {
        // 9+ digits (order numbers, phone numbers) are not isolated 4-8 runs.
        assertFalse(NotifCapture.looksLikeOtp(
                "Shop", "Код заказа 123456789 готов к выдаче", null));
    }

    @Test
    public void digitsEmbeddedInLongerRunsAreNotIsolated() {
        assertFalse(NotifCapture.looksLikeOtp(
                "Bank", "Verification of account 12345678901234 complete", null));
    }

    @Test
    public void nullFieldsNeverThrow() {
        assertFalse(NotifCapture.looksLikeOtp(null, null, null));
        assertTrue(NotifCapture.looksLikeOtp(null, "code 4821", null));
    }

    // ------------------------------------------------------------- trimming

    @Test
    public void titleIsCappedAt200() {
        String title = repeat('t', 300);
        assertEquals(200, NotifCapture.trimTitle(title).length());
        assertEquals("short", NotifCapture.trimTitle("short"));
        assertEquals("", NotifCapture.trimTitle(null));
    }

    @Test
    public void textAndBigTextShareThe2000Budget() {
        String[] bodies = NotifCapture.trimBodies(repeat('a', 1500), repeat('b', 1500));
        assertEquals(1500, bodies[0].length());
        assertEquals(500, bodies[1].length());
    }

    @Test
    public void oversizedTextConsumesTheWholeBudget() {
        String[] bodies = NotifCapture.trimBodies(repeat('a', 2500), repeat('b', 10));
        assertEquals(2000, bodies[0].length());
        // bigText trimmed to nothing → null, so the JSON field is omitted.
        assertNull(bodies[1]);
    }

    @Test
    public void missingBigTextStaysNull() {
        String[] bodies = NotifCapture.trimBodies("hello", null);
        assertEquals("hello", bodies[0]);
        assertNull(bodies[1]);
    }

    @Test
    public void nullTextBecomesEmptyString() {
        assertEquals("", NotifCapture.trimBodies(null, null)[0]);
    }

    // ------------------------------------------------------------- entry id

    @Test
    public void entryIdIsStableAcrossRepeatedPosts() {
        String a = NotifCapture.entryId("com.whatsapp", 1720000000000L, "Clara", "See you at 5");
        String b = NotifCapture.entryId("com.whatsapp", 1720000000000L, "Clara", "See you at 5");
        assertEquals(a, b);
    }

    @Test
    public void entryIdChangesWithContentTimeAndPackage() {
        String base = NotifCapture.entryId("com.whatsapp", 1720000000000L, "Clara", "See you at 5");
        assertNotEquals(base, NotifCapture.entryId("com.whatsapp", 1720000000000L, "Clara", "See you at 6"));
        assertNotEquals(base, NotifCapture.entryId("com.whatsapp", 1720000000001L, "Clara", "See you at 5"));
        assertNotEquals(base, NotifCapture.entryId("org.telegram.messenger", 1720000000000L, "Clara", "See you at 5"));
    }

    @Test
    public void entryIdEmbedsPackageAndPostTime() {
        String id = NotifCapture.entryId("com.whatsapp", 1720000000000L, "t", "x");
        assertTrue(id.startsWith("com.whatsapp:1720000000000:"));
        // 12 hex chars of content hash after the second colon.
        assertEquals(12, id.substring("com.whatsapp:1720000000000:".length()).length());
    }

    // ----------------------------------------------------------------- ring

    @Test
    public void ringKeepsTheNewest200() {
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < 205; i++) {
            lines.add("entry-" + i);
        }
        List<String> pruned = NotifCapture.pruneRing(lines, NotifCapture.RING_MAX);
        assertEquals(200, pruned.size());
        assertEquals("entry-5", pruned.get(0));    // oldest five evicted
        assertEquals("entry-204", pruned.get(199)); // newest kept
    }

    @Test
    public void ringLeavesSmallBuffersUntouched() {
        List<String> lines = new ArrayList<>();
        lines.add("only");
        assertSame(lines, NotifCapture.pruneRing(lines, NotifCapture.RING_MAX));
    }

    private static String repeat(char c, int n) {
        StringBuilder sb = new StringBuilder(n);
        for (int i = 0; i < n; i++) {
            sb.append(c);
        }
        return sb.toString();
    }
}
