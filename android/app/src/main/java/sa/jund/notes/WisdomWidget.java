package sa.jund.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Home-screen widget: a short reminder (a verse, a hadith, a word of the scholars or your own), changing every few hours. */
public class WisdomWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) { WidgetData.refreshAll(ctx); }
}
