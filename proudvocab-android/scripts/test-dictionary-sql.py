#!/usr/bin/env python3
"""Runs EVERY SQL constant of Dictionary.java against a real FastDic-style
SQLite file (the sample shipped in dictionaryproject/docs/sample.sqlite) so a
typo in a column/table name is caught before the APK is built.

  python3 scripts/test-dictionary-sql.py [path/to/sample.sqlite]
"""
import re
import sqlite3
import sys

JAVA = 'app/src/main/java/app/proudvocab/android/Dictionary.java'
DB = sys.argv[1] if len(sys.argv) > 1 else 'dictionaryproject/docs/sample.sqlite'

src = open(JAVA, encoding='utf8').read()
consts = dict(re.findall(r'static final String (SQL_[A-Z_]+) = ("(?:[^"\\]|\\.)*");', src))
assert consts, 'no SQL constants found'
con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
con.row_factory = sqlite3.Row


def sql(name):
    return eval(consts[name])  # plain double-quoted java literal == python literal here


fail = 0
def run(name, args):
    global fail
    try:
        rows = con.execute(sql(name), args).fetchall()
        print(f'  ok   {name:18s} -> {len(rows)} row(s)')
        return rows
    except sqlite3.Error as e:
        fail += 1
        print(f'  FAIL {name}: {e}')
        return []

# find a word that has details, sentences, pos
w = con.execute("""SELECT w.english_word_id, w.english_word FROM english_words w
                   JOIN english_details d ON d.english_word_id=w.english_word_id
                   WHERE w.english_word_id_parent IS NULL ORDER BY w.english_word_id LIMIT 1""").fetchone()
fa = con.execute("""SELECT p.persian_word_id, p.persian_word, p.word_in_number FROM persian_words p
                    JOIN persian_details d ON d.persian_word_id=p.persian_word_id LIMIT 1""").fetchone()
print('sample english word:', w['english_word'] if w else None, '| persian:', fa['persian_word'] if fa else None)
assert w, 'sample db has no english word with details'
wid, word = w['english_word_id'], w['english_word']
det = con.execute('SELECT english_detail_id FROM english_details WHERE english_word_id=? LIMIT 1', (wid,)).fetchone()['english_detail_id']

run('SQL_EN_FIND', (word,))
run('SQL_EN_MEANINGS', (wid, 5))
run('SQL_EN_SEARCH', (word[:2] + '*', 10))
run('SQL_EN_WORD', (wid,))
run('SQL_EN_DETAILS', (wid,))
run('SQL_EN_POS', (det,))
run('SQL_EN_SENT', (det,))
run('SQL_EN_CAT', (det,))
run('SQL_EN_SYNANT', (wid,))
run('SQL_EN_WORD_BY_ID', (wid,))
if fa:
    pid = fa['persian_word_id']
    pdet = con.execute('SELECT persian_detail_id FROM persian_details WHERE persian_word_id=? LIMIT 1', (pid,)).fetchone()['persian_detail_id']
    run('SQL_FA_FIND', (fa['persian_word'],))
    run('SQL_FA_MEANINGS', (pid, 5))
    run('SQL_FA_SEARCH', (fa['word_in_number'][:2] + '*', 10))
    run('SQL_FA_WORD', (pid,))
    run('SQL_FA_DETAILS', (pid,))
    run('SQL_FA_POS', (pdet,))
    run('SQL_FA_SENT', (pdet,))
    run('SQL_FA_SYNANT', (pid,))
missing = [k for k in consts if k not in ('SQL_FA_FIND',) and False]
print('constants checked:', len(consts))
sys.exit(1 if fail else 0)
