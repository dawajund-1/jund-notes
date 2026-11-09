package sa.jund.notes;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.Collections;
import java.util.UUID;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://mustatar-app.github.io";
    private static final String SHARE_PATH = "/__mustatar_share/";
    private static final int PICK = 1, AUDIO = 2, NOTIFY = 3, LOCATION = 4;
    private WebView web;
    private ValueCallback<Uri[]> picker;
    private PermissionRequest microphone;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private volatile SharedFile shared;
    private String sharedText;
    private boolean sharePending;
    private boolean ready;

    private static boolean local(Uri url) {
        return "https".equals(url.getScheme()) && "mustatar-app.github.io".equals(url.getHost())
            && (url.getPort() == -1 || url.getPort() == 443);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setGeolocationEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame() || local(request.getUrl())) return false;
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) || "mailto".equals(url.getScheme())
                    || ("daftar".equals(url.getScheme()) && "widget".equals(url.getHost()))) {
                    Intent link = "daftar".equals(url.getScheme())
                        ? new Intent(MainActivity.this, WidgetLinkActivity.class).setData(url)
                        : new Intent(Intent.ACTION_VIEW, url);
                    try { startActivity(link); } catch (ActivityNotFoundException ignored) {}
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return sharedResponse(request.getUrl());
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                ready = false;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)
            && WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            androidx.webkit.ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                new androidx.webkit.ServiceWorkerClientCompat() {
                    @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        return sharedResponse(request.getUrl());
                    }
                });
        }
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = callback;
                try { startActivityForResult(params.createIntent(), PICK); }
                catch (ActivityNotFoundException e) { picker.onReceiveValue(null); picker = null; }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    String audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE;
                    if (!local(request.getOrigin()) || !java.util.Arrays.asList(request.getResources()).contains(audio)) {
                        request.deny();
                    } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{audio});
                    } else {
                        if (microphone != null) microphone.deny();
                        microphone = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO);
                    }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (microphone == request) microphone = null;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!local(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    locationOrigin = origin;
                    locationCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION);
                }
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "MustatarAndroid", Collections.singleton(ORIGIN),
                (view, message, origin, mainFrame, reply) -> {
                    if (!mainFrame || !local(origin)) return;
                    try {
                        JSONObject command = new JSONObject(message.getData());
                        switch (command.optString("action")) {
                            case "ready": ready = true; deliverShare(); break;
                            case "shareDone":
                                SharedFile file = shared;
                                if (file != null && (SHARE_PATH + file.token).equals(command.optString("path"))) shared = null;
                                break;
                            case "sync": ReminderReceiver.replace(this, command.getJSONArray("items")); break;
                            case "permissions": notificationPermissions(); break;
                            case "test": ReminderReceiver.test(this); break;
                            case "print":
                                getSystemService(PrintManager.class).print("Mustatar",
                                    web.createPrintDocumentAdapter("Mustatar"), null);
                                break;
                        }
                        reply.postMessage(ReminderReceiver.status(this).toString());
                    } catch (Exception ignored) {}
                });
        }
        setContentView(web);
        receive(getIntent(), true);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        receive(intent, false);
    }

    private void receive(Intent intent, boolean first) {
        Uri data = intent.getData();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream == null && intent.getClipData() != null) stream = intent.getClipData().getItemAt(0).getUri();
            shared = stream != null && "content".equals(stream.getScheme()) ? new SharedFile(stream, intent.getType()) : null;
            sharePending = true;
            deliverShare();
        }
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && data != null && local(data)) web.loadUrl(data.toString());
        else if (first) web.loadUrl(ORIGIN + "/");
    }

    private void deliverShare() {
        SharedFile file = shared;
        if (!ready || !sharePending) return;
        sharePending = false;
        web.evaluateJavascript("window.JundNativeShare?.(" + JSONObject.quote(sharedText) + ","
            + (file == null ? "null" : JSONObject.quote(SHARE_PATH + file.token)) + ","
            + (file == null ? "null" : JSONObject.quote(file.name)) + ")", null);
        sharedText = null;
    }

    private WebResourceResponse sharedResponse(Uri url) {
        SharedFile file = shared;
        if (file == null || !local(url) || !(SHARE_PATH + file.token).equals(url.getPath())) return null;
        try {
            java.io.InputStream input = getContentResolver().openInputStream(file.uri);
            if (input != null) return new WebResourceResponse(file.type, null, 200, "OK",
                Collections.singletonMap("Cache-Control", "no-store"), input);
        } catch (Exception ignored) {}
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), null);
    }

    private class SharedFile {
        final Uri uri;
        final String token = UUID.randomUUID().toString();
        final String name, type;
        SharedFile(Uri uri, String mime) {
            this.uri = uri;
            String display = null;
            try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) display = c.getString(0);
            } catch (Exception ignored) {}
            type = mime == null ? "application/octet-stream" : mime;
            name = display == null ? ("application/pdf".equals(type) ? "Shared.pdf" : "Shared file") : display;
        }
    }

    private void notificationPermissions() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (getPreferences(MODE_PRIVATE).getBoolean("requestedNotifications", false)
                && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
            } else {
                getPreferences(MODE_PRIVATE).edit().putBoolean("requestedNotifications", true).apply();
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFY);
            }
        } else if (!ReminderReceiver.exact(this)) {
            try { startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()))); }
            catch (ActivityNotFoundException ignored) {}
        } else if (!ReminderReceiver.notifications(this)) {
            startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == AUDIO && microphone != null) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED)
                microphone.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else microphone.deny();
            microphone = null;
        }
        if (code == NOTIFY) refreshReminders();
        if (code == LOCATION && locationCallback != null) {
            locationCallback.invoke(locationOrigin, grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED, false);
            locationCallback = null;
        }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == PICK && picker != null) {
            picker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            picker = null;
        }
    }

    @Override protected void onResume() { super.onResume(); refreshReminders(); }

    private void refreshReminders() {
        ReminderReceiver.schedule(this);
        if (web != null) web.evaluateJavascript("window.JundCal?.pushSync()", null);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (picker != null) picker.onReceiveValue(null);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)
            && WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            androidx.webkit.ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(null);
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
