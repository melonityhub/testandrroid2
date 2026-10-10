package app.proudvocab.android;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Android implementation of the desktop app's `pvBridge` (Electron preload).
 * The web layer calls call(id, channel, jsonArgs) and gets the answer back
 * through window.__pvNativeResult(id, ok, jsonPayload).
 */
final class NativeBridge {
    static final int RC_OPEN = 1001;
    static final int RC_TREE = 1002;
    static final int RC_SAVE = 1003;
    static final int RC_DICT = 1005;

    private static final String ASYNC = new String("<async>");

    private final MainActivity act;
    private final WebView web;
    private final LocalServer server;
    private final Store store;
    private final Dictionary dict;
    private final NetFetch net;
    private final ExecutorService io = Executors.newFixedThreadPool(4);
    private final ExecutorService slow = Executors.newSingleThreadExecutor();
    private final Map<Integer, String> pendingCall = new ConcurrentHashMap<>();
    private final Map<Integer, Object> pendingExtra = new ConcurrentHashMap<>();
    private final List<String> pendingOpen = new ArrayList<>();
    private boolean uiReady;
    private volatile boolean destroyed;

    NativeBridge(MainActivity act, WebView web, LocalServer server, String userAgent) {
        this.act = act;
        this.web = web;
        this.server = server;
        this.store = new Store(act.getFilesDir());
        this.dict = new Dictionary(act.getFilesDir());
        this.net = new NetFetch(userAgent);
    }

    void destroy() {
        destroyed = true;
        io.shutdownNow();
        slow.shutdownNow();
    }

    /* ======================================================= JS interface */

    @JavascriptInterface
    public String mediaBase() {
        return server.mediaBase();
    }

    @JavascriptInterface
    public void call(final String id, final String channel, final String argsJson) {
        if (destroyed) return;
        try {
            io.execute(new Runnable() {
                @Override public void run() { runCall(id, channel, argsJson); }
            });
        } catch (RejectedExecutionException ignore) {
            // shutting down
        }
    }

    @JavascriptInterface
    public void send(String channel, String argsJson) {
        try {
            if ("pv:net-abort".equals(channel)) {
                JSONArray a = new JSONArray(argsJson == null ? "[]" : argsJson);
                net.abort(a.optString(0, ""));
            }
        } catch (JSONException ignore) {
            // ignore
        }
    }

    /* ============================================================ dispatch */

    private void runCall(String id, String channel, String argsJson) {
        try {
            JSONArray a = new JSONArray(argsJson == null || argsJson.isEmpty() ? "[]" : argsJson);
            String res = dispatch(id, channel, a);
            if (res != ASYNC) reply(id, true, res == null ? "null" : res);
        } catch (Throwable t) {
            reply(id, false, String.valueOf(t.getMessage()));
        }
    }

    private String dispatch(String id, String channel, JSONArray a) throws Exception {
        switch (channel) {
            case "pv:app-info": return appInfo();
            case "pv:open-dialog": {
                JSONObject o = a.optJSONObject(0);
                String kind = o != null ? o.optString("kind", "video") : "video";
                startOpenDialog(id, kind);
                return ASYNC;
            }
            case "pv:open-directory": {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                startPicker(id, RC_TREE, i, null);
                return ASYNC;
            }
            case "pv:media-url": {
                String p = a.optString(0, "");
                return p.isEmpty() ? "null" : JSONObject.quote(server.mediaBase() + b64url(p));
            }
            case "pv:file-info": return fileInfo(a.optString(0, ""));
            case "pv:read-bytes": return readBytes(a.optString(0, ""), a.optLong(1, 24L * 1024 * 1024));
            case "pv:scan-subtitles": return scanSubtitles(a.optString(0, ""));
            case "pv:list-videos": return listVideos(a.optString(0, ""));
            case "pv:store-load": {
                String s = store.load();
                if (s == null) return "{\"ok\":false,\"data\":{\"local\":{},\"sync\":{},\"meta\":{}}}";
                return "{\"ok\":true,\"data\":" + s + "}";
            }
            case "pv:store-save": {
                store.save(a.getJSONObject(0));
                return "{\"ok\":true}";
            }
            case "pv:store-path": return JSONObject.quote(store.file().getAbsolutePath());
            case "pv:net-fetch": return net.fetch(a.getJSONObject(0)).toString();
            case "pv:open-external": return String.valueOf(act.openExternal(a.optString(0, "")));
            case "pv:show-in-folder": return "false";
            case "pv:window-action": {
                String action = a.optString(0, "");
                if ("fullscreen".equals(action)) {
                    act.toggleFullscreen();
                    return "true";
                }
                return "false";
            }
            case "pv:set-progress": return "true";
            case "pv:is-fullscreen": return String.valueOf(act.isFullscreen());
            case "pv:keep-awake": {
                act.setKeepAwake(a.optBoolean(0, false));
                return "true";
            }
            case "pv:save-file": {
                startSave(id, a.getJSONObject(0));
                return ASYNC;
            }
            case "pv:take-pending-open": {
                JSONArray out = new JSONArray();
                synchronized (pendingOpen) {
                    uiReady = true;
                    for (String p : pendingOpen) out.put(p);
                    pendingOpen.clear();
                }
                return out.toString();
            }
            case "pv:dict-status": return dict.status().toString();
            case "pv:dict-pick": {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                startPicker(id, RC_DICT, i, null);
                return ASYNC;
            }
            case "pv:dict-remove": {
                dict.remove();
                return dict.status().toString();
            }
            case "pv:dict-translate": return dict.translate(a.optString(0, "")).toString();
            case "pv:dict-search": return dict.search(a.optString(0, ""), a.optInt(1, 30)).toString();
            case "pv:dict-detail": return dict.detail(a.optString(0, "")).toString();
            default:
                throw new IllegalArgumentException("unknown channel: " + channel);
        }
    }

    /* ============================================================== replies */

    void reply(final String id, final boolean ok, final String payload) {
        if (destroyed) return;
        final String js = "window.__pvNativeResult&&window.__pvNativeResult(" + JSONObject.quote(id) + ","
                + ok + "," + JSONObject.quote(payload == null ? "" : payload) + ")";
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (!destroyed) web.evaluateJavascript(js, null);
            }
        });
    }

    void emit(String channel, JSONObject payload) {
        if (destroyed) return;
        final String js = "window.__pvNativeEmit&&window.__pvNativeEmit(" + JSONObject.quote(channel) + ","
                + JSONObject.quote(payload == null ? "{}" : payload.toString()) + ")";
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (!destroyed) web.evaluateJavascript(js, null);
            }
        });
    }

    /** a file the system handed to us (ACTION_VIEW) */
    void queueOpen(String path) {
        boolean live;
        synchronized (pendingOpen) {
            live = uiReady;
            if (!live) pendingOpen.add(path);
        }
        if (live) {
            JSONObject o = new JSONObject();
            try {
                o.put("filePaths", new JSONArray().put(path));
            } catch (JSONException ignore) { /* ignore */ }
            emit("pv:open-files", o);
        }
    }

    /* ============================================================== info */

    private String appInfo() throws Exception {
        JSONObject o = new JSONObject();
        String version = "1.0.0";
        try {
            version = act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException ignore) { /* keep default */ }
        o.put("version", version);
        o.put("platform", "android");
        o.put("arch", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown");
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("device", Build.MODEL);
        o.put("locale", Locale.getDefault().toLanguageTag());
        o.put("packaged", true);
        return o.toString();
    }

    /* ============================================================= pickers */

    private void startOpenDialog(String id, String kind) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if ("subtitle".equals(kind)) {
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/x-subrip", "text/vtt", "text/plain", "text/*", "application/octet-stream", "application/*"});
        } else {
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "video/*", "application/x-matroska", "application/x-subrip", "text/vtt", "text/plain", "application/octet-stream"});
        }
        startPicker(id, RC_OPEN, i, kind);
    }

    private void startPicker(final String id, final int rc, final Intent intent, final Object extra) {
        final String old = pendingCall.put(rc, id);
        if (extra != null) pendingExtra.put(rc, extra); else pendingExtra.remove(rc);
        if (old != null) reply(old, true, "{\"canceled\":true,\"filePaths\":[]}");
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    act.startActivityForResult(intent, rc);
                } catch (ActivityNotFoundException e) {
                    pendingCall.remove(rc);
                    reply(id, false, "No file picker available on this device");
                }
            }
        });
    }

    private void startSave(String id, JSONObject req) {
        final String name = req.optString("name", "export.txt");
        String mime = req.optString("mime", "application/octet-stream");
        if (mime.isEmpty()) mime = "application/octet-stream";
        byte[] bytes = Base64.decode(req.optString("base64", ""), Base64.DEFAULT);
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, name);
        startPicker(id, RC_SAVE, i, bytes);
    }

    /** called by MainActivity on the UI thread */
    void onActivityResult(final int rc, final int resultCode, final Intent data) {
        final String id = pendingCall.remove(rc);
        final Object extra = pendingExtra.remove(rc);
        if (id == null) return;
        final boolean ok = resultCode == MainActivity.RESULT_OK && data != null;
        ExecutorService ex = rc == RC_DICT ? slow : io;
        try {
            ex.execute(new Runnable() {
                @Override public void run() {
                    try {
                        switch (rc) {
                            case RC_OPEN: reply(id, true, ok ? openResult(data) : canceled()); break;
                            case RC_TREE: reply(id, true, ok ? treeResult(data) : canceled()); break;
                            case RC_SAVE: reply(id, true, ok ? saveResult(data, (byte[]) extra) : "{\"ok\":false,\"canceled\":true}"); break;
                            case RC_DICT: reply(id, true, ok ? dictResult(data) : "{\"ok\":false,\"error\":\"canceled\"}"); break;
                            default: reply(id, false, "unexpected request code");
                        }
                    } catch (Throwable t) {
                        reply(id, false, String.valueOf(t.getMessage()));
                    }
                }
            });
        } catch (RejectedExecutionException ignore) {
            // shutting down
        }
    }

    private static String canceled() { return "{\"canceled\":true,\"filePaths\":[]}"; }

    private String openResult(Intent data) throws JSONException {
        List<Uri> uris = new ArrayList<>();
        ClipData cd = data.getClipData();
        if (cd != null) {
            for (int i = 0; i < cd.getItemCount(); i++) {
                Uri u = cd.getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        JSONArray paths = new JSONArray();
        for (Uri u : uris) {
            persist(u);
            paths.put(Paths.make(u.toString(), displayName(u)));
        }
        JSONObject o = new JSONObject();
        o.put("canceled", paths.length() == 0);
        o.put("filePaths", paths);
        return o.toString();
    }

    private String treeResult(Intent data) throws JSONException {
        Uri u = data.getData();
        if (u == null) return canceled();
        persist(u);
        JSONObject o = new JSONObject();
        o.put("canceled", false);
        o.put("filePaths", new JSONArray().put(u.toString()));
        return o.toString();
    }

    private String saveResult(Intent data, byte[] bytes) throws Exception {
        Uri u = data.getData();
        if (u == null || bytes == null) return "{\"ok\":false,\"canceled\":true}";
        OutputStream os = act.getContentResolver().openOutputStream(u, "wt");
        if (os == null) return "{\"ok\":false,\"error\":\"cannot open destination\"}";
        try {
            os.write(bytes);
            os.flush();
        } finally {
            os.close();
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("name", displayName(u));
        return o.toString();
    }

    private String dictResult(Intent data) {
        final Uri u = data.getData();
        if (u == null) return "{\"ok\":false,\"error\":\"canceled\"}";
        String name = displayName(u);
        JSONObject res = dict.importFrom(act, u, name, new Dictionary.Progress() {
            @Override public void onProgress(long done, long total) {
                JSONObject p = new JSONObject();
                Dictionary.put(p, "done", done);
                Dictionary.put(p, "total", total);
                emit("pv:dict-progress", p);
            }
        });
        return res.toString();
    }

    /* ============================================================== files */

    /** keep access to a picked document across app restarts (bounded) */
    private void persist(Uri u) {
        ContentResolver cr = act.getContentResolver();
        try {
            cr.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignore) {
            return; // not a persistable provider -> access lasts for this session only
        }
        try {
            List<UriPermission> perms = new ArrayList<>(cr.getPersistedUriPermissions());
            if (perms.size() > 110) {
                Collections.sort(perms, new Comparator<UriPermission>() {
                    @Override public int compare(UriPermission x, UriPermission y) {
                        return Long.compare(x.getPersistedTime(), y.getPersistedTime());
                    }
                });
                for (int i = 0; i < perms.size() - 100; i++) {
                    cr.releasePersistableUriPermission(perms.get(i).getUri(), Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
            }
        } catch (Exception ignore) {
            // pruning is best effort
        }
    }

    String displayName(Uri u) {
        Cursor c = null;
        try {
            c = act.getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignore) {
            // fall back to the last path segment
        } finally {
            if (c != null) c.close();
        }
        return Paths.nameOf(u.toString());
    }

    private static boolean isContent(Uri u) { return "content".equals(u.getScheme()); }

    private String fileInfo(String path) throws JSONException {
        JSONObject o = new JSONObject();
        Uri uri = Uri.parse(Paths.strip(path));
        if (!isContent(uri)) {
            o.put("ok", false);
            o.put("error", "unsupported");
            return o.toString();
        }
        String name = null;
        long size = -1;
        Cursor c = null;
        try {
            c = act.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null);
            if (c != null && c.moveToFirst()) {
                if (!c.isNull(0)) name = c.getString(0);
                if (!c.isNull(1)) size = c.getLong(1);
            }
        } catch (Exception ignore) {
            // the open() below decides
        } finally {
            if (c != null) c.close();
        }
        AssetFileDescriptor afd = null;
        try {
            afd = act.getContentResolver().openAssetFileDescriptor(uri, "r");
            if (afd == null) throw new IOException("not readable");
            if (size < 0) size = afd.getLength();
        } catch (Exception e) {
            o.put("ok", false);
            o.put("error", String.valueOf(e.getMessage()));
            return o.toString();
        } finally {
            if (afd != null) {
                try { afd.close(); } catch (IOException ignore) { /* ignore */ }
            }
        }
        if (name == null) name = Paths.nameOf(path);
        o.put("ok", true);
        o.put("name", name);
        o.put("dir", "");
        o.put("ext", Paths.ext(name));
        o.put("size", size);
        o.put("mtime", 0);
        o.put("isVideo", Paths.isVideoName(name));
        o.put("isSubtitle", Paths.isSubtitleName(name));
        return o.toString();
    }

    private String readBytes(String path, long max) throws JSONException {
        JSONObject o = new JSONObject();
        long limit = Math.max(1024, Math.min(max, 24L * 1024 * 1024));
        Uri uri = Uri.parse(Paths.strip(path));
        if (!isContent(uri)) {
            o.put("ok", false);
            o.put("error", "unsupported");
            return o.toString();
        }
        InputStream in = null;
        try {
            in = act.getContentResolver().openInputStream(uri);
            if (in == null) throw new IOException("not readable");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
                if (bo.size() > limit) {
                    o.put("ok", false);
                    o.put("error", "file-too-big");
                    o.put("size", bo.size());
                    return o.toString();
                }
            }
            byte[] all = bo.toByteArray();
            o.put("ok", true);
            o.put("base64", Base64.encodeToString(all, Base64.NO_WRAP));
            o.put("size", all.length);
            o.put("name", Paths.nameOf(path));
            return o.toString();
        } catch (Exception e) {
            o.put("ok", false);
            o.put("error", String.valueOf(e.getMessage()));
            return o.toString();
        } finally {
            if (in != null) {
                try { in.close(); } catch (IOException ignore) { /* ignore */ }
            }
        }
    }

    /* ------------------------------------------------ folders (SAF trees) */

    private static final class Doc {
        String id;
        String name;
        String mime;
        long size;
        long mtime;
    }

    private List<Doc> children(Uri tree, String parentDocId) {
        List<Doc> out = new ArrayList<>();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId);
        Cursor c = null;
        try {
            c = act.getContentResolver().query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null);
            while (c != null && c.moveToNext()) {
                Doc d = new Doc();
                d.id = c.getString(0);
                d.name = c.isNull(1) ? "" : c.getString(1);
                d.mime = c.isNull(2) ? "" : c.getString(2);
                d.size = c.isNull(3) ? 0 : c.getLong(3);
                d.mtime = c.isNull(4) ? 0 : c.getLong(4);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(d.mime)) continue;
                out.add(d);
                if (out.size() > 5000) break;
            }
        } catch (Exception ignore) {
            // unreadable folder -> empty list
        } finally {
            if (c != null) c.close();
        }
        return out;
    }

    private String listVideos(String treePath) throws JSONException {
        JSONObject res = new JSONObject();
        JSONArray files = new JSONArray();
        try {
            Uri tree = Uri.parse(Paths.strip(treePath));
            String root = DocumentsContract.getTreeDocumentId(tree);
            List<Doc> docs = children(tree, root);
            Collections.sort(docs, new Comparator<Doc>() {
                @Override public int compare(Doc x, Doc y) { return Paths.naturalCompare(x.name, y.name); }
            });
            for (Doc d : docs) {
                if (!Paths.isVideo(d.name, d.mime)) continue;
                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(tree, d.id);
                JSONObject f = new JSONObject();
                f.put("name", d.name);
                f.put("path", Paths.make(docUri.toString(), d.name));
                f.put("size", d.size);
                f.put("mtime", d.mtime);
                files.put(f);
            }
            res.put("ok", true);
        } catch (Exception e) {
            res.put("ok", false);
            res.put("error", String.valueOf(e.getMessage()));
        }
        res.put("files", files);
        return res.toString();
    }

    private static String parentOf(String docId) {
        int slash = docId.lastIndexOf('/');
        if (slash >= 0) return docId.substring(0, slash);
        int colon = docId.indexOf(':');
        return colon >= 0 ? docId.substring(0, colon + 1) : null;
    }

    private Uri findPersistedTree(String authority, String parentId) {
        for (UriPermission p : act.getContentResolver().getPersistedUriPermissions()) {
            Uri u = p.getUri();
            if (!authority.equals(u.getAuthority()) || !DocumentsContract.isTreeUri(u)) continue;
            String td = DocumentsContract.getTreeDocumentId(u);
            String prefix = td.endsWith(":") ? td : td + "/";
            if (parentId.equals(td) || parentId.startsWith(prefix)) return u;
        }
        return null;
    }

    /** subtitle files that sit next to the video (needs a folder permission) */
    private String scanSubtitles(String videoPath) throws JSONException {
        JSONObject res = new JSONObject();
        List<JSONObject> found = new ArrayList<>();
        try {
            Uri v = Uri.parse(Paths.strip(videoPath));
            if (isContent(v) && DocumentsContract.isDocumentUri(act, v)) {
                String docId = DocumentsContract.getDocumentId(v);
                String parentId = parentOf(docId);
                Uri tree = null;
                if (parentId != null) {
                    if (DocumentsContract.isTreeUri(v)) {
                        tree = DocumentsContract.buildTreeDocumentUri(v.getAuthority(), DocumentsContract.getTreeDocumentId(v));
                    } else {
                        tree = findPersistedTree(v.getAuthority(), parentId);
                    }
                }
                if (tree != null) {
                    String base = stem(Paths.nameOf(videoPath)).toLowerCase(Locale.ROOT);
                    String head = base.length() > 8 ? base.substring(0, 8) : base;
                    for (Doc d : children(tree, parentId)) {
                        if (!Paths.isSubtitleName(d.name)) continue;
                        String st = stem(d.name).toLowerCase(Locale.ROOT);
                        JSONObject f = new JSONObject();
                        f.put("name", d.name);
                        f.put("path", Paths.make(DocumentsContract.buildDocumentUriUsingTree(tree, d.id).toString(), d.name));
                        f.put("size", d.size);
                        f.put("exact", st.equals(base));
                        f.put("related", st.startsWith(head));
                        found.add(f);
                    }
                }
            }
        } catch (Exception ignore) {
            // best effort: no folder access -> the user picks the .srt manually
        }
        Collections.sort(found, new Comparator<JSONObject>() {
            @Override public int compare(JSONObject x, JSONObject y) {
                int e = Boolean.compare(y.optBoolean("exact"), x.optBoolean("exact"));
                if (e != 0) return e;
                int r = Boolean.compare(y.optBoolean("related"), x.optBoolean("related"));
                if (r != 0) return r;
                return x.optString("name").compareToIgnoreCase(y.optString("name"));
            }
        });
        JSONArray files = new JSONArray();
        for (int i = 0; i < found.size() && i < 60; i++) files.put(found.get(i));
        res.put("ok", true);
        res.put("files", files);
        return res.toString();
    }

    private static String stem(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    private static String b64url(String s) {
        return Base64.encodeToString(s.getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    /** used by MainActivity for ACTION_VIEW intents */
    Context context() { return act; }
}
