package app.hermes.lens;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands text shared via ACTION_SEND to the web layer.
 *
 * Cold start: MainActivity stores the text before the bridge exists; the web
 * app pulls it once on boot via {@link #consumePendingShare}. Warm start
 * (activity already running, onNewIntent): {@link #notifyShare} pushes a
 * "share" event; retainUntilConsumed covers the gap until a listener attaches.
 */
@CapacitorPlugin(name = "ShareBridge")
public class ShareBridgePlugin extends Plugin {

    private static ShareBridgePlugin active;

    @Override
    public void load() {
        active = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (active == this) {
            active = null;
        }
    }

    @PluginMethod
    public void consumePendingShare(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("text", MainActivity.pendingSharedText);
        MainActivity.pendingSharedText = null;
        call.resolve(ret);
    }

    static void notifyShare() {
        if (active == null || MainActivity.pendingSharedText == null) {
            return;
        }
        JSObject data = new JSObject();
        data.put("text", MainActivity.pendingSharedText);
        MainActivity.pendingSharedText = null;
        active.notifyListeners("share", data, true);
    }
}
