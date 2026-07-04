package app.hermes.lens;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Text shared into the app before the web layer is ready to receive it
     * (cold start). The web app collects it via ShareBridge.consumePendingShare.
     */
    static String pendingSharedText;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(ShareBridgePlugin.class);
        super.onCreate(savedInstanceState);
        captureShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (captureShare(intent)) {
            // Warm start: the web layer is live, push the share as an event.
            ShareBridgePlugin.notifyShare();
        }
    }

    /** Stores ACTION_SEND text/plain payloads; returns true when one arrived. */
    private boolean captureShare(Intent intent) {
        if (intent == null
                || !Intent.ACTION_SEND.equals(intent.getAction())
                || !"text/plain".equals(intent.getType())) {
            return false;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text == null || text.isEmpty()) {
            text = subject;
        } else if (subject != null && !subject.isEmpty() && !text.contains(subject)) {
            text = subject + "\n" + text;
        }
        if (text == null || text.isEmpty()) {
            return false;
        }
        pendingSharedText = text;
        return true;
    }
}
