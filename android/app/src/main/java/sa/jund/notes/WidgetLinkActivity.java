package sa.jund.notes;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

/** Opened once from Daftar (Settings → Connect widget): remembers where the widget reads its data, then closes. */
public class WidgetLinkActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Uri u = getIntent().getData();
        if (u != null) {
            String id = u.getQueryParameter("id"), server = u.getQueryParameter("server");
            if (id != null && server != null && id.matches("[a-f0-9]{16,64}") && server.startsWith("https://")) {
                getSharedPreferences(WidgetData.PREFS, MODE_PRIVATE).edit().putString("id", id).putString("server", server).apply();
                WidgetData.refreshAll(this);
                Toast.makeText(this, "Widget connected. Long-press your home screen → Widgets → Daftar.", Toast.LENGTH_LONG).show();
            }
        }
        finish();
    }
}
