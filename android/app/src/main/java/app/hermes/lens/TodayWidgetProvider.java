package app.hermes.lens;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Home-screen widget with the Today summary.
 *
 * Data flow: the web app writes a compact JSON summary into the Capacitor
 * Preferences store (SharedPreferences "CapacitorStorage") every time the
 * Today screen refreshes, then pings {@link WidgetBridgePlugin#refresh}.
 * updatePeriodMillis is 0 — the widget never polls or wakes the device;
 * it only refreshes while the app itself is running.
 */
public class TodayWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_FILE = "CapacitorStorage";
    private static final String SUMMARY_KEY = "widget:summary";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) {
            update(context, manager, id);
        }
    }

    /** Refresh every placed instance of the widget. */
    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidgetProvider.class));
        for (int id : ids) {
            update(context, manager, id);
        }
    }

    private static void update(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
        String raw = prefs.getString(SUMMARY_KEY, null);

        String counts = "Open the app to sync";
        String deadline = "";
        String updated = "";
        if (raw != null) {
            try {
                JSONObject json = new JSONObject(raw);
                if (json.optBoolean("masked", false)) {
                    // "Hide widget details when locked" is on: no counts, no titles.
                    counts = "Hermes Lens";
                    deadline = "Unlock the app for details";
                } else {
                    counts = json.optInt("followUps", 0) + " follow-ups · "
                            + json.optInt("inbox", 0) + " inbox";
                    deadline = json.optString("deadline", "");
                }
                updated = json.optString("updatedAt", "");
            } catch (JSONException ignored) {
                // Corrupt summary: keep the fallback text.
            }
        }

        views.setTextViewText(R.id.widget_counts, counts);
        views.setTextViewText(R.id.widget_deadline, deadline);
        views.setTextViewText(R.id.widget_updated, updated);

        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(
                context, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_root, pending);

        manager.updateAppWidget(widgetId, views);
    }
}
