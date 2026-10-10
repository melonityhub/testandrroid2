package app.proudvocab.android;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Base64;
import java.util.Random;

/** Plain-JVM smoke test for Paths + LocalServer (no Android needed).  */
public class ServerSmokeTest {
    static int failed = 0;

    static void check(String what, boolean ok) {
        System.out.println((ok ? "  PASS  " : "  FAIL  ") + what);
        if (!ok) failed++;
    }

    public static void main(String[] args) throws Exception {
        final byte[] movie = new byte[3 * 1024 * 1024 + 123];
        new Random(42).nextBytes(movie);

        LocalServer.Provider p = new LocalServer.Provider() {
            @Override public InputStream openAsset(String rel) {
                if (rel.equals("index.html")) return new ByteArrayInputStream("<h1>hi</h1>".getBytes());
                if (rel.equals("ext/a.js")) return new ByteArrayInputStream("var a=1;".getBytes());
                return null;
            }
            @Override public LocalServer.MediaSource openMedia(String path) {
                if (!path.startsWith("content://ok")) return null;
                return new LocalServer.MediaSource() {
                    @Override public long length() { return movie.length; }
                    @Override public String mime() { return "video/x-matroska"; }
                    @Override public void copy(long start, long count, OutputStream out) throws IOException {
                        long n = count < 0 ? movie.length - start : count;
                        out.write(movie, (int) start, (int) n);
                    }
                    @Override public void close() { }
                };
            }
        };
        LocalServer s = LocalServer.start(p, 0);
        String base = s.origin();
        System.out.println("server " + base);

        // ---- assets
        Resp r = get(base + "/", null, null);
        check("GET / serves index.html", r.code == 200 && new String(r.body).contains("<h1>"));
        check("html content-type", r.ctype.startsWith("text/html"));
        r = get(base + "/ext/a.js", null, null);
        check("js asset + mime", r.code == 200 && r.ctype.startsWith("text/javascript"));
        check("missing asset -> 404", get(base + "/nope.js", null, null).code == 404);
        check("path traversal blocked", get(base + "/ext/../../etc/passwd", null, null).code == 403
                || get(base + "/ext/%2e%2e/x", null, null).code == 403);
        check("bad Host header -> 403", get(base + "/", "evil.example:80", null).code == 403);

        // ---- media
        String pathOk = "content://ok/doc#pvn=a.mkv";
        String b64 = Base64.getUrlEncoder().withoutPadding().encodeToString(pathOk.getBytes("UTF-8"));
        String mUrl = s.mediaBase() + b64;
        r = get(mUrl, null, null);
        check("media 200 full length", r.code == 200 && r.body.length == movie.length);
        check("media content-type", "video/x-matroska".equals(r.ctype));
        check("media Accept-Ranges", "bytes".equals(r.acceptRanges));
        r = get(mUrl, null, "bytes=100-199");
        check("range 100-199 -> 206", r.code == 206 && r.body.length == 100);
        check("range bytes correct", r.body.length == 100 && r.body[0] == movie[100] && r.body[99] == movie[199]);
        check("Content-Range header", ("bytes 100-199/" + movie.length).equals(r.contentRange));
        r = get(mUrl, null, "bytes=" + (movie.length - 10) + "-");
        check("open-ended range", r.code == 206 && r.body.length == 10 && r.body[9] == movie[movie.length - 1]);
        r = get(mUrl, null, "bytes=-50");
        check("suffix range", r.code == 206 && r.body.length == 50 && r.body[0] == movie[movie.length - 50]);
        r = get(mUrl, null, "bytes=0-");
        check("bytes=0- -> 206 all", r.code == 206 && r.body.length == movie.length);
        r = get(mUrl, null, "bytes=" + (movie.length + 5) + "-");
        check("range past EOF -> 416", r.code == 416);
        r = get(mUrl, null, "bytes=abc");
        check("garbage range ignored -> 200", r.code == 200 && r.body.length == movie.length);
        check("wrong token -> 403", get(base + "/pvmedia/deadbeef/" + b64, null, null).code == 403);
        String b64bad = Base64.getUrlEncoder().withoutPadding().encodeToString("content://nope".getBytes("UTF-8"));
        check("unknown media -> 404", get(s.mediaBase() + b64bad, null, null).code == 404);
        check("file:// path rejected by provider -> 404", get(s.mediaBase() + Base64.getUrlEncoder().withoutPadding().encodeToString("file:///etc/passwd".getBytes()), null, null).code == 404);

        // ---- Paths
        String pth = Paths.make("content://a/b", "فیلم one+two.mkv");
        check("Paths.nameOf round-trip (unicode, +, space)", "فیلم one+two.mkv".equals(Paths.nameOf(pth)));
        check("Paths.strip", "content://a/b".equals(Paths.strip(pth)));
        check("Paths.isVideo by ext", Paths.isVideoName("X.MKV") && !Paths.isVideoName("x.srt") && Paths.isSubtitleName("x.SRT"));
        check("Paths.isVideo by mime (no ext)", Paths.isVideo("movie", "video/mp4") && !Paths.isVideo("a.srt", "video/mp4"));
        check("natural sort", Paths.naturalCompare("ep2.mkv", "ep10.mkv") < 0 && Paths.naturalCompare("ep10.mkv", "ep2.mkv") > 0);
        check("nameOf plain uri", "x.mp4".equals(Paths.nameOf("content://a/document/primary%3AMovies%2Fx.mp4")));

        s.stop();
        System.out.println(failed == 0 ? "ALL PASSED" : (failed + " FAILED"));
        System.exit(failed == 0 ? 0 : 1);
    }

    static class Resp { int code; String ctype, acceptRanges, contentRange; byte[] body = new byte[0]; }

    static Resp get(String url, String hostHeader, String range) throws Exception {
        // HttpURLConnection refuses to override Host, so use a raw socket when needed
        java.net.URL u = new URL(url);
        java.net.Socket sock = new java.net.Socket("127.0.0.1", u.getPort());
        sock.setSoTimeout(15000);
        String host = hostHeader != null ? hostHeader : "127.0.0.1:" + u.getPort();
        String req = "GET " + u.getFile() + " HTTP/1.1\r\nHost: " + host + "\r\n"
                + (range != null ? "Range: " + range + "\r\n" : "") + "Connection: close\r\n\r\n";
        sock.getOutputStream().write(req.getBytes("ISO-8859-1"));
        InputStream in = sock.getInputStream();
        ByteArrayOutputStream all = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) all.write(buf, 0, n);
        sock.close();
        byte[] raw = all.toByteArray();
        int split = -1;
        for (int i = 0; i + 3 < raw.length; i++) if (raw[i] == 13 && raw[i + 1] == 10 && raw[i + 2] == 13 && raw[i + 3] == 10) { split = i; break; }
        String head = new String(raw, 0, split, "ISO-8859-1");
        Resp r = new Resp();
        String[] lines = head.split("\r\n");
        r.code = Integer.parseInt(lines[0].split(" ")[1]);
        for (String l : lines) {
            String low = l.toLowerCase();
            if (low.startsWith("content-type:")) r.ctype = l.substring(13).trim();
            if (low.startsWith("accept-ranges:")) r.acceptRanges = l.substring(14).trim();
            if (low.startsWith("content-range:")) r.contentRange = l.substring(14).trim();
        }
        r.body = java.util.Arrays.copyOfRange(raw, split + 4, raw.length);
        return r;
    }
}
