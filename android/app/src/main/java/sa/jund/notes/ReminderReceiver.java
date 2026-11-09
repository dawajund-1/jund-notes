package sa.jund.notes;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

public class ReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "mustatar-reminders";
    private static final String ALARM = "sa.jund.notes.DELIVER_REMINDERS";
    private static final long GRACE = 3 * 60 * 60_000L;

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("mustatar-reminders", Context.MODE_PRIVATE);
    }

    static boolean exact(Context context) {
        return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    static boolean notifications(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static JSONObject status(Context context) throws org.json.JSONException {
        return new JSONObject().put("notifications", notifications(context)).put("exact", exact(context));
    }

    static void replace(Context context, JSONArray items) {
        if (items.length() > 1000) return;
        preferences(context).edit().putString("items", items.toString()).apply();
        schedule(context);
    }

    static void schedule(Context context) { check(context, false); }

    static void test(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        set(context, alarms, System.currentTimeMillis() + 5000, alarm(context, 1));
    }

    @Override public void onReceive(Context context, Intent intent) {
        if (ALARM.equals(intent.getAction()) && intent.getBooleanExtra("test", false)) {
            notify(context, "test", "Mustatar", "Test reminder · إشعار تجريبي");
        } else check(context, ALARM.equals(intent.getAction()));
    }

    private static PendingIntent alarm(Context context, int request) {
        Intent i = new Intent(context, ReminderReceiver.class).setAction(ALARM).putExtra("test", request == 1);
        return PendingIntent.getBroadcast(context, request, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void set(Context context, AlarmManager alarms, long at, PendingIntent intent) {
        if (exact(context)) {
            try {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
                return;
            } catch (SecurityException ignored) {}
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
    }

    private static void check(Context context, boolean deliver) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        PendingIntent pending = alarm(context, 0);
        if (!notifications(context)) { alarms.cancel(pending); return; }
        SharedPreferences prefs = preferences(context);
        long now = System.currentTimeMillis(), next = Long.MAX_VALUE;
        try {
            JSONArray items = new JSONArray(prefs.getString("items", "[]"));
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id"), title = item.optString("title");
                if (id.isEmpty() || title.isEmpty()) continue;
                String key = "fired:" + id;
                long previous = prefs.getLong(key, 0);
                long due = nextDue(item, now - GRACE, previous);
                if (deliver && due <= now) {
                    notify(context, id, title, item.optString("body"));
                    prefs.edit().putLong(key, due).apply();
                    due = nextDue(item, now - GRACE, due);
                }
                next = Math.min(next, due);
            }
        } catch (org.json.JSONException ignored) {}
        if (next == Long.MAX_VALUE) alarms.cancel(pending);
        else set(context, alarms, Math.max(now + 500, next), pending);
    }

    static long nextDue(JSONObject item, long earliest, long previous) {
        long at = item.optLong("at", 0);
        long after = Math.max(earliest, previous + 1);
        if (at > 0) return at >= after ? at : Long.MAX_VALUE;
        String[] date = item.optString("date").split("-"), time = item.optString("time").split(":");
        if (date.length != 3 || time.length != 2) return Long.MAX_VALUE;
        int every = item.optInt("every"), lead = item.optInt("lead");
        if ((every != 0 && every != 1 && every != 7) || lead < 0 || lead > 10080) return Long.MAX_VALUE;
        Calendar day = Calendar.getInstance();
        try {
            day.clear();
            day.setLenient(false);
            day.set(Integer.parseInt(date[0]), Integer.parseInt(date[1]) - 1, Integer.parseInt(date[2]),
                Integer.parseInt(time[0]), Integer.parseInt(time[1]));
            long due = day.getTimeInMillis() - lead * 60_000L;
            if (every > 0 && due < after) {
                // Jump close to today first, then advance by calendar days to keep the local time across DST.
                long periods = Math.max(0, (after - due) / (every * 86_400_000L) - 1);
                day.add(Calendar.DAY_OF_MONTH, (int) Math.min(Integer.MAX_VALUE, periods * every));
            }
            JSONArray skip = item.optJSONArray("skip");
            int attempts = (skip == null ? 0 : skip.length()) + 4;
            for (int i = 0; i < attempts; i++) {
                due = day.getTimeInMillis() - lead * 60_000L;
                String dateKey = String.format(Locale.ROOT, "%04d-%02d-%02d", day.get(Calendar.YEAR),
                    day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH));
                boolean excluded = false;
                if (skip != null) for (int j = 0; j < skip.length(); j++) {
                    if (dateKey.equals(skip.optString(j))) { excluded = true; break; }
                }
                if (!excluded && due >= after) return due;
                if (every == 0) break;
                day.add(Calendar.DAY_OF_MONTH, every);
            }
        } catch (IllegalArgumentException ignored) {}
        return Long.MAX_VALUE;
    }

    private static void notify(Context context, String tag, String title, String body) {
        if (!notifications(context)) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26)
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Mustatar reminders", NotificationManager.IMPORTANCE_HIGH));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        Intent open = new Intent(context, MainActivity.class).setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("https://mustatar-app.github.io/?view=calendar"));
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(tap);
        if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        try { manager.notify(tag, 0, builder.build()); } catch (SecurityException ignored) {}
    }
}
