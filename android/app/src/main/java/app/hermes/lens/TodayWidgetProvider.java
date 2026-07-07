package app.hermes.lens;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Home-screen widget with the Today summary.
 *
 * Data flow: the web app writes a versioned JSON summary (v2, composed in
 * src/features/widget/composeSummary.ts) into the Capacitor Preferences store
 * (SharedPreferences "CapacitorStorage") every time the Today screen
 * refreshes, then pings {@link WidgetBridgePlugin#refresh}. updatePeriodMillis
 * is 0 — the widget never polls or wakes the device; it only refreshes while
 * the app itself is running.
 *
 * The parser keeps a v1 fallback for the upgrade window: an old summary in
 * storage must render (degraded, never crash) until the app is first opened.
 */
public class TodayWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_FILE = "CapacitorStorage";
    private static final String SUMMARY_KEY = "widget:summary";

    /** Mirrors WIDGET_STALE_MS in composeSummary.ts — change both together. */
    private static final long STALE_AFTER_MS = 24L * 3_600_000L;

    /** Below this height (dp) the widget collapses to the one-line layout. */
    private static final int COMPACT_MAX_HEIGHT_DP = 100;

    private static final int[] ROW_IDS = { R.id.widget_row1, R.id.widget_row2, R.id.widget_row3 };
    private static final int[] TITLE_IDS = { R.id.widget_row1_title, R.id.widget_row2_title, R.id.widget_row3_title };
    private static final int[] BADGE_IDS = { R.id.widget_row1_badge, R.id.widget_row2_badge, R.id.widget_row3_badge };

    /** Parsed summary, degraded gracefully for v1 or missing payloads. */
    private static final class Summary {
        boolean present; // any payload at all
        boolean v2;
        boolean masked;
        final List<String> titles = new ArrayList<>();
        final List<String> dues = new ArrayList<>();
        int followUpCount;
        int inbox;
        String deadline = ""; // empty = none
        String health = "";   // empty = unknown (v1)
        String updatedAt = "";
        long updatedAtEpoch;  // 0 = unknown (v1)
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) {
            update(context, manager, id);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
                                          int widgetId, Bundle newOptions) {
        // Resize on pre-31 launchers: re-pick the layout for the new cell size.
        update(context, manager, widgetId);
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
        // Defense-in-depth: a widget must never take down its host. This runs
        // both from the AppWidget receiver (onUpdate) and, via
        // WidgetBridgePlugin.refresh → updateAll, on the app's own bridge
        // thread — so an unhandled RuntimeException here crashes not just the
        // widget but the whole app. Any build failure degrades to a minimal
        // fallback; if even that fails we swallow it rather than propagate.
        try {
            manager.updateAppWidget(widgetId, buildViews(context, manager, widgetId));
        } catch (Throwable t) {
            try {
                manager.updateAppWidget(widgetId, fallbackViews(context));
            } catch (Throwable ignored) {
                // Nothing more can be done safely; never propagate to the host.
            }
        }
    }

    private static RemoteViews buildViews(Context context, AppWidgetManager manager, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
        Summary s = parse(prefs.getString(SUMMARY_KEY, null));
        PendingIntent open = openAppIntent(context);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // The launcher picks the tightest layout for the current cell size.
            // The click intent MUST be attached to each child BEFORE they are
            // combined: setOnClickPendingIntent on the Map-composed RemoteViews
            // throws (it is immutable after construction), and unhandled that
            // exception killed the whole app on API 31+.
            RemoteViews compactView = renderCompact(context, s);
            compactView.setOnClickPendingIntent(R.id.widget_root, open);
            RemoteViews fullView = renderFull(context, s);
            fullView.setOnClickPendingIntent(R.id.widget_root, open);

            Map<SizeF, RemoteViews> sizes = new HashMap<>();
            sizes.put(new SizeF(180f, 40f), compactView);
            sizes.put(new SizeF(180f, (float) COMPACT_MAX_HEIGHT_DP), fullView);
            return new RemoteViews(sizes);
        }

        Bundle options = manager.getAppWidgetOptions(widgetId);
        int minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT);
        boolean compact = minHeight > 0 && minHeight < COMPACT_MAX_HEIGHT_DP;
        RemoteViews views = compact ? renderCompact(context, s) : renderFull(context, s);
        views.setOnClickPendingIntent(R.id.widget_root, open);
        return views;
    }

    /** Minimal never-fail widget used only when {@link #buildViews} throws. */
    private static RemoteViews fallbackViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_compact);
        views.setTextViewText(R.id.widget_compact_line, "Open the app to sync");
        views.setViewVisibility(R.id.widget_compact_dot, android.view.View.GONE);
        views.setTextViewText(R.id.widget_compact_updated, "");
        views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context));
        return views;
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent open = new Intent(context, MainActivity.class);
        return PendingIntent.getActivity(
                context, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ---------------------------------------------------------------- parse

    private static Summary parse(String raw) {
        Summary s = new Summary();
        if (raw == null) return s;
        try {
            JSONObject json = new JSONObject(raw);
            s.present = true;
            s.masked = json.optBoolean("masked", false);
            if (json.optInt("v", 1) >= 2) {
                s.v2 = true;
                JSONArray rows = json.optJSONArray("followUps");
                if (rows != null) {
                    for (int i = 0; i < rows.length() && i < ROW_IDS.length; i++) {
                        JSONObject row = rows.optJSONObject(i);
                        if (row == null) continue;
                        s.titles.add(row.optString("title", ""));
                        s.dues.add(row.optString("due", ""));
                    }
                }
                s.followUpCount = json.optInt("followUpCount", 0);
                s.inbox = json.optInt("inbox", 0);
                // JSON null → empty string, either way "no deadline".
                s.deadline = json.isNull("deadline") ? "" : json.optString("deadline", "");
                s.health = json.optString("health", "");
                s.updatedAtEpoch = json.optLong("updatedAtEpoch", 0L);
            } else {
                // v1: followUps/inbox are plain counts, no health, no epoch.
                s.followUpCount = json.optInt("followUps", 0);
                s.inbox = json.optInt("inbox", 0);
                s.deadline = json.optString("deadline", "");
            }
            s.updatedAt = json.optString("updatedAt", "");
        } catch (JSONException ignored) {
            // Corrupt summary: keep the "open the app" fallback.
            s.present = false;
        }
        return s;
    }

    // --------------------------------------------------------------- render

    /** "updated 14:05", prefixed with "stale · " after 24h without a write. */
    private static String stamp(Summary s) {
        if (s.updatedAt.isEmpty()) return "";
        boolean stale = s.updatedAtEpoch > 0
                && System.currentTimeMillis() - s.updatedAtEpoch > STALE_AFTER_MS;
        return stale ? "stale · " + s.updatedAt : "updated " + s.updatedAt;
    }

    private static int healthColor(Context context, String health) {
        if (health.startsWith("ok")) return context.getColor(R.color.widget_ok);
        if (health.isEmpty() || health.equals("no data")) return context.getColor(R.color.widget_faint);
        if (health.equals("agent offline")) return context.getColor(R.color.widget_overdue);
        return context.getColor(R.color.widget_warn); // cron error, backup issues
    }

    private static RemoteViews renderFull(Context context, Summary s) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        views.setTextViewText(R.id.widget_updated, stamp(s));

        for (int id : ROW_IDS) views.setViewVisibility(id, android.view.View.GONE);
        views.setViewVisibility(R.id.widget_message, android.view.View.GONE);

        if (!s.present) {
            showMessage(views, "Open the app to sync");
            views.setTextViewText(R.id.widget_deadline, "");
            views.setTextViewText(R.id.widget_health, "");
            return views;
        }

        if (s.masked) {
            // Locked: brand, health and stamp only — no titles, no numbers.
            showMessage(views, "Hermes Lens");
            views.setTextViewText(R.id.widget_deadline, "");
            setHealth(context, views, s.health);
            return views;
        }

        if (!s.v2) {
            // Upgrade window: old payload still renders its counts line.
            showMessage(views, s.followUpCount + " follow-ups · " + s.inbox + " inbox");
        } else if (s.titles.isEmpty()) {
            showMessage(views, "No open follow-ups");
        } else {
            for (int i = 0; i < s.titles.size(); i++) {
                views.setViewVisibility(ROW_IDS[i], android.view.View.VISIBLE);
                views.setTextViewText(TITLE_IDS[i], s.titles.get(i));
                renderBadge(context, views, BADGE_IDS[i], s.dues.get(i));
            }
        }

        views.setTextViewText(R.id.widget_deadline,
                s.deadline.isEmpty() ? (s.v2 ? "no deadlines in 30d" : "") : s.deadline);
        setHealth(context, views, s.health);
        return views;
    }

    private static void showMessage(RemoteViews views, String text) {
        views.setViewVisibility(R.id.widget_message, android.view.View.VISIBLE);
        views.setTextViewText(R.id.widget_message, text);
    }

    private static void setHealth(Context context, RemoteViews views, String health) {
        views.setTextViewText(R.id.widget_health, health);
        views.setTextColor(R.id.widget_health, healthColor(context, health));
    }

    private static void renderBadge(Context context, RemoteViews views, int badgeId, String due) {
        String text;
        int bg;
        int color;
        switch (due) {
            case "overdue":
                text = "!";
                bg = R.drawable.widget_badge_overdue;
                color = context.getColor(R.color.widget_overdue);
                break;
            case "today":
                text = "today";
                bg = R.drawable.widget_badge_today;
                color = context.getColor(R.color.widget_accent);
                break;
            default: // "2d", "soon", …
                text = due;
                bg = R.drawable.widget_badge_neutral;
                color = context.getColor(R.color.widget_muted);
                break;
        }
        views.setTextViewText(badgeId, text);
        views.setTextColor(badgeId, color);
        views.setInt(badgeId, "setBackgroundResource", bg);
        views.setViewVisibility(badgeId,
                text.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
    }

    private static RemoteViews renderCompact(Context context, Summary s) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_compact);

        String line;
        if (!s.present) {
            line = "Open the app to sync";
        } else if (s.masked) {
            line = "Hermes Lens";
        } else if (!s.v2) {
            line = s.followUpCount + " follow-ups · " + s.inbox + " inbox";
        } else if (s.followUpCount == 0) {
            line = "All clear";
        } else {
            String next = s.titles.isEmpty() ? "" : s.titles.get(0);
            String due = s.dues.isEmpty() ? "" : s.dues.get(0);
            String marker = due.equals("overdue") ? " (!)" : due.isEmpty() ? "" : " (" + due + ")";
            line = s.followUpCount + (s.followUpCount == 1 ? " task" : " tasks")
                    + " · next: " + next + marker;
        }
        views.setTextViewText(R.id.widget_compact_line, line);

        views.setTextColor(R.id.widget_compact_dot, healthColor(context, s.health));
        views.setViewVisibility(R.id.widget_compact_dot,
                s.present ? android.view.View.VISIBLE : android.view.View.GONE);
        views.setTextViewText(R.id.widget_compact_updated, stamp(s));
        return views;
    }
}
