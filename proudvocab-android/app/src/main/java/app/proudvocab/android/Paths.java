package app.proudvocab.android;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The web layer identifies a file by one opaque string ("path").
 * On Android that string is a SAF content URI followed by a fragment that
 * carries the human readable file name:
 *
 *   content://com.android.externalstorage.documents/document/primary%3AMovies%2Fa.mkv#pvn=a.mkv
 *
 * The fragment is stripped before the URI is handed to the ContentResolver.
 * Pure Java on purpose (unit-testable on a plain JVM).
 */
final class Paths {
    static final String MARK = "#pvn=";

    private static final Set<String> VIDEO_EXT = new HashSet<>(Arrays.asList(
            ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".ogv", ".avi", ".wmv", ".flv",
            ".mpg", ".mpeg", ".ts", ".m2ts", ".3gp", ".3g2", ".vob", ".mts"));
    private static final Set<String> SUB_EXT = new HashSet<>(Arrays.asList(
            ".srt", ".vtt", ".ass", ".ssa", ".sub"));

    private Paths() { }

    /** The URI part of a path (without the #pvn= fragment). */
    static String strip(String path) {
        if (path == null) return "";
        int i = path.indexOf(MARK);
        return i >= 0 ? path.substring(0, i) : path;
    }

    static String make(String uri, String name) {
        String n = name == null ? "" : name;
        try {
            return uri + MARK + URLEncoder.encode(n, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            return uri;
        }
    }

    static String nameOf(String path) {
        if (path == null) return "";
        int i = path.indexOf(MARK);
        try {
            if (i >= 0) return URLDecoder.decode(path.substring(i + MARK.length()).replace("+", "%2B"), "UTF-8");
            String s = path;
            int q = s.indexOf('?');
            if (q >= 0) s = s.substring(0, q);
            String last = s.substring(s.lastIndexOf('/') + 1);
            String dec = URLDecoder.decode(last.replace("+", "%2B"), "UTF-8");
            int c = Math.max(dec.lastIndexOf('/'), dec.lastIndexOf(':'));
            return c >= 0 ? dec.substring(c + 1) : dec;
        } catch (Exception e) {
            return path;
        }
    }

    static String ext(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot).toLowerCase(Locale.ROOT);
    }

    static boolean isVideoName(String name) { return VIDEO_EXT.contains(ext(name)); }

    static boolean isSubtitleName(String name) { return SUB_EXT.contains(ext(name)); }

    static boolean isVideo(String name, String mime) {
        if (isVideoName(name)) return true;
        return mime != null && mime.toLowerCase(Locale.ROOT).startsWith("video/") && !isSubtitleName(name);
    }

    static String mimeForName(String name) {
        switch (ext(name)) {
            case ".mp4": case ".m4v": return "video/mp4";
            case ".mov": return "video/quicktime";
            case ".mkv": return "video/x-matroska";
            case ".webm": return "video/webm";
            case ".ogv": return "video/ogg";
            case ".avi": return "video/x-msvideo";
            case ".wmv": return "video/x-ms-wmv";
            case ".flv": return "video/x-flv";
            case ".mpg": case ".mpeg": return "video/mpeg";
            case ".ts": case ".m2ts": case ".mts": return "video/mp2t";
            case ".3gp": return "video/3gpp";
            case ".3g2": return "video/3gpp2";
            case ".vob": return "video/dvd";
            default: return null;
        }
    }

    /** Natural ordering (ep2 < ep10) used for playlists. */
    static int naturalCompare(String a, String b) {
        String x = a.toLowerCase(Locale.ROOT), y = b.toLowerCase(Locale.ROOT);
        int i = 0, j = 0;
        while (i < x.length() && j < y.length()) {
            char c = x.charAt(i), d = y.charAt(j);
            if (Character.isDigit(c) && Character.isDigit(d)) {
                int si = i, sj = j;
                while (i < x.length() && Character.isDigit(x.charAt(i))) i++;
                while (j < y.length() && Character.isDigit(y.charAt(j))) j++;
                String nx = x.substring(si, i).replaceFirst("^0+(?=.)", "");
                String ny = y.substring(sj, j).replaceFirst("^0+(?=.)", "");
                if (nx.length() != ny.length()) return nx.length() - ny.length();
                int cmp = nx.compareTo(ny);
                if (cmp != 0) return cmp;
            } else {
                if (c != d) return c - d;
                i++;
                j++;
            }
        }
        return (x.length() - i) - (y.length() - j);
    }
}
