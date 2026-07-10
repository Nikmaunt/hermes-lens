package app.hermes.lens;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Captures posted notifications into the on-disk ring buffer that
 * {@link NotifBridgePlugin} serves to the web layer (web-drain design: the
 * native side only buffers to disk — no network, no token, no Keystore).
 *
 * A chain of stop-filters runs BEFORE anything is written:
 *   1. notif:config gate — missing config or enabled=false drops everything;
 *   2. allowlist gate — nothing from a non-whitelisted package leaves this layer;
 *   3. group summaries are skeletons of their children — drop;
 *   4. ongoing notifications (media players, foreground services) — drop;
 *   5. OTP/2FA-looking content is dropped WHOLE, allowlisted app or not.
 *
 * Defense-in-depth (widget-incident lesson): the whole handler body is under
 * try/catch(Throwable) — a capture failure silently drops that one event and
 * never crashes the process. Notification content is never logged.
 */
public class HermesNotificationListenerService extends NotificationListenerService {

    /** Capacitor Preferences' SharedPreferences file (same store the web writes). */
    private static final String PREFS_FILE = "CapacitorStorage";
    /** Out-of-band config mirror written by the web layer on every settings save. */
    private static final String CONFIG_KEY = "notif:config";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            capture(sbn);
        } catch (Throwable ignored) {
            // Silently drop the event. Never rethrow (a listener exception
            // takes down the whole process), never log its content.
        }
    }

    private void capture(StatusBarNotification sbn) throws Exception {
        if (sbn == null) {
            return;
        }

        // 1. Config gate.
        SharedPreferences prefs = getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
        String rawConfig = prefs.getString(CONFIG_KEY, null);
        if (rawConfig == null) {
            return;
        }
        JSONObject config = new JSONObject(rawConfig);
        if (!config.optBoolean("enabled", false)) {
            return;
        }

        // 2. Allowlist gate.
        String pkg = sbn.getPackageName();
        if (pkg == null || !allowlisted(config.optJSONArray("allowlist"), pkg)) {
            return;
        }

        // 3 + 4. Structural noise.
        Notification notification = sbn.getNotification();
        if (notification == null) {
            return;
        }
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
            return;
        }
        if (sbn.isOngoing()) {
            return;
        }

        Bundle extras = notification.extras;
        if (extras == null) {
            return;
        }
        String title = asString(extras, Notification.EXTRA_TITLE);
        String text = asString(extras, Notification.EXTRA_TEXT);
        String bigText = asString(extras, Notification.EXTRA_BIG_TEXT);

        // 5. OTP/2FA gate — the whole notification is dropped.
        if (NotifCapture.looksLikeOtp(title, text, bigText)) {
            return;
        }

        String trimmedTitle = NotifCapture.trimTitle(title);
        String[] bodies = NotifCapture.trimBodies(text, bigText);
        String id = NotifCapture.entryId(pkg, sbn.getPostTime(), trimmedTitle, bodies[0]);

        // JSONObject.toString() escapes newlines — each entry stays one line.
        JSONObject entry = new JSONObject();
        entry.put("id", id);
        entry.put("package", pkg);
        entry.put("postedAt", iso8601(sbn.getPostTime()));
        entry.put("capturedAt", iso8601(System.currentTimeMillis()));
        entry.put("title", trimmedTitle);
        entry.put("text", bodies[0]);
        if (bodies[1] != null) {
            entry.put("bigText", bodies[1]);
        }

        NotifBufferStore.append(getFilesDir(), id, entry.toString());
    }

    private static boolean allowlisted(JSONArray allowlist, String pkg) {
        if (allowlist == null) {
            return false;
        }
        for (int i = 0; i < allowlist.length(); i++) {
            if (pkg.equals(allowlist.optString(i))) {
                return true;
            }
        }
        return false;
    }

    private static String asString(Bundle extras, String key) {
        CharSequence value = extras.getCharSequence(key);
        return value == null ? null : value.toString();
    }

    private static String iso8601(long epochMs) {
        SimpleDateFormat format =
                new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(epochMs));
    }
}
