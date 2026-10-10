package app.proudvocab.android;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Persistent store behind chrome.storage.local / .sync (saved words, settings,
 * SRS state...). One JSON file in app-private storage, written atomically
 * (tmp -> fsync -> rename) with the previous good copy kept as .bak.
 */
final class Store {
    private final File dir;

    Store(File filesDir) {
        dir = new File(filesDir, "proudvocab-data");
    }

    File file() { return new File(dir, "store.json"); }

    private File bak() { return new File(dir, "store.json.bak"); }

    /** @return the stored JSON text ({local,sync,meta}) or null when nothing valid is stored */
    synchronized String load() {
        File[] candidates = {file(), bak()};
        for (File f : candidates) {
            try {
                String s = readAll(f);
                if (s == null) continue;
                new JSONObject(s); // must parse
                return s;
            } catch (Exception ignore) {
                // try the backup
            }
        }
        return null;
    }

    synchronized void save(JSONObject data) throws IOException, JSONException {
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        JSONObject out = new JSONObject();
        JSONObject local = data.optJSONObject("local");
        JSONObject sync = data.optJSONObject("sync");
        out.put("local", local != null ? local : new JSONObject());
        out.put("sync", sync != null ? sync : new JSONObject());
        JSONObject meta = new JSONObject();
        meta.put("savedAt", System.currentTimeMillis());
        out.put("meta", meta);

        File tmp = new File(dir, "store.json.tmp");
        FileOutputStream fos = new FileOutputStream(tmp);
        try {
            fos.write(out.toString().getBytes("UTF-8"));
            fos.flush();
            fos.getFD().sync();
        } finally {
            fos.close();
        }
        File cur = file();
        if (cur.exists()) {
            //noinspection ResultOfMethodCallIgnored
            bak().delete();
            //noinspection ResultOfMethodCallIgnored
            cur.renameTo(bak());
        }
        if (!tmp.renameTo(cur)) throw new IOException("could not replace store.json");
    }

    private static String readAll(File f) throws IOException {
        if (!f.isFile()) return null;
        FileInputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream((int) Math.min(f.length() + 16, 1 << 26));
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        } finally {
            in.close();
        }
    }
}
