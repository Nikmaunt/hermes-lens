package app.hermes.lens;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;

/**
 * Minimal calendar access for the reminders sync (F14).
 *
 * The default target is a local calendar (ACCOUNT_TYPE_LOCAL) created through
 * the CALLER_IS_SYNCADAPTER URI — it lives only on this device and never
 * syncs to any cloud. Event identity is kept by the web layer (reminderId →
 * event _ID map), because SYNC_DATA*, or ExtendedProperties, are writable by
 * sync adapters only.
 *
 * No background work: every method runs on demand from the foreground app.
 */
@CapacitorPlugin(
        name = "CalendarBridge",
        permissions = @Permission(
                alias = "calendar",
                strings = {Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR}
        )
)
public class CalendarBridgePlugin extends Plugin {

    private static final String LOCAL_ACCOUNT = "Hermes";
    private static final int CALENDAR_COLOR = 0xFFE3B458; // app accent

    private Uri localSyncAdapterUri() {
        return CalendarContract.Calendars.CONTENT_URI.buildUpon()
                .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
                .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, LOCAL_ACCOUNT)
                .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,
                        CalendarContract.ACCOUNT_TYPE_LOCAL)
                .build();
    }

    /** All calendars the user could write events into (access >= contributor). */
    @PluginMethod
    public void listCalendars(PluginCall call) {
        ContentResolver resolver = getContext().getContentResolver();
        JSArray calendars = new JSArray();
        String[] projection = {
                CalendarContract.Calendars._ID,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                CalendarContract.Calendars.ACCOUNT_NAME,
                CalendarContract.Calendars.ACCOUNT_TYPE,
                CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
        };
        try (Cursor cursor = resolver.query(
                CalendarContract.Calendars.CONTENT_URI, projection, null, null,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME + " ASC")) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    int access = cursor.getInt(4);
                    if (access < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) {
                        continue;
                    }
                    JSObject cal = new JSObject();
                    cal.put("id", String.valueOf(cursor.getLong(0)));
                    cal.put("name", cursor.getString(1));
                    cal.put("account", cursor.getString(2));
                    cal.put("isLocal", CalendarContract.ACCOUNT_TYPE_LOCAL.equals(cursor.getString(3)));
                    calendars.put(cal);
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("calendars", calendars);
        call.resolve(ret);
    }

    /** Find or create the on-device "Hermes" calendar. */
    @PluginMethod
    public void ensureLocalCalendar(PluginCall call) {
        ContentResolver resolver = getContext().getContentResolver();
        String selection = CalendarContract.Calendars.ACCOUNT_TYPE + " = ? AND "
                + CalendarContract.Calendars.NAME + " = ?";
        String[] args = {CalendarContract.ACCOUNT_TYPE_LOCAL, LOCAL_ACCOUNT};
        try (Cursor cursor = resolver.query(
                CalendarContract.Calendars.CONTENT_URI,
                new String[]{CalendarContract.Calendars._ID}, selection, args, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                JSObject ret = new JSObject();
                ret.put("id", String.valueOf(cursor.getLong(0)));
                call.resolve(ret);
                return;
            }
        }

        ContentValues values = new ContentValues();
        values.put(CalendarContract.Calendars.ACCOUNT_NAME, LOCAL_ACCOUNT);
        values.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        values.put(CalendarContract.Calendars.NAME, LOCAL_ACCOUNT);
        values.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, LOCAL_ACCOUNT);
        values.put(CalendarContract.Calendars.CALENDAR_COLOR, CALENDAR_COLOR);
        values.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
                CalendarContract.Calendars.CAL_ACCESS_OWNER);
        values.put(CalendarContract.Calendars.OWNER_ACCOUNT, LOCAL_ACCOUNT);
        values.put(CalendarContract.Calendars.VISIBLE, 1);
        values.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
        values.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().getID());

        Uri created = resolver.insert(localSyncAdapterUri(), values);
        if (created == null) {
            call.reject("Could not create the local Hermes calendar");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("id", String.valueOf(ContentUris.parseId(created)));
        call.resolve(ret);
    }

    /** Which of the given event ids still exist in the given calendar. */
    @PluginMethod
    public void queryEvents(PluginCall call) {
        String calendarId = call.getString("calendarId");
        JSArray idsArray = call.getArray("eventIds");
        if (calendarId == null || idsArray == null) {
            call.reject("calendarId and eventIds are required");
            return;
        }
        List<Long> ids = new ArrayList<>();
        try {
            for (int i = 0; i < idsArray.length(); i++) {
                ids.add(idsArray.getLong(i));
            }
        } catch (JSONException e) {
            call.reject("eventIds must be numbers");
            return;
        }

        JSArray existing = new JSArray();
        if (!ids.isEmpty()) {
            StringBuilder placeholders = new StringBuilder();
            String[] args = new String[ids.size() + 1];
            args[0] = calendarId;
            for (int i = 0; i < ids.size(); i++) {
                placeholders.append(i == 0 ? "?" : ",?");
                args[i + 1] = String.valueOf(ids.get(i));
            }
            String selection = CalendarContract.Events.CALENDAR_ID + " = ? AND "
                    + CalendarContract.Events._ID + " IN (" + placeholders + ") AND "
                    + CalendarContract.Events.DELETED + " = 0";
            try (Cursor cursor = getContext().getContentResolver().query(
                    CalendarContract.Events.CONTENT_URI,
                    new String[]{CalendarContract.Events._ID}, selection, args, null)) {
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        existing.put(cursor.getLong(0));
                    }
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("existing", existing);
        call.resolve(ret);
    }

    @PluginMethod
    public void createEvent(PluginCall call) {
        String calendarId = call.getString("calendarId");
        if (calendarId == null) {
            call.reject("calendarId is required");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = eventValues(call);
        values.put(CalendarContract.Events.CALENDAR_ID, Long.parseLong(calendarId));
        Uri created = resolver.insert(CalendarContract.Events.CONTENT_URI, values);
        if (created == null) {
            call.reject("Event insert failed");
            return;
        }
        long eventId = ContentUris.parseId(created);
        upsertAlarm(resolver, eventId, call.getInt("reminderMinutes"));
        JSObject ret = new JSObject();
        ret.put("eventId", eventId);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateEvent(PluginCall call) {
        Long eventId = call.getLong("eventId");
        if (eventId == null) {
            call.reject("eventId is required");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        Uri uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId);
        resolver.update(uri, eventValues(call), null, null);
        // Replace the alarm: drop old reminder rows, insert the current one.
        resolver.delete(CalendarContract.Reminders.CONTENT_URI,
                CalendarContract.Reminders.EVENT_ID + " = ?",
                new String[]{String.valueOf(eventId)});
        upsertAlarm(resolver, eventId, call.getInt("reminderMinutes"));
        call.resolve();
    }

    @PluginMethod
    public void deleteEvent(PluginCall call) {
        Long eventId = call.getLong("eventId");
        if (eventId == null) {
            call.reject("eventId is required");
            return;
        }
        Uri uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId);
        getContext().getContentResolver().delete(uri, null, null);
        call.resolve();
    }

    private ContentValues eventValues(PluginCall call) {
        ContentValues values = new ContentValues();
        values.put(CalendarContract.Events.TITLE, call.getString("title", ""));
        values.put(CalendarContract.Events.DESCRIPTION, call.getString("description", ""));
        Long start = call.getLong("startMs");
        Long end = call.getLong("endMs");
        if (start != null) {
            values.put(CalendarContract.Events.DTSTART, start);
        }
        if (end != null) {
            values.put(CalendarContract.Events.DTEND, end);
        }
        values.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
        values.put(CalendarContract.Events.HAS_ALARM, call.getInt("reminderMinutes") != null ? 1 : 0);
        return values;
    }

    private void upsertAlarm(ContentResolver resolver, long eventId, Integer minutes) {
        if (minutes == null) {
            return;
        }
        ContentValues alarm = new ContentValues();
        alarm.put(CalendarContract.Reminders.EVENT_ID, eventId);
        alarm.put(CalendarContract.Reminders.MINUTES, minutes);
        alarm.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
        resolver.insert(CalendarContract.Reminders.CONTENT_URI, alarm);
    }
}
