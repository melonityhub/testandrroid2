package app.proudvocab.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.ActivityInfo;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.channels.FileChannel;

/**
 * Single-activity shell: a WebView that shows the (ported) ProudVocab UI from a
 * loopback server and talks to Android through {@link NativeBridge}.
 */
public class MainActivity extends Activity {
    private static final String TAG = "ProudVocab";
    private static final int RC_FILE_CHOOSER = 1004;

    private FrameLayout root;
    private WebView web;
    private LocalServer server;
    private NativeBridge bridge;
    private boolean fullscreen;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF070A12);
        setContentView(root);

        try {
            web = new WebView(this);
        } catch (Throwable t) {
            showFatal(getString(R.string.err_webview));
            return;
        }
        try {
            server = LocalServer.start(new AndroidProvider());
        } catch (IOException e) {
            showFatal("Could not start the local server: " + e.getMessage());
            return;
        }

        configureWebView();
        bridge = new NativeBridge(this, web, server, WebSettings.getDefaultUserAgent(this));
        web.addJavascriptInterface(bridge, "PVNative");
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web.loadUrl(server.origin() + "/index.html");
        handleIntent(getIntent());
    }

    /* ============================================================ WebView */

    private void configureWebView() {
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        web.setBackgroundColor(0xFF070A12);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (server != null && url.startsWith(server.origin() + "/")) return false;
                if (url.startsWith("about:")) return false;
                openExternal(url);
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.e(TAG, "WebView renderer gone (crashed=" + detail.didCrash() + ") - restarting UI");
                runOnUiThread(new Runnable() {
                    @Override public void run() { recreate(); }
                });
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d("PV-JS", m.message() + "  [" + m.sourceId() + ":" + m.lineNumber() + "]");
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny(); // no camera / microphone needed
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(R.string.dlg_ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(R.string.dlg_ok, (d, w) -> result.confirm())
                        .setNegativeButton(R.string.dlg_cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton(R.string.dlg_ok, (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton(R.string.dlg_cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            /** <input type="file"> (backup restore, JSON import) */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), RC_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
    }

    private void showFatal(String message) {
        TextView tv = new TextView(this);
        tv.setText(message);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(16);
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(48, 48, 48, 48);
        root.addView(tv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /* =========================================================== lifecycle */

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent i) {
        if (i == null || bridge == null) return;
        if (!Intent.ACTION_VIEW.equals(i.getAction()) || i.getData() == null) return;
        Uri u = i.getData();
        if (!"content".equals(u.getScheme())) return;
        try {
            if ((i.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
                getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } catch (Exception ignore) {
            // temporary grant is enough while the app is running
        }
        bridge.queueOpen(Paths.make(u.toString(), bridge.displayName(u)));
        setIntent(new Intent()); // do not re-open the same file when the activity is recreated
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript("window.__pvFlush&&window.__pvFlush()", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && fullscreen) applyImmersive(true);
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (bridge != null) bridge.destroy();
        if (web != null) {
            root.removeView(web);
            web.removeJavascriptInterface("PVNative");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return window.__pvOnBack?(window.__pvOnBack()?'1':'0'):'0'}catch(e){return '0'}})()",
                value -> {
                    if ("\"1\"".equals(value)) return;          // the web UI closed something
                    if (fullscreen) { setFullscreen(false); return; }
                    MainActivity.super.onBackPressed();
                });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RC_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        if (bridge != null) bridge.onActivityResult(requestCode, resultCode, data);
    }

    /* ======================================================== window helpers */

    boolean isFullscreen() { return fullscreen; }

    void toggleFullscreen() { setFullscreen(!fullscreen); }

    void setFullscreen(final boolean on) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                fullscreen = on;
                applyImmersive(on);
                setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                        : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                if (bridge != null) {
                    JSONObject o = new JSONObject();
                    try { o.put("on", on); } catch (JSONException ignore) { /* ignore */ }
                    bridge.emit("pv:fullscreen-changed", o);
                }
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void applyImmersive(boolean on) {
        Window w = getWindow();
        WindowManager.LayoutParams lp = w.getAttributes();
        lp.layoutInDisplayCutoutMode = on
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
        w.setAttributes(lp);
        View decor = w.getDecorView();
        if (on) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    void setKeepAwake(final boolean on) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    boolean openExternal(String url) {
        if (url == null || !url.matches("(?i)^(https?:|mailto:).*")) return false;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /* ===================================================== asset / media IO */

    private final class AndroidProvider implements LocalServer.Provider {
        @Override
        public InputStream openAsset(String rel) {
            try {
                return getAssets().open("www/" + rel);
            } catch (IOException e) {
                return null;
            }
        }

        @Override
        public LocalServer.MediaSource openMedia(String path) throws IOException {
            Uri uri = Uri.parse(Paths.strip(path));
            if (!"content".equals(uri.getScheme())) return null; // never serve file:// or anything else
            final AssetFileDescriptor afd;
            try {
                afd = getContentResolver().openAssetFileDescriptor(uri, "r");
            } catch (Exception e) {
                return null;
            }
            if (afd == null) return null;
            String name = Paths.nameOf(path);
            String mime = Paths.mimeForName(name);
            if (mime == null) {
                try { mime = getContentResolver().getType(uri); } catch (Exception ignore) { /* ignore */ }
            }
            if (mime == null || !mime.startsWith("video/") && !mime.startsWith("audio/")) mime = "video/mp4";
            return new ContentMedia(afd, mime);
        }
    }

    private static final class ContentMedia implements LocalServer.MediaSource {
        private final AssetFileDescriptor afd;
        private final FileInputStream in;
        private final String mime;
        private final long base;
        private final long length;

        ContentMedia(AssetFileDescriptor afd, String mime) throws IOException {
            this.afd = afd;
            this.mime = mime;
            this.in = new FileInputStream(afd.getFileDescriptor());
            this.base = afd.getStartOffset();
            long len = afd.getLength();
            if (len < 0) len = afd.getParcelFileDescriptor().getStatSize();
            this.length = len < 0 ? -1 : len;
        }

        @Override public long length() { return length; }

        @Override public String mime() { return mime; }

        @Override
        public void copy(long start, long count, OutputStream out) throws IOException {
            FileChannel ch = in.getChannel();
            try {
                ch.position(base + start);
            } catch (IOException notSeekable) {
                long skipped = 0;
                while (skipped < start) {
                    long n = in.skip(start - skipped);
                    if (n <= 0) break;
                    skipped += n;
                }
            }
            byte[] buf = new byte[128 * 1024];
            long left = count;
            while (left != 0) {
                int want = left < 0 ? buf.length : (int) Math.min(buf.length, left);
                int n = in.read(buf, 0, want);
                if (n < 0) break;
                out.write(buf, 0, n);
                if (left > 0) left -= n;
            }
        }

        @Override
        public void close() throws IOException {
            try { in.close(); } finally { afd.close(); }
        }
    }
}
