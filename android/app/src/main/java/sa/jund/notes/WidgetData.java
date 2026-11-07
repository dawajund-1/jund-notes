package sa.jund.notes;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/** Fetches the widget data (next prayer and upcoming items) from the app's own server and draws both widgets. */
public final class WidgetData {
    static final String PREFS = "daftar_widget";
    private static final String[] PRAYERS = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};

    private WidgetData() {}

    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] big = m.getAppWidgetIds(new ComponentName(ctx, DaftarWidget.class));
        int[] small = m.getAppWidgetIds(new ComponentName(ctx, PrayerWidget.class));
        new Thread(() -> {
            JSONObject data = fetch(ctx);
            for (int id : big) m.updateAppWidget(id, draw(ctx, data, false));
            for (int id : small) m.updateAppWidget(id, draw(ctx, data, true));
        }).start();
    }

    static JSONObject fetch(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = p.getString("id", null), server = p.getString("server", null);
        if (id == null || server == null) return null;
        try {
            String date = new SimpleDateFormat("dd-MM-yyyy", Locale.US).format(Calendar.getInstance().getTime());
            URL url = new URL(server + "/widget?id=" + id + "&date=" + date);
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(8000);
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                String line; while ((line = r.readLine()) != null) sb.append(line);
            }
            p.edit().putString("last", sb.toString()).apply();
            return new JSONObject(sb.toString());
        } catch (Exception e) {
            try { String last = p.getString("last", null); return last == null ? null : new JSONObject(last); } catch (Exception ignored) { return null; }
        }
    }

    private static String twelve(String hhmm) {
        try {
            String[] t = hhmm.substring(0, 5).split(":");
            int h = Integer.parseInt(t[0]);
            return ((h % 12) == 0 ? 12 : h % 12) + ":" + t[1] + (h < 12 ? " am" : " pm");
        } catch (Exception e) { return hhmm; }
    }

    private static int minutes(String hhmm) {
        String[] t = hhmm.substring(0, 5).split(":");
        return Integer.parseInt(t[0]) * 60 + Integer.parseInt(t[1]);
    }

    static RemoteViews draw(Context ctx, JSONObject data, boolean small) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), small ? R.layout.widget_prayer : R.layout.widget_main);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (data == null) {
            v.setTextViewText(R.id.w_prayer, "Daftar");
            v.setTextViewText(R.id.w_prayer_time, "Open Daftar → Settings → Connect widget");
            if (!small) { v.setViewVisibility(R.id.w_item1, View.GONE); v.setViewVisibility(R.id.w_item2, View.GONE); v.setViewVisibility(R.id.w_item3, View.GONE); }
            return v;
        }
        // next prayer
        try {
            Calendar now = Calendar.getInstance();
            int mins = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
            JSONObject today = data.optJSONObject("today"), tomorrow = data.optJSONObject("tomorrow");
            String name = null, time = null; int left = -1;
            if (today != null) for (String n : PRAYERS) { String t = today.optString(n, ""); if (t.length() >= 5 && minutes(t) > mins) { name = n; time = t; left = minutes(t) - mins; break; } }
            if (name == null && tomorrow != null) { name = "Fajr"; time = tomorrow.optString("Fajr", ""); }
            if (name != null) {
                v.setTextViewText(R.id.w_prayer, name + "  " + twelve(time));
                String in = left < 0 ? "tomorrow" : left >= 60 ? "in " + (left / 60) + "h " + (left % 60) + "m" : "in " + left + " min";
                v.setTextViewText(R.id.w_prayer_time, in + " · " + data.optString("place", ""));
            }
        } catch (Exception ignored) {}
        if (small) return v;
        // upcoming items
        int[] rows = {R.id.w_item1, R.id.w_item2, R.id.w_item3};
        JSONArray up = data.optJSONArray("upcoming");
        long nowMs = System.currentTimeMillis();
        int shown = 0;
        Calendar todayCal = Calendar.getInstance();
        if (up != null) for (int i = 0; i < up.length() && shown < 3; i++) {
            JSONObject it = up.optJSONObject(i);
            if (it == null || it.optLong("end", it.optLong("at")) < nowMs) continue;
            Calendar c = Calendar.getInstance(); c.setTimeInMillis(it.optLong("at"));
            int dd = (int) ((startOfDay(c) - startOfDay(todayCal)) / 86400000L);
            String day = dd == 0 ? "Today" : dd == 1 ? "Tomorrow" : new SimpleDateFormat("EEE d MMM", Locale.US).format(c.getTime());
            String t = it.optBoolean("timed") ? " " + twelve(String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))) : "";
            v.setTextViewText(rows[shown], day + t + "  ·  " + it.optString("title"));
            v.setViewVisibility(rows[shown], View.VISIBLE);
            shown++;
        }
        if (shown == 0) { v.setTextViewText(R.id.w_item1, "Nothing coming up"); v.setViewVisibility(R.id.w_item1, View.VISIBLE); shown = 1; }
        for (int i = shown; i < 3; i++) v.setViewVisibility(rows[i], View.GONE);
        return v;
    }

    private static long startOfDay(Calendar c) {
        Calendar d = (Calendar) c.clone();
        d.set(Calendar.HOUR_OF_DAY, 0); d.set(Calendar.MINUTE, 0); d.set(Calendar.SECOND, 0); d.set(Calendar.MILLISECOND, 0);
        return d.getTimeInMillis();
    }
}
