package app.proudvocab.android;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Tiny HTTP/1.1 server bound to 127.0.0.1 only.
 *
 *  - GET /<file>                     -> the bundled web UI (assets/www)
 *  - GET /pvmedia/<token>/<b64url>   -> the video you picked, with HTTP Range
 *                                       support so seeking works in <video>
 *
 * Serving the UI and the media from ONE origin means no CORS / mixed-content
 * problems, and a random per-launch token plus a Host-header check keep other
 * apps and web pages from reading the media.
 */
final class LocalServer {

    interface MediaSource extends Closeable {
        /** total size in bytes or -1 when unknown */
        long length();
        String mime();
        /** copy [start, start+count) ; count < 0 means "until the end" */
        void copy(long start, long count, OutputStream out) throws IOException;
    }

    interface Provider {
        /** @return stream of assets/www/<rel> or null when it does not exist */
        InputStream openAsset(String rel) throws IOException;
        /** @return media for the (decoded) web-layer path or null */
        MediaSource openMedia(String path) throws IOException;
    }

    static final int PREFERRED_PORT = 38211;
    private static final int MAX_HEAD = 16 * 1024;
    private static final int MAX_ASSET = 24 * 1024 * 1024;

    private final ServerSocket server;
    private final Provider provider;
    private final String token;
    private final ExecutorService pool;
    private volatile boolean running = true;

    private LocalServer(ServerSocket server, Provider provider) {
        this.server = server;
        this.provider = provider;
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        this.token = sb.toString();
        final AtomicInteger n = new AtomicInteger();
        this.pool = Executors.newCachedThreadPool(new ThreadFactory() {
            @Override public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "pv-http-" + n.incrementAndGet());
                t.setDaemon(true);
                return t;
            }
        });
    }

    static LocalServer start(Provider provider) throws IOException {
        return start(provider, PREFERRED_PORT);
    }

    static LocalServer start(Provider provider, int preferredPort) throws IOException {
        InetAddress lo = InetAddress.getByAddress(new byte[]{127, 0, 0, 1});
        ServerSocket ss = new ServerSocket();
        try {
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(lo, preferredPort), 64);
        } catch (IOException busy) {
            try { ss.close(); } catch (IOException ignore) { /* ignore */ }
            ss = new ServerSocket(0, 64, lo);
        }
        final LocalServer s = new LocalServer(ss, provider);
        Thread t = new Thread(new Runnable() {
            @Override public void run() { s.acceptLoop(); }
        }, "pv-http-accept");
        t.setDaemon(true);
        t.start();
        return s;
    }

    int port() { return server.getLocalPort(); }
    String origin() { return "http://127.0.0.1:" + port(); }
    String mediaBase() { return origin() + "/pvmedia/" + token + "/"; }
    String token() { return token; }

    void stop() {
        running = false;
        try { server.close(); } catch (IOException ignore) { /* ignore */ }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = server.accept();
                pool.execute(new Runnable() {
                    @Override public void run() { handle(s); }
                });
            } catch (IOException e) {
                if (!running) return;
            } catch (RejectedExecutionException e) {
                return;
            }
        }
    }

    /* ------------------------------------------------------------ request */

    private void handle(Socket s) {
        try {
            s.setSoTimeout(60000);
            s.setTcpNoDelay(true);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();

            byte[] head = readHead(in);
            if (head == null) return;
            String[] lines = new String(head, StandardCharsets.ISO_8859_1).split("\r\n");
            String[] req = lines[0].split(" ");
            if (req.length < 2) { simple(out, 400, "Bad Request", false); return; }
            String method = req[0];
            boolean headOnly = "HEAD".equals(method);
            if (!"GET".equals(method) && !headOnly) { simple(out, 405, "Method Not Allowed", false); return; }

            Map<String, String> h = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int c = lines[i].indexOf(':');
                if (c > 0) h.put(lines[i].substring(0, c).trim().toLowerCase(Locale.ROOT), lines[i].substring(c + 1).trim());
            }

            String host = h.get("host");
            String expectA = "127.0.0.1:" + port();
            String expectB = "localhost:" + port();
            if (host == null || !(host.equals(expectA) || host.equals(expectB))) { simple(out, 403, "Forbidden", headOnly); return; }

            String target = req[1];
            int q = target.indexOf('?');
            if (q >= 0) target = target.substring(0, q);
            int f = target.indexOf('#');
            if (f >= 0) target = target.substring(0, f);
            String path;
            try {
                path = URLDecoder.decode(target.replace("+", "%2B"), "UTF-8");
            } catch (Exception e) {
                simple(out, 400, "Bad Request", headOnly);
                return;
            }

            String mediaPrefix = "/pvmedia/" + token + "/";
            if (path.startsWith("/pvmedia/")) {
                if (!path.startsWith(mediaPrefix)) { simple(out, 403, "Forbidden", headOnly); return; }
                serveMedia(out, path.substring(mediaPrefix.length()), h.get("range"), headOnly);
            } else {
                serveAsset(out, path, headOnly);
            }
        } catch (IOException ignore) {
            // client went away (normal while seeking)
        } catch (RuntimeException e) {
            try { simple(s.getOutputStream(), 500, "Internal Server Error", false); } catch (IOException ignore) { /* ignore */ }
        } finally {
            try { s.close(); } catch (IOException ignore) { /* ignore */ }
        }
    }

    private static byte[] readHead(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(512);
        int state = 0; // matches \r\n\r\n
        while (bo.size() < MAX_HEAD) {
            int b = in.read();
            if (b < 0) return null;
            bo.write(b);
            if (b == '\r' && (state == 0 || state == 2)) state++;
            else if (b == '\n' && (state == 1 || state == 3)) state++;
            else state = (b == '\r') ? 1 : 0;
            if (state == 4) {
                byte[] all = bo.toByteArray();
                return java.util.Arrays.copyOf(all, all.length - 4);
            }
        }
        return null;
    }

    /* ------------------------------------------------------------- assets */

    private void serveAsset(OutputStream out, String path, boolean headOnly) throws IOException {
        String rel = path.startsWith("/") ? path.substring(1) : path;
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..") || rel.contains("\\") || rel.contains("//") || rel.indexOf('\0') >= 0) {
            simple(out, 403, "Forbidden", headOnly);
            return;
        }
        InputStream is;
        try {
            is = provider.openAsset(rel);
        } catch (IOException e) {
            is = null;
        }
        if (is == null) { simple(out, 404, "Not Found", headOnly); return; }
        byte[] data;
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream(Math.max(1024, Math.min(is.available(), 1 << 20)));
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = is.read(buf)) > 0) {
                bo.write(buf, 0, n);
                if (bo.size() > MAX_ASSET) throw new IOException("asset too large");
            }
            data = bo.toByteArray();
        } finally {
            try { is.close(); } catch (IOException ignore) { /* ignore */ }
        }
        StringBuilder sb = new StringBuilder("HTTP/1.1 200 OK\r\n");
        sb.append("Content-Type: ").append(mimeFor(rel)).append("\r\n");
        sb.append("Content-Length: ").append(data.length).append("\r\n");
        sb.append("Cache-Control: no-store\r\n");
        sb.append("X-Content-Type-Options: nosniff\r\n");
        sb.append("Connection: close\r\n\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!headOnly) out.write(data);
        out.flush();
    }

    /* -------------------------------------------------------------- media */

    private void serveMedia(OutputStream out, String b64, String rangeHeader, boolean headOnly) throws IOException {
        String path;
        try {
            path = new String(java.util.Base64.getUrlDecoder().decode(b64), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            simple(out, 400, "Bad Request", headOnly);
            return;
        }
        MediaSource ms;
        try {
            ms = provider.openMedia(path);
        } catch (IOException e) {
            ms = null;
        }
        if (ms == null) { simple(out, 404, "Not Found", headOnly); return; }
        try {
            long total = ms.length();
            long start = 0;
            long end = total - 1;
            boolean partial = false;

            if (rangeHeader != null && total >= 0 && rangeHeader.toLowerCase(Locale.ROOT).startsWith("bytes=")) {
                long[] r = parseRange(rangeHeader.substring(6), total);
                if (r == null) {
                    StringBuilder sb = new StringBuilder("HTTP/1.1 416 Range Not Satisfiable\r\n");
                    sb.append("Content-Range: bytes */").append(total).append("\r\n");
                    sb.append("Content-Length: 0\r\nConnection: close\r\n\r\n");
                    out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
                    out.flush();
                    return;
                }
                if (r[0] != -2) { // -2 = "ignore the header"
                    start = r[0];
                    end = r[1];
                    partial = true;
                }
            }

            StringBuilder sb = new StringBuilder();
            sb.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            sb.append("Content-Type: ").append(ms.mime()).append("\r\n");
            sb.append("Accept-Ranges: ").append(total >= 0 ? "bytes" : "none").append("\r\n");
            if (total >= 0) {
                sb.append("Content-Length: ").append(end - start + 1).append("\r\n");
                if (partial) sb.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(total).append("\r\n");
            }
            sb.append("Cache-Control: no-store\r\n");
            sb.append("X-Content-Type-Options: nosniff\r\n");
            sb.append("Connection: close\r\n\r\n");
            out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (!headOnly) {
                long count = total >= 0 ? end - start + 1 : -1;
                ms.copy(start, count, out);
            }
            out.flush();
        } finally {
            try { ms.close(); } catch (IOException ignore) { /* ignore */ }
        }
    }

    /**
     * @return {start,end} inclusive, {-2,0} when the header must be ignored,
     *         null when it is unsatisfiable (416)
     */
    static long[] parseRange(String spec, long total) {
        try {
            int comma = spec.indexOf(',');
            if (comma >= 0) spec = spec.substring(0, comma);
            spec = spec.trim();
            int dash = spec.indexOf('-');
            if (dash < 0) return new long[]{-2, 0};
            String a = spec.substring(0, dash).trim();
            String b = spec.substring(dash + 1).trim();
            long start;
            long end;
            if (a.isEmpty()) {
                if (b.isEmpty()) return new long[]{-2, 0};
                long suffix = Long.parseLong(b);
                if (suffix <= 0) return null;
                start = Math.max(0, total - suffix);
                end = total - 1;
            } else {
                start = Long.parseLong(a);
                end = b.isEmpty() ? total - 1 : Math.min(Long.parseLong(b), total - 1);
            }
            if (start < 0 || start >= total || start > end) return null;
            return new long[]{start, end};
        } catch (NumberFormatException e) {
            return new long[]{-2, 0};
        }
    }

    /* ------------------------------------------------------------- helpers */

    private static void simple(OutputStream out, int code, String reason, boolean headOnly) throws IOException {
        byte[] body = (code + " " + reason).getBytes(StandardCharsets.UTF_8);
        StringBuilder sb = new StringBuilder("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        sb.append("Content-Type: text/plain; charset=utf-8\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Cache-Control: no-store\r\nConnection: close\r\n\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!headOnly) out.write(body);
        out.flush();
    }

    static String mimeFor(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        int dot = n.lastIndexOf('.');
        String e = dot >= 0 ? n.substring(dot) : "";
        switch (e) {
            case ".html": case ".htm": return "text/html; charset=utf-8";
            case ".js": case ".mjs": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".gif": return "image/gif";
            case ".webp": return "image/webp";
            case ".ico": return "image/x-icon";
            case ".woff": return "font/woff";
            case ".woff2": return "font/woff2";
            case ".ttf": return "font/ttf";
            case ".txt": return "text/plain; charset=utf-8";
            case ".mp3": return "audio/mpeg";
            case ".ogg": return "audio/ogg";
            case ".wav": return "audio/wav";
            default: return "application/octet-stream";
        }
    }
}
