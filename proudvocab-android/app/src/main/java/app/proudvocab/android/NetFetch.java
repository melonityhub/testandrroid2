package app.proudvocab.android;

import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The web layer's fetch() for https:// URLs is proxied through here (exactly
 * like the Electron main process does on desktop) so Google Translate /
 * dictionaryapi / datamuse work without CORS problems.
 *
 * Safety: only http(s), never loopback / private / link-local addresses
 * (checked again on every redirect), response size is capped.
 */
final class NetFetch {
    private static final int MAX_BODY = 20 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;

    private final Map<String, HttpURLConnection> inflight = new ConcurrentHashMap<>();
    private final Map<String, Boolean> aborted = new ConcurrentHashMap<>();
    private final String userAgent;

    NetFetch(String userAgent) {
        this.userAgent = userAgent;
    }

    void abort(String id) {
        if (id == null) return;
        aborted.put(id, Boolean.TRUE);
        HttpURLConnection c = inflight.get(id);
        if (c != null) c.disconnect();
    }

    JSONObject fetch(JSONObject req) {
        JSONObject out = new JSONObject();
        String id = req.optString("id", "");
        try {
            String url = req.optString("url", "");
            String method = req.optString("method", "GET").toUpperCase(Locale.ROOT);
            if (!method.matches("GET|HEAD|POST|PUT|DELETE|OPTIONS")) method = "GET";
            String bodyStr = req.isNull("body") ? null : req.optString("body", null);
            int timeout = Math.min(Math.max(req.optInt("timeoutMs", 15000), 1000), 120000);
            JSONObject headers = req.optJSONObject("headers");

            HttpURLConnection c = null;
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                URL u = new URL(url);
                String proto = u.getProtocol();
                if (!"https".equals(proto) && !"http".equals(proto)) throw new IOException("blocked scheme");
                checkHost(u.getHost());

                c = (HttpURLConnection) u.openConnection();
                if (!id.isEmpty()) inflight.put(id, c);
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(Math.min(timeout, 15000));
                c.setReadTimeout(timeout);
                c.setRequestMethod(method);
                boolean hasUa = false;
                if (headers != null) {
                    Iterator<String> it = headers.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        String lk = k.toLowerCase(Locale.ROOT);
                        if (lk.equals("host") || lk.equals("content-length") || lk.equals("connection")) continue;
                        if (lk.equals("user-agent")) hasUa = true;
                        c.setRequestProperty(k, headers.optString(k, ""));
                    }
                }
                if (!hasUa) c.setRequestProperty("User-Agent", userAgent);

                if (bodyStr != null && !method.equals("GET") && !method.equals("HEAD")) {
                    byte[] bytes = bodyStr.getBytes("UTF-8");
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(bytes.length);
                    OutputStream os = c.getOutputStream();
                    try { os.write(bytes); } finally { os.close(); }
                }

                int code = c.getResponseCode();
                if ((code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && hop < MAX_REDIRECTS) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null) break;
                    url = new URL(u, loc).toString();
                    c.disconnect();
                    if (code != 307 && code != 308 && !method.equals("GET") && !method.equals("HEAD")) {
                        method = "GET";
                        bodyStr = null;
                    }
                    continue;
                }
                break;
            }
            if (c == null) throw new IOException("no connection");

            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] body = new byte[0];
            if (is != null) {
                try {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[16 * 1024];
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        bo.write(buf, 0, n);
                        if (bo.size() > MAX_BODY) throw new IOException("response too large");
                    }
                    body = bo.toByteArray();
                } finally {
                    is.close();
                }
            }
            JSONObject hdr = new JSONObject();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null) continue;
                StringBuilder sb = new StringBuilder();
                for (String v : e.getValue()) {
                    if (sb.length() > 0) sb.append(", ");
                    sb.append(v);
                }
                hdr.put(e.getKey().toLowerCase(Locale.ROOT), sb.toString());
            }
            out.put("ok", true);
            out.put("status", code);
            out.put("statusText", c.getResponseMessage() == null ? "" : c.getResponseMessage());
            out.put("headers", hdr);
            out.put("base64", Base64.encodeToString(body, Base64.NO_WRAP));
            return out;
        } catch (Exception e) {
            try {
                out = new JSONObject();
                out.put("ok", false);
                out.put("status", 0);
                out.put("error", aborted.containsKey(id) ? "aborted" : String.valueOf(e.getMessage()));
            } catch (Exception ignore) { /* ignore */ }
            return out;
        } finally {
            if (!id.isEmpty()) {
                inflight.remove(id);
                aborted.remove(id);
            }
        }
    }

    /** SSRF guard: refuse loopback, private, link-local, multicast and unique-local addresses. */
    static void checkHost(String host) throws IOException {
        if (host == null || host.isEmpty()) throw new IOException("bad host");
        InetAddress[] all = InetAddress.getAllByName(host);
        for (InetAddress a : all) {
            byte[] b = a.getAddress();
            boolean uniqueLocal6 = b.length == 16 && (b[0] & 0xFE) == 0xFC;
            if (a.isLoopbackAddress() || a.isAnyLocalAddress() || a.isLinkLocalAddress()
                    || a.isSiteLocalAddress() || a.isMulticastAddress() || uniqueLocal6) {
                throw new IOException("blocked address");
            }
        }
    }
}
