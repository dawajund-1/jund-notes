package sa.jund.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Home-screen widget: next prayer and the next three items from the calendar. */
public class DaftarWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) { WidgetData.refreshAll(ctx); }
}
