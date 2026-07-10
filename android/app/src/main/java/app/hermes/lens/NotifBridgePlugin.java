package app.hermes.lens;

import android.content.Intent;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Native side of the NotifBridge contract frozen in
 * src/features/notifications/notifBridge.ts — the four methods and the
 * BufferedNotification shape must match it verbatim.
 *
 * Every method body is wrapped: a failure rejects the call (no content in the
 * message) and never crashes the process.
 */
@CapacitorPlugin(name = "NotifBridge")
public class NotifBridgePlugin extends Plugin {

    /** Reads the whole buffer, oldest first, WITHOUT removing anything. */
    @PluginMethod
    public void consumeBuffered(PluginCall call) {
        try {
            List<String> lines = NotifBufferStore.readLines(getContext().getFilesDir());
            JSArray items = new JSArray();
            for (String line : lines) {
                try {
                    items.put(new JSObject(line));
                } catch (Throwable ignored) {
                    // Corrupt line: skip it, keep serving the rest.
                }
            }
            JSObject ret = new JSObject();
            ret.put("items", items);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("consumeBuffered failed");
        }
    }

    /** Drops buffer entries up to and including {@code upToId}. */
    @PluginMethod
    public void ackBuffered(PluginCall call) {
        try {
            String upToId = call.getString("upToId");
            if (upToId == null || upToId.isEmpty()) {
                call.reject("upToId is required");
                return;
            }
            NotifBufferStore.ackUpTo(getContext().getFilesDir(), upToId);
            call.resolve();
        } catch (Throwable t) {
            call.reject("ackBuffered failed");
        }
    }

    /** Whether the OS-level notification-listener access is granted. */
    @PluginMethod
    public void isServiceEnabled(PluginCall call) {
        try {
            boolean enabled = NotificationManagerCompat
                    .getEnabledListenerPackages(getContext())
                    .contains(getContext().getPackageName());
            JSObject ret = new JSObject();
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("isServiceEnabled failed");
        }
    }

    /** Opens the system "notification access" settings screen. */
    @PluginMethod
    public void openSystemSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Throwable t) {
            call.reject("openSystemSettings failed");
        }
    }
}
