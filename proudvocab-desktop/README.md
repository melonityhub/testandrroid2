# ProudVocab Desktop 🎬📚

**نسخهٔ دسکتاپ (ویندوز) افزونهٔ ProudVocab — یادگیری لغت از فیلم، با فایل‌های ویدیویی و زیرنویس SRT روی کامپیوتر خودتان.**

Desktop port of the [ProudVocab](https://github.com/mohsenamiri/proudvocab) browser extension:
learn vocabulary from **local video files** with your **own SRT/VTT/ASS subtitle files** —
clickable word chips, CEFR levels, translations, dual (Persian) subtitles, SRS review,
games, archive and Anki export, all inside one Windows app.

---

## ✨ امکانات / Features

| | |
|---|---|
| 🎞️ پخش‌کنندهٔ داخلی | پخش فایل ویدیویی محلی (mp4 / mkv / webm / mov …) با کنترل‌های کامل: سرعت، صدا، پرش، فریم‌به‌فریم |
| 📄 زیرنویس محلی | بارگذاری SRT / VTT / SSA / ASS / SUB (+ MicroDVD) با تشخیص خودکار رمزگشایی (UTF-8، windows-1256، …) |
| 🖱️ چیپ‌های کلمه | کلیک/هاور روی هر کلمهٔ زیرنویس → ترجمه، سطح CEFR (رنگی)، اصطلاح و phrasal verb |
| 🌗 زیرنویس دولایه | خط دوم با ترجمهٔ فارسی (Google Translate) زیر خط اصلی |
| 🃏 مرور مجدد (SRS) | جعبهٔ لایتنر/مرور مجدد، بازی‌ها، آرشیو کلمه‌ها، خروجی Anki و JSON |
| ⚙️ تنظیمات کامل | همان پنل تنظیمات افزونه (اندازه/رنگ/موقعیت زیرنویس، زبان‌ها، میان‌برها، …) + تب «Local» |
| 🔒 حریم خصوصی | هیچ مرورگر تعبیه‌شده‌ای نیست؛ هیچ ویدیویی آپلود نمی‌شود؛ داده‌ها در پوشهٔ AppData خودتان |

> ⚠️ تفاوت با افزونه: پخش از YouTube / Netflix / Prime در نسخهٔ دسکتاپ **حذف** شده و فقط
> فایل محلی پخش می‌شود. همگام‌سازی گوگل‌درایو هم در دسترس نیست (به OAuth مرورگر نیاز دارد)؛
> به‌جایش همه‌چیز به‌صورت خودکار روی همین کامپیوتر ذخیره می‌شود و از آرشیو می‌توانید خروجی بگیرید.
> منطق لایسنس/پریمیوم افزونه دست‌نخورده باقی مانده است.

---

## 🚀 شروع سریع (کاربر نهایی)

1. یکی از خروجی‌های پوشهٔ `release/` را بردارید:
   - `ProudVocab-Desktop-1.0.0-Portable.exe` — تک‌فایل قابل‌حمل بدون نصب ✅ ساخته‌شده در همین sandbox (هنگام اجرا در پوشهٔ موقت استخراج می‌شود؛ کلمه‌ها و تنظیمات شما مثل همیشه در AppData ذخیره می‌شوند)
   - یا نصب‌کنندهٔ NSIS: روی ماشین ویندوز (یا CI با wine) اجرا کنید: `npm run dist:win` → `release/ProudVocab-Desktop-Setup-1.0.0.exe`
   - یا پوشهٔ `win-unpacked` را کپی کنید و `ProudVocab Desktop.exe` را اجرا کنید.
2. برنامه را باز کنید و یکی از این کارها را بکنید:
   - دکمهٔ **Open video** یا `Ctrl+O` → انتخاب فایل ویدیو
   - فایل ویدیو + زیرنویس را بکشید و روی پنجره رها کنید (drag & drop)
   - برای تست بدون فایل: منوی **File → Open sample video** (کلیپ نمونهٔ داخلی)
3. اگر زیرنویس هم‌نام ویدیو کنارش باشد (مثلاً `movie.srt`) خودکار بارگذاری می‌شود؛ وگرن `Ctrl+Shift+O`.
4. روی کلمه‌های رنگی زیرنویس کلیک کنید → ترجمه و سطح → دکمهٔ بوکمارک برای ذخیره.
5. پنل سمت راست (`Ctrl+B`) = ترنسکریپت زنده، مرور مجدد، بازی‌ها، آرشیو، تنظیمات.

### میان‌برهای صفحه‌کلید

| کلید | کار |
|---|---|
| `Space` | پخش / توقف |
| `←` / `→` | ۵ ثانیه عقب / جلو (`Shift` = ۱۵ ثانیه) |
| `Shift+↑` / `Shift+↓` | خط قبلی / بعدی زیرنویس |
| `R` | پخش دوبارهٔ خط جاری |
| `↑` / `↓` | صدا زیاد / کم · `M` بی‌صدا |
| `[` / `]` | سرعت پخش کمتر / بیشتر |
| `,` / `.` | یک فریم عقب / جلو (وقتی متوقف) |
| `0`…`9` | پرش به ۰٪…۹۰٪ ویدیو |
| `C` | منوی زیرنویس (تأخیر، دولایه، خاموش) · `S` بارگذاری SRT · `L` منوی فایل‌ها |
| `O` | انتخاب ویدیو · `P` نمایش/پنهان پنل · `T` همیشه‌بالا · `F` تمام‌صفحه |
| `Ctrl+O` / `Ctrl+Shift+O` / `Ctrl+Shift+F` | ویدیو / زیرنویس / پوشه به‌عنوان پلی‌لیست |
| `Numpad 4/6/8/2/5/0` | پیمایش چیپ‌های کلمه (میراث افزونه) · `Alt+←/→` جست‌وجوی افزونه |

---

## 🛠️ راهنمای توسعه‌دهنده

پیش‌نیاز: Node.js ≥ 20 و (اختیاری، فقط برای ساخت کلیپ نمونه) ffmpeg.

```bash
npm install          # electron + electron-builder
npm run vendor       # (اختیاری) بازسازی src/renderer/ext از سورس افزونه
npm start            # اجرای برنامه
npm run sample       # ساخت samples/sample-video.mp4 + .srt با ffmpeg
npm test             # تست واحد پارسر زیرنویس
npm run smoke        # تست end-to-end کامل (روی لینوکس: xvfb-run -a npm run smoke)
npm run dist:win     # ساخت نصب‌کنندهٔ NSIS ویندوز در release/
```

نکتهٔ ساخت روی ماشین‌های کم‌حافظه (مثل sandboxها):

```bash
ELECTRON_BUILDER_COMPRESSION_LEVEL=5 npm run dist:win   # مصرف RAM کمتر برای 7zip
```

وضعیت ساخت در sandbox لینوکسی (الکترون 44، electron-builder 26):

| خروجی | وضعیت |
|---|---|
| `win-unpacked` (پوشهٔ اجرایی ویندوز) | ✅ ساخته شد |
| Portable single-file exe | ✅ ساخته شد (`release/ProudVocab-Desktop-1.0.0-Portable.exe`) |
| نصب‌کنندهٔ NSIS | ⚠️ روی لینوکس به `wine` نیاز دارد که در این sandbox کار نمی‌کند؛ روی ویندوز/CI بدون مشکل ساخته می‌شود (`npm run dist:win`) |
| بررسی صحت بستهٔ asar | ✅ `--smoke` روی نسخهٔ بسته‌بندی‌شده (linux-unpacked) هم ۱۸/۱۸ پاس شد |

اسکریپت‌های پرکاربرد توسعه:

```bash
PV_NO_SANDBOX=1 npm start                 # روی لینوکس بدون SUID sandbox
PV_DEBUG_MEDIA=1 npm start                # لاگ درخواست‌های pv-media://
npm run smoke -- --no-sandbox             # خروجی در smoke-out/ (گزارش + اسکرین‌شات)
```

### ساختار پروژه

```
src/main/          فرآیند اصلی Electron: پنجره، منو، IPC، پروتکل‌ها، net.fetch
  main.js          همهٔ IPC + protocol.handle('app'|'pv-media') + منوها
  shared.js        ثابت‌ها/کمک‌ها (MIME، mediaUrlFor، localIdFor، …)
  smoke.js         تست end-to-end (npm run smoke)
src/preload/       پل امن renderer↔main (فهرست سفید کانال‌ها)
src/renderer/
  index.html       پوسته: نوار بالا + دو iframe (پلیر و پنل)
  shell.js         «اتوبوس» بین فریم‌ها: ثبت فریم‌ها، routing پیام/پورت/استوریج
  shell.css        تم تیرهٔ پوسته
  bg.html          فریم background (اجرای background.js واقعی افزونه)
  player/          پخش‌کنندهٔ محلی: player.html/css/js + srt.js + LocalAdapter.js
  desktop/         chrome-shim.js (شبیه‌ساز chrome.*)، desktop-panel.css، panel-desktop.js
  ext/             خروجی `npm run vendor`: کد افزونه + پچ‌ها (دست‌کاری نکنید)
scripts/vendor-ext.mjs   کپی + پچ سورس افزونه → src/renderer/ext
scripts/make-sample.mjs  ساخت کلیپ نمونه
test/srt.test.mjs        تست واحد پارسر زیرنویس
samples/                 ویدیو + زیرنویس نمونه
```

### معماری (چرا کار می‌کند)

- **یک پوسته، سه فریم هم‌origin** (`app://bundle/…`): پلیر، پنل، background. چون same-origin
  هستند، `shell.js` پیام‌ها/پورت‌ها/استوریج را به‌صورت هم‌زمان و بدون سریال‌سازی سنگین جابه‌جا می‌کند.
- **`chrome-shim.js`** یک پیاده‌سازی وفادار از APIهای موردنیاز افزونه است:
  `runtime.sendMessage/onMessage/connect/onConnect`، `storage.local/sync + onChanged`،
  `tabs.query/get/sendMessage/onUpdated`، `i18n`، `commands`، `identity` (ردِ مؤدبانهٔ OAuth)،
  `sidePanel`، `action`. کد افزونه **بدون تغییر منطقی** روی آن سوار می‌شود.
- **موتور زیرنویس** (`ext/content/inject_common.js`) از طریق `window.PlayerAdapter` با صفحه حرف
  می‌زند؛ `LocalAdapter.js` آن را به `<video>` و `.pv-caption-host` ما وصل می‌کند و زیرنویس پارس‌شده
  با رویداد `__primevocab_track_ready` به موتور داده می‌شود. نتیجه: چیپ‌ها، رنگ CEFR، تولتیپ ترجمه،
  زیرنویس دولایه، shadowing/auto-rewind و … همگی روی فایل محلی کار می‌کنند.
- **`pv-media://v/<base64url>`** فایل ویدیوی شما را با پشتیبانی Range (206) استریم می‌کند؛
  هویت ویدیو با `pv-local://…` ذخیره می‌شود تا «ادامه از همان‌جا» و آرشیو کار کنند.
- **ذخیره‌سازی**: `chrome.storage` شبیه‌سازی‌شده در حافظهٔ پوسته نگه داشته می‌شود و با تأخیرکم
  در `AppData/ProudVocab Desktop/proudvocab-data/store.json` نوشته می‌شود.

### پچ‌های اعمال‌شده روی کد افزونه (فقط `scripts/vendor-ext.mjs`)

1. `content/inject_common.js`: نگاشت `PlayerAdapter.name → کلید تنظیمات` حالا `"Local"` را می‌پذیرد
   (۴ محل) تا تنظیمات تب Local خوانده/نوشته شود.
2. `sidepanel/panel_settings.js`: تب/باکت `local` + تشخیص پلتفرم از URLهای `pv-local:`/`app:`.
3. `sidepanel/panel.html`: بارگذاری shim/CSS/JS دسکتاپ، دکمهٔ فیلتر «Local» به‌جای سه دکمهٔ
   استریم، افزودن زبان `fa` به منوهای زبان.
4. `_locales/*` + `langs/fa.json`: متن‌های بومی برای حالت دسکتاپ + بستهٔ زبان فارسی.

---

## 🩺 عیب‌یابی

- **ویدیو پخش نمی‌شود / صفحهٔ سیاه:** کدک ویدیو باید یکی از H.264 / VP9 / VP8 / AV1 یا AAC/MP3/Opus
  برای صدا باشد. فایل‌های HEVC/H.265، AVI/WMV/FLV ممکن است در Chromium پخش نشوند — پیام خطا با
  دکمهٔ «نمایش در پوشه» نمایش داده می‌شود؛ راه‌حل: تبدیل به mp4 (H.264).
- **زیرنویس فارسی به‌هم‌ریخته:** پارسر به‌ترتیب UTF-8 سپس windows-1256 را امتیازی می‌کند؛ اگر باز هم
  مشکل بود نام فایل را `movie.fa.srt` بگذارید تا رمزگشایی درست انتخاب شود.
- **ترجمهٔ خط دوم نیامد:** ترجمه از سرویس عمومی Google Translate گرفته می‌شود و به اینترنت نیاز دارد.
- **سرور لایسنس:** به‌صورت پیش‌فرض درخواست‌ها به سرور لایسنس افزونه در نسخهٔ دسکتاپ مسدود است
  (حالت آفلاین/رایگان). برای اتصال واقعی، در تنظیمات دسکتاپ `licenseServer` را روشن کنید.
- **روی لینوکس:** `PV_NO_SANDBOX=1` و `xvfb-run -a` لازم است؛ صدای ALSA اختیاری است.

---

## 📜 مجوز و سلب مسئولیت

کد این مخزن (پوستهٔ Electron، شیم، پلیر، پچ‌ها) با مجوز MIT منتشر می‌شود.
پوشهٔ `src/renderer/ext/` خروجی اسکریپت vendor از مخزن عمومی افزونهٔ ProudVocab است و حق نشر آن
متعلق به نویسندهٔ افزونه است؛ این پروژه فقط یک لایهٔ سازگاری دسکتاپ اضافه می‌کند و منطق تجاری
(لایسنس/پریمیوم) افزونه را دور نمی‌زند. برای استفادهٔ سازمانی، لایسنس معتبر افزونه را تهیه کنید.

---

## English summary

ProudVocab Desktop wraps the ProudVocab Chrome extension in Electron and replaces stream
playback with a local media player:

- **Shell window** hosts three same-origin iframes (player / side panel / background) served from a
  custom `app://` protocol; a message bus (`shell.js`) emulates Chrome's extension messaging
  (`runtime`, `storage`, `tabs`, ports) via `chrome-shim.js`.
- **Local player** (`src/renderer/player`) plays any local video through a streaming `pv-media://`
  protocol (with HTTP Range support), parses SRT/VTT/ASS/SUB subtitles with encoding detection, and
  feeds cues into the extension's untouched vocabulary engine through `window.PlayerAdapter`
  (`LocalAdapter.js`) + the `__primevocab_track_ready` event.
- Everything else — clickable word chips, CEFR colouring, translation tooltip, dual subtitles,
  transcript, SRS review, games, archive, Anki/JSON export, settings — is the **original extension
  code**, vendored and minimally patched by `scripts/vendor-ext.mjs`.
- No embedded browsing of YouTube/Netflix/Prime; no Google-Drive sync (needs browser OAuth);
  premium/licensing logic untouched.

Build: `npm install && npm start` · test: `npm test`, `npm run smoke` · package: `npm run dist:win`.
