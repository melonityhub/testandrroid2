package app.proudvocab.android;

import android.content.ContentResolver;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PushbackInputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Offline dictionary. The user supplies a SQLite file with the same schema as
 * the FastDic database used by the "dictionaryproject" repo
 * (english_words / english_details / persian_words / ...). The file is copied
 * into app-private storage once and then queried read-only.
 *
 * Every query below is the same SQL the reference project uses (see
 * scripts/test-dictionary-sql.py which runs them against docs/sample.sqlite).
 */
final class Dictionary {

    interface Progress { void onProgress(long done, long total); }

    /* ---- SQL (verified by scripts/test-dictionary-sql.py) ---- */
    static final String SQL_EN_FIND = "SELECT english_word_id, english_word_id_parent FROM english_words WHERE english_word = ? LIMIT 1";
    static final String SQL_FA_FIND = "SELECT persian_word_id, persian_word_id_parent FROM persian_words WHERE persian_word = ? LIMIT 1";
    static final String SQL_EN_MEANINGS = "SELECT persian_meaning FROM english_details WHERE english_word_id = ? ORDER BY position, english_detail_id LIMIT ?";
    static final String SQL_FA_MEANINGS = "SELECT english_meaning FROM persian_details WHERE persian_word_id = ? ORDER BY position, persian_detail_id LIMIT ?";
    static final String SQL_EN_SEARCH = "SELECT english_word, english_word_id, english_word_id_parent FROM english_words WHERE english_word GLOB ? ORDER BY english_word LIMIT ?";
    static final String SQL_FA_SEARCH = "SELECT persian_word, persian_word_id, persian_word_id_parent FROM persian_words WHERE word_in_number GLOB ? ORDER BY length(word_in_number) LIMIT ?";
    static final String SQL_EN_WORD = "SELECT english_word, simple_past, past_participle, infinitive, plural, present_participle, third_person_singular, comparative, superlative FROM english_words WHERE english_word_id = ?";
    static final String SQL_EN_DETAILS = "SELECT english_detail_id, persian_meaning, countable_uncountable, formal_informal, british_american, cefr FROM english_details WHERE english_word_id = ? ORDER BY position, english_detail_id";
    static final String SQL_EN_POS = "SELECT pos FROM english_pos WHERE english_detail_id = ?";
    static final String SQL_EN_SENT = "SELECT english_sentence, persian_sentence FROM english_sentences WHERE english_detail_id = ? ORDER BY position, english_sentence_id LIMIT 6";
    static final String SQL_EN_CAT = "SELECT category FROM english_categories WHERE english_detail_id = ?";
    static final String SQL_EN_SYNANT = "SELECT definitions, synonyms, antonyms, pos FROM english_synonyms_antonyms WHERE english_word_id = ? ORDER BY position, english_synonyms_antonyms_id LIMIT 8";
    static final String SQL_EN_WORD_BY_ID = "SELECT english_word FROM english_words WHERE english_word_id = ?";
    static final String SQL_FA_WORD = "SELECT persian_word FROM persian_words WHERE persian_word_id = ?";
    static final String SQL_FA_DETAILS = "SELECT persian_detail_id, english_meaning, persian_phonetic, persian_meaning FROM persian_details WHERE persian_word_id = ? ORDER BY position, persian_detail_id";
    static final String SQL_FA_POS = "SELECT pos FROM persian_pos WHERE persian_detail_id = ?";
    static final String SQL_FA_SENT = "SELECT english_sentence, persian_sentence FROM persian_sentences WHERE persian_detail_id = ? ORDER BY position, persian_sentence_id LIMIT 6";
    static final String SQL_FA_SYNANT = "SELECT synonym_antonym FROM persian_synonyms_antonyms WHERE persian_word_id = ? ORDER BY position, persian_synonyms_antonyms_id LIMIT 8";

    private final File dir;
    private final File dbFile;
    private final File metaFile;
    private final Object lock = new Object();
    private SQLiteDatabase db;

    Dictionary(File filesDir) {
        dir = new File(filesDir, "dictionary");
        dbFile = new File(dir, "dictionary.sqlite");
        metaFile = new File(dir, "meta.json");
    }

    /* ================================================================ status */

    JSONObject status() {
        JSONObject o = new JSONObject();
        boolean installed = dbFile.isFile() && dbFile.length() > 0;
        put(o, "installed", installed);
        if (installed) {
            JSONObject m = readMeta();
            put(o, "name", m.optString("name", "dictionary.sqlite"));
            put(o, "size", dbFile.length());
            put(o, "englishWords", m.optLong("en", 0));
            put(o, "persianWords", m.optLong("fa", 0));
            put(o, "importedAt", m.optLong("at", 0));
        }
        return o;
    }

    boolean isInstalled() { return dbFile.isFile() && dbFile.length() > 0; }

    void remove() {
        synchronized (lock) {
            closeDb();
            //noinspection ResultOfMethodCallIgnored
            dbFile.delete();
            //noinspection ResultOfMethodCallIgnored
            metaFile.delete();
        }
    }

    /* ================================================================ import */

    /** @return {"ok":true,"status":{..}} or {"ok":false,"error":"code"} */
    JSONObject importFrom(Context ctx, Uri src, String displayName, Progress progress) {
        JSONObject res = new JSONObject();
        File tmp = new File(dir, "dictionary.sqlite.tmp");
        try {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            if (tmp.exists() && !tmp.delete()) throw new IOException("cannot clear temp file");

            ContentResolver cr = ctx.getContentResolver();
            long total = -1;
            try (AssetFileDescriptor afd = cr.openAssetFileDescriptor(src, "r")) {
                if (afd != null) total = afd.getLength();
            } catch (Exception ignore) { /* size is only used for progress */ }

            InputStream raw = cr.openInputStream(src);
            if (raw == null) return fail(res, "io");
            final CountingInputStream counting = new CountingInputStream(raw);
            PushbackInputStream pin = new PushbackInputStream(counting, 32);
            try {
                byte[] magic = new byte[16];
                int got = readFully(pin, magic);
                if (got < 4) return fail(res, "not_sqlite");
                pin.unread(magic, 0, got);

                InputStream data;
                if (startsWithSqlite(magic, got)) {
                    data = pin;
                } else if (magic[0] == 'P' && magic[1] == 'K') {
                    ZipInputStream zin = new ZipInputStream(pin);
                    ZipEntry e;
                    boolean found = false;
                    while ((e = zin.getNextEntry()) != null) {
                        if (!e.isDirectory()) { found = true; break; }
                    }
                    if (!found) return fail(res, "not_sqlite");
                    data = zin;
                } else if ((magic[0] & 0xFF) == 0x1F && (magic[1] & 0xFF) == 0x8B) {
                    data = new GZIPInputStream(pin);
                } else {
                    return fail(res, "not_sqlite");
                }

                if (total > 0 && startsWithSqlite(magic, got) && dir.getUsableSpace() < total + (8L << 20)) {
                    return fail(res, "no_space");
                }

                long lastReport = 0;
                byte[] buf = new byte[256 * 1024];
                try (OutputStream out = new BufferedOutputStream(new FileOutputStream(tmp), 256 * 1024)) {
                    int n;
                    while ((n = data.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        long now = counting.count;
                        if (progress != null && now - lastReport >= (1L << 20)) {
                            lastReport = now;
                            progress.onProgress(now, total);
                        }
                    }
                }
                if (progress != null) progress.onProgress(total > 0 ? total : counting.count, total);
            } finally {
                try { raw.close(); } catch (IOException ignore) { /* ignore */ }
            }

            // ---- validate
            byte[] head = new byte[16];
            try (java.io.FileInputStream fin = new java.io.FileInputStream(tmp)) {
                if (readFully(fin, head) < 16 || !startsWithSqlite(head, 16)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                    return fail(res, "not_sqlite");
                }
            }
            long en;
            long fa;
            SQLiteDatabase t = null;
            try {
                t = SQLiteDatabase.openDatabase(tmp.getPath(), null,
                        SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
                if (!hasTable(t, "english_words") || !hasTable(t, "english_details")) {
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                    return fail(res, "no_tables");
                }
                en = count(t, "english_words");
                fa = hasTable(t, "persian_words") ? count(t, "persian_words") : 0;
                if (en <= 0) {
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                    return fail(res, "empty");
                }
            } finally {
                if (t != null) t.close();
            }

            // ---- install
            synchronized (lock) {
                closeDb();
                //noinspection ResultOfMethodCallIgnored
                dbFile.delete();
                if (!tmp.renameTo(dbFile)) throw new IOException("rename failed");
                JSONObject m = new JSONObject();
                put(m, "name", displayName == null || displayName.isEmpty() ? "dictionary.sqlite" : displayName);
                put(m, "en", en);
                put(m, "fa", fa);
                put(m, "at", System.currentTimeMillis());
                writeMeta(m);
            }
            put(res, "ok", true);
            put(res, "status", status());
            return res;
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            String msg = String.valueOf(e.getMessage());
            return fail(res, msg.contains("ENOSPC") || msg.toLowerCase(Locale.ROOT).contains("no space") ? "no_space" : "io");
        }
    }

    /* ================================================================ lookups */

    /** Short translation for the tooltip. {"found":false} when unknown. */
    JSONObject translate(String raw) {
        JSONObject out = new JSONObject();
        put(out, "found", false);
        SQLiteDatabase d = open();
        if (d == null || raw == null) return out;
        try {
            if (isPersian(raw)) {
                String w = normalizeFa(raw);
                if (w.isEmpty() || w.length() > 100) return out;
                long id = resolveId(d, SQL_FA_FIND, w);
                if (id < 0) return out;
                String tr = joinMeanings(d, SQL_FA_MEANINGS, id, ", ", 5);
                if (tr.isEmpty()) return out;
                put(out, "found", true);
                put(out, "lang", "Persian");
                put(out, "word", w);
                put(out, "translation", tr);
                return out;
            }
            for (String cand : candidatesEn(raw)) {
                long id = resolveId(d, SQL_EN_FIND, cand);
                if (id < 0) continue;
                String tr = joinMeanings(d, SQL_EN_MEANINGS, id, "\u060c ", 5);
                if (tr.isEmpty()) continue;
                put(out, "found", true);
                put(out, "lang", "English");
                put(out, "word", cand);
                put(out, "translation", tr);
                return out;
            }
        } catch (RuntimeException e) {
            // corrupt / unexpected schema -> behave as "not found"
        }
        return out;
    }

    /** Prefix search for the dictionary screen. */
    JSONObject search(String query, int limit) {
        JSONObject out = new JSONObject();
        JSONArray items = new JSONArray();
        put(out, "items", items);
        SQLiteDatabase d = open();
        if (d == null || query == null) return out;
        int lim = Math.max(1, Math.min(limit <= 0 ? 30 : limit, 60));
        try {
            if (isPersian(query)) {
                String w = normalizeFa(query);
                if (w.isEmpty() || w.length() > 100) return out;
                Cursor c = d.rawQuery(SQL_FA_SEARCH, new String[]{globEscape(peToNumber(w)) + "*", String.valueOf(lim)});
                try {
                    while (c.moveToNext()) {
                        long id = c.getLong(1);
                        long parent = c.isNull(2) ? -1 : c.getLong(2);
                        JSONObject it = new JSONObject();
                        put(it, "word", c.getString(0));
                        put(it, "lang", "Persian");
                        put(it, "meaning", firstMeaning(d, SQL_FA_MEANINGS, parent >= 0 ? parent : id));
                        items.put(it);
                    }
                } finally { c.close(); }
            } else {
                String w = normalizeEn(query);
                if (w == null || w.isEmpty()) return out;
                Cursor c = d.rawQuery(SQL_EN_SEARCH, new String[]{globEscape(w) + "*", String.valueOf(lim)});
                try {
                    while (c.moveToNext()) {
                        long id = c.getLong(1);
                        long parent = c.isNull(2) ? -1 : c.getLong(2);
                        JSONObject it = new JSONObject();
                        put(it, "word", c.getString(0));
                        put(it, "lang", "English");
                        put(it, "meaning", firstMeaning(d, SQL_EN_MEANINGS, parent >= 0 ? parent : id));
                        items.put(it);
                    }
                } finally { c.close(); }
            }
        } catch (RuntimeException e) {
            // ignore, return what we have
        }
        return out;
    }

    /** Full entry (meanings, POS, examples, forms, synonyms...). */
    JSONObject detail(String raw) {
        JSONObject out = new JSONObject();
        put(out, "found", false);
        SQLiteDatabase d = open();
        if (d == null || raw == null) return out;
        try {
            if (isPersian(raw)) {
                String w = normalizeFa(raw);
                long id = resolveId(d, SQL_FA_FIND, w);
                if (id < 0) return out;
                return persianEntry(d, id);
            }
            for (String cand : candidatesEn(raw)) {
                long id = resolveId(d, SQL_EN_FIND, cand);
                if (id >= 0) return englishEntry(d, id);
            }
        } catch (RuntimeException e) {
            // fall through
        }
        return out;
    }

    private JSONObject englishEntry(SQLiteDatabase d, long id) {
        JSONObject out = new JSONObject();
        put(out, "found", true);
        put(out, "lang", "English");
        JSONObject forms = new JSONObject();
        Cursor c = d.rawQuery(SQL_EN_WORD, new String[]{String.valueOf(id)});
        try {
            if (!c.moveToFirst()) { put(out, "found", false); return out; }
            put(out, "word", c.getString(0));
            String[] keys = {"simplePast", "pastParticiple", "infinitive", "plural", "presentParticiple", "thirdPerson", "comparative", "superlative"};
            for (int i = 0; i < keys.length; i++) {
                if (!c.isNull(i + 1)) {
                    String f = oneString(d, SQL_EN_WORD_BY_ID, c.getLong(i + 1));
                    if (f != null) put(forms, keys[i], f);
                }
            }
        } finally { c.close(); }
        put(out, "forms", forms);

        JSONArray meanings = new JSONArray();
        c = d.rawQuery(SQL_EN_DETAILS, new String[]{String.valueOf(id)});
        try {
            while (c.moveToNext() && meanings.length() < 40) {
                long did = c.getLong(0);
                JSONObject m = new JSONObject();
                put(m, "meaning", clean(c.getString(1)));
                if (!c.isNull(2)) put(m, "countable", c.getInt(2) == 1);
                if (!c.isNull(3)) put(m, "formal", c.getInt(3) == 1);
                if (!c.isNull(4)) put(m, "british", c.getInt(4) == 1);
                if (!c.isNull(5)) put(m, "cefr", c.getString(5));
                JSONArray pos = new JSONArray();
                for (long p : longs(d, SQL_EN_POS, did)) {
                    JSONObject po = new JSONObject();
                    put(po, "en", FdData.pos(FdData.POS_EN, (int) p));
                    put(po, "fa", FdData.pos(FdData.POS_EN_FA, (int) p));
                    pos.put(po);
                }
                put(m, "pos", pos);
                put(m, "sentences", sentences(d, SQL_EN_SENT, did));
                JSONArray cats = new JSONArray();
                for (long cat : longs(d, SQL_EN_CAT, did)) {
                    String nm = FdData.pos(FdData.CATEGORY, (int) cat);
                    if (!nm.isEmpty()) cats.put(nm);
                }
                put(m, "categories", cats);
                meanings.put(m);
            }
        } finally { c.close(); }
        put(out, "meanings", meanings);

        JSONArray sa = new JSONArray();
        c = d.rawQuery(SQL_EN_SYNANT, new String[]{String.valueOf(id)});
        try {
            while (c.moveToNext()) {
                JSONObject s = new JSONObject();
                put(s, "definitions", clean(c.getString(0)));
                put(s, "synonyms", clean(c.getString(1)));
                put(s, "antonyms", clean(c.getString(2)));
                put(s, "pos", c.getString(3));
                sa.put(s);
            }
        } finally { c.close(); }
        put(out, "synAnt", sa);
        return out;
    }

    private JSONObject persianEntry(SQLiteDatabase d, long id) {
        JSONObject out = new JSONObject();
        put(out, "found", true);
        put(out, "lang", "Persian");
        put(out, "word", oneString(d, SQL_FA_WORD, id));
        JSONArray details = new JSONArray();
        Cursor c = d.rawQuery(SQL_FA_DETAILS, new String[]{String.valueOf(id)});
        try {
            while (c.moveToNext() && details.length() < 40) {
                long did = c.getLong(0);
                JSONObject m = new JSONObject();
                put(m, "meaning", clean(c.getString(1)));
                put(m, "phonetic", c.isNull(2) ? "" : c.getString(2).replaceAll("[0-9]", ""));
                put(m, "persianMeaning", clean(c.isNull(3) ? "" : c.getString(3)));
                JSONArray pos = new JSONArray();
                for (long p : longs(d, SQL_FA_POS, did)) {
                    JSONObject po = new JSONObject();
                    put(po, "fa", FdData.pos(FdData.POS_FA, (int) p));
                    put(po, "en", FdData.pos(FdData.POS_FA_EN, (int) p));
                    pos.put(po);
                }
                put(m, "pos", pos);
                put(m, "sentences", sentences(d, SQL_FA_SENT, did));
                details.put(m);
            }
        } finally { c.close(); }
        put(out, "details", details);
        JSONArray sa = new JSONArray();
        c = d.rawQuery(SQL_FA_SYNANT, new String[]{String.valueOf(id)});
        try {
            while (c.moveToNext()) sa.put(clean(c.getString(0)));
        } finally { c.close(); }
        put(out, "synAnt", sa);
        return out;
    }

    /* ================================================================ helpers */

    private SQLiteDatabase open() {
        synchronized (lock) {
            if (db != null && db.isOpen()) return db;
            if (!isInstalled()) return null;
            try {
                db = SQLiteDatabase.openDatabase(dbFile.getPath(), null,
                        SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
            } catch (RuntimeException e) {
                db = null;
            }
            return db;
        }
    }

    private void closeDb() {
        if (db != null) {
            try { db.close(); } catch (RuntimeException ignore) { /* ignore */ }
            db = null;
        }
    }

    /** id of the headword; inflected forms redirect to their parent entry. -1 if unknown */
    private static long resolveId(SQLiteDatabase d, String sql, String word) {
        Cursor c = d.rawQuery(sql, new String[]{word});
        try {
            if (!c.moveToFirst()) return -1;
            if (!c.isNull(1)) return c.getLong(1);
            return c.getLong(0);
        } finally { c.close(); }
    }

    private static String joinMeanings(SQLiteDatabase d, String sql, long id, String sep, int max) {
        Cursor c = d.rawQuery(sql, new String[]{String.valueOf(id), String.valueOf(max)});
        StringBuilder sb = new StringBuilder();
        try {
            while (c.moveToNext()) {
                if (c.isNull(0)) continue;
                String m = clean(c.getString(0));
                if (m.isEmpty()) continue;
                if (sb.length() > 0) sb.append(sep);
                sb.append(m);
                if (sb.length() > 240) break;
            }
        } finally { c.close(); }
        String s = sb.toString();
        return s.length() > 260 ? s.substring(0, 257) + "..." : s;
    }

    private static String firstMeaning(SQLiteDatabase d, String sql, long id) {
        return joinMeanings(d, sql, id, "\u060c ", 1);
    }

    private static String oneString(SQLiteDatabase d, String sql, long id) {
        Cursor c = d.rawQuery(sql, new String[]{String.valueOf(id)});
        try {
            return c.moveToFirst() && !c.isNull(0) ? c.getString(0) : null;
        } finally { c.close(); }
    }

    private static List<Long> longs(SQLiteDatabase d, String sql, long id) {
        List<Long> r = new ArrayList<>();
        Cursor c = d.rawQuery(sql, new String[]{String.valueOf(id)});
        try {
            while (c.moveToNext()) if (!c.isNull(0)) r.add(c.getLong(0));
        } finally { c.close(); }
        return r;
    }

    private static JSONArray sentences(SQLiteDatabase d, String sql, long id) {
        JSONArray a = new JSONArray();
        Cursor c = d.rawQuery(sql, new String[]{String.valueOf(id)});
        try {
            while (c.moveToNext()) {
                JSONObject s = new JSONObject();
                put(s, "en", clean(c.isNull(0) ? "" : c.getString(0)));
                put(s, "fa", clean(c.isNull(1) ? "" : c.getString(1)));
                a.put(s);
            }
        } finally { c.close(); }
        return a;
    }

    private static boolean hasTable(SQLiteDatabase d, String name) {
        Cursor c = d.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", new String[]{name});
        try { return c.moveToFirst(); } finally { c.close(); }
    }

    private static long count(SQLiteDatabase d, String table) {
        Cursor c = d.rawQuery("SELECT COUNT(*) FROM " + table, null);
        try { return c.moveToFirst() ? c.getLong(0) : 0; } finally { c.close(); }
    }

    /* ---- text normalisation ---- */

    /** strip html tags / control characters coming from the database */
    static String clean(String s) {
        if (s == null) return "";
        return s.replaceAll("<[^>]*>", "").replaceAll("[\\r\\n\\t]+", " ").replaceAll(" {2,}", " ").trim();
    }

    static boolean isPersian(String text) {
        if (text == null || text.isEmpty()) return false;
        int fa = 0;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if ((ch >= 0x0600 && ch <= 0x06FF) || (ch >= 0xFB50 && ch <= 0xFDFF) || (ch >= 0xFE70 && ch <= 0xFEFF)) fa++;
        }
        return fa >= text.length() - fa;
    }

    static String normalizeEn(String raw) {
        if (raw == null) return null;
        String s = raw.replace('\u2019', '\'').replace('\u2018', '\'').trim().toLowerCase(Locale.ROOT);
        s = s.replaceAll("^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$", "");
        s = s.replaceAll("\\s+", " ");
        return s.length() > 100 ? null : s;
    }

    static String normalizeFa(String raw) {
        if (raw == null) return "";
        String s = charReplacement(raw.trim());
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == 0x064A) ch = 0x06CC;          // arabic yeh -> persian yeh
            else if (ch == 0x0643) ch = 0x06A9;     // arabic kaf -> persian kaf
            else if (ch == 0x0640 || (ch >= 0x064B && ch <= 0x0652)) continue; // tatweel / harakat
            sb.append(ch);
        }
        return sb.toString().replaceAll("^[^\\p{L}\\p{N}\\u200c]+|[^\\p{L}\\p{N}\\u200c]+$", "");
    }

    /** StringUtils.charReplacement of the reference app (sequential, 128 entries). */
    static String charReplacement(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (int k = 0; k < s.length(); k++) {
            int c = s.charAt(k);
            for (int i = 0; i < 128; i++) {
                if (c == FdData.BROKEN[i]) c = FdData.CORRECT[i];
            }
            out.append((char) c);
        }
        return out.toString();
    }

    /** StringUtils.peCharacterToNumber: builds the key stored in persian_words.word_in_number */
    static String peToNumber(String word) {
        if (word == null) return "";
        for (String[] pair : FdData.PE_TO_NUMBER) word = word.replace(pair[0], pair[1]);
        return word;
    }

    static String globEscape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 4);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '*' || ch == '?' || ch == '[') sb.append('[').append(ch).append(']');
            else sb.append(ch);
        }
        return sb.toString();
    }

    /** the word itself plus a few simple de-inflections (the db also has parent links) */
    static List<String> candidatesEn(String raw) {
        Set<String> out = new LinkedHashSet<>();
        String w = normalizeEn(raw);
        if (w == null || w.isEmpty()) return new ArrayList<>(out);
        out.add(w);
        if (w.endsWith("'s")) out.add(w.substring(0, w.length() - 2));
        if (w.endsWith("n't")) { out.add(w.substring(0, w.length() - 3)); }
        if (w.endsWith("ies") && w.length() > 4) out.add(w.substring(0, w.length() - 3) + "y");
        if (w.endsWith("es") && w.length() > 3) out.add(w.substring(0, w.length() - 2));
        if (w.endsWith("s") && w.length() > 2) out.add(w.substring(0, w.length() - 1));
        if (w.endsWith("ied") && w.length() > 4) out.add(w.substring(0, w.length() - 3) + "y");
        if (w.endsWith("ed") && w.length() > 3) { out.add(w.substring(0, w.length() - 2)); out.add(w.substring(0, w.length() - 1)); }
        if (w.endsWith("ing") && w.length() > 4) {
            String stem = w.substring(0, w.length() - 3);
            out.add(stem);
            out.add(stem + "e");
            if (stem.length() > 2 && stem.charAt(stem.length() - 1) == stem.charAt(stem.length() - 2)) out.add(stem.substring(0, stem.length() - 1));
        }
        if (w.endsWith("ly") && w.length() > 3) out.add(w.substring(0, w.length() - 2));
        return new ArrayList<>(out);
    }

    /* ---- misc ---- */

    private static boolean startsWithSqlite(byte[] b, int len) {
        byte[] m = "SQLite format 3".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        if (len < m.length) return false;
        for (int i = 0; i < m.length; i++) if (b[i] != m[i]) return false;
        return true;
    }

    private static int readFully(InputStream in, byte[] b) throws IOException {
        int off = 0;
        while (off < b.length) {
            int n = in.read(b, off, b.length - off);
            if (n < 0) break;
            off += n;
        }
        return off;
    }

    private JSONObject readMeta() {
        try (java.io.FileInputStream in = new java.io.FileInputStream(metaFile)) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return new JSONObject(bo.toString("UTF-8"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeMeta(JSONObject m) throws IOException {
        try (FileOutputStream out = new FileOutputStream(metaFile)) {
            out.write(m.toString().getBytes("UTF-8"));
        }
    }

    private static JSONObject fail(JSONObject o, String code) {
        put(o, "ok", false);
        put(o, "error", code);
        return o;
    }

    static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v == null ? JSONObject.NULL : v); } catch (JSONException ignore) { /* keys are never null */ }
    }

    private static final class CountingInputStream extends FilterInputStream {
        long count;
        CountingInputStream(InputStream in) { super(in); }
        @Override public int read() throws IOException {
            int b = super.read();
            if (b >= 0) count++;
            return b;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            int n = super.read(b, off, len);
            if (n > 0) count += n;
            return n;
        }
    }
}
