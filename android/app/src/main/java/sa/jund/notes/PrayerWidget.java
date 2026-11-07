package sa.jund.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Small home-screen widget: the next prayer only. */
public class PrayerWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) { WidgetData.refreshAll(ctx); }
}
