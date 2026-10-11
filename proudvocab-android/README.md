# ProudVocab for Android

نسخهٔ **اندروید ۹ به بالا** از پروژهٔ [`proudvocab-desktop`](../proudvocab-desktop): پخش ویدیوی داخل گوشی + زیرنویس (SRT / VTT / ASS)،
کلیک روی هر کلمه برای ترجمه و سطح CEFR، ذخیرهٔ لغت‌ها، مرور SRS، بازی‌ها و خروجی Anki — با **همهٔ امکانات باز**
(بدون لایسنس / پریمیوم / محدودیت ۵۰ کلمه) و **دیکشنری آفلاین** قابل‌افزودن.
بیلد و Release کاملاً توسط **GitHub Actions** انجام می‌شود؛ لازم نیست چیزی روی کامپیوتر نصب کنید.

> English summary at the bottom of this file.

---

## ۱) نصب روی گوشی (POCO X3 Pro)
1. در GitHub به **Releases** بروید و فایل `ProudVocab-<version>.apk` را دانلود کنید.
2. روی گوشی APK را باز کنید؛ اگر اندروید پرسید، «اجازهٔ نصب از این منبع» را برای مرورگر/فایل‌منیجر فعال کنید.
3. برنامه را باز کنید ← **ویدیو را انتخاب کنید** (می‌توانید همزمان فایل `.srt` را هم انتخاب کنید) ← روی هر کلمهٔ زیرنویس بزنید.

> برای MIUI: اگر نصب بلاک شد، *Settings → Privacy → Special permissions → Install unknown apps* را برای برنامهٔ دانلودکننده روشن کنید.
> نسخه‌های بعدی همان امضا را دارند، پس **روی نسخهٔ قبلی نصب می‌شوند** و اطلاعات (لغت‌ها و تنظیمات) حفظ می‌شود.

## ۲) ساخت و انتشار با GitHub (کاملاً خودکار)
1. محتوای این پوشه را در ریشهٔ ریپو کامیت کنید:
   ```
   .github/workflows/android.yml
   proudvocab-android/...
   ```
2. **هر پوشی روی هر شاخه‌ای** (main/master یا هر برنچ دیگر) که به فایل‌های اپ دست بزند، خودش:
   بیلد می‌گیرد ← APK را امضا و بررسی می‌کند ← **تگ می‌سازد** ← **Release** با APK و فایل `.sha256` منتشر می‌کند.
   * **main/master**: Release پایدار با تگ `android-v1.0.<شماره‌ی اجرا>` (مثلاً `android-v1.0.7`)؛ گزینهٔ «Latest» همیشه روی این شاخه‌ها می‌ماند.
   * **بقیهٔ شاخه‌ها**: Release از نوع *Pre-release* با تگ `android-v1.0.<شماره‌ی اجرا>-<نام شاخه>` (مثلاً `android-v1.0.8-arena-8af23411`) تا بیلد هر برنچ جدا و قابل‌تشخیص باشد؛ چون شمارهٔ نسخهٔ همهٔ برنچ‌ها صعودی است، روی هم قابل نصب‌اند.
   * نسخهٔ پایه از فایل `VERSION` می‌آید (`1.0` ← برای نسخهٔ ۲ آن را `2.0` کنید).
   * اگر نمی‌خواهید Release ساخته شود، در پیام کامیت بنویسید `[skip release]`.
   * Pull Request فقط بیلد می‌کند.
3. دستی: تب *Actions → Android APK → Run workflow* (گزینهٔ `release` و `version`)، یا خودتان تگ بزنید: `git tag android-v2.0.0 && git push origin android-v2.0.0`.
4. اگر ورک‌فلو قرمز شد: لاگ همان مرحله را ببینید و جدول «خطا ← علت ← راه‌حل» در [`CHECKLIST.md`](CHECKLIST.md) را نگاه کنید.
   (برای ساخت Release لازم است در *Settings → Actions → General → Workflow permissions* گزینهٔ **Read and write permissions** فعال باشد.)

### چرا فقط یک APK (arm64 / armv7 / x86)؟
این برنامه **هیچ کد native (‎.so)‎ ندارد**: فقط Java + WebView. بنابراین یک APK همه‌کاره روی هر معماری (arm64-v8a، armeabi-v7a، x86، x86_64) اجرا می‌شود
و POCO X3 Pro (arm64) هم همان را نصب می‌کند. APKهای جدا برای هر ABI فایل‌هایی کاملاً یکسان می‌شدند و فقط اشتباه‌گرفتن ایجاد می‌کردند.
حجم حدود ۶۰۰ کیلوبایت است چون کتابخانهٔ خارجی/native ندارد (رابط وب ≈ ۴۷۰KB فشرده + کد Java + آیکون).

### امضا (Signing)
یک کلید ثابت در `keystore/proudvocab-release.p12` است تا همهٔ نسخه‌ها یک امضا داشته باشند و روی هم نصب شوند.
رمز پیش‌فرض `proudvocab` است. اگر ریپو عمومی است و می‌خواهید کلید اختصاصی داشته باشید، کلید جدید بسازید و در
*Settings → Secrets* بگذارید، سپس در ورک‌فلو متغیرهای `PV_KEYSTORE`، `PV_KEYSTORE_PASSWORD`، `PV_KEY_ALIAS`، `PV_KEY_PASSWORD`
را به محیط مرحلهٔ بیلد بدهید (`app/build.gradle` آن‌ها را می‌خواند). با عوض‌کردن کلید، نسخهٔ جدید روی قبلی نصب نمی‌شود.

## ۳) دیکشنری آفلاین (مشابه پروژهٔ dictionaryproject)
1. دکمهٔ **کتاب 📖** در نوار بالا ← **افزودن فایل دیکشنری**.
2. فایل SQLite با ساختار FastDic را انتخاب کنید (جدول‌های `english_words`، `english_details`، `persian_words`، `persian_details`، …؛
   همان دیتابیسی که `dictionaryproject` می‌خواند). فایل `.zip` یا `.gz` حاویِ آن هم پذیرفته می‌شود.
3. فایل یک‌بار داخل حافظهٔ برنامه کپی و اعتبارسنجی می‌شود (نوار پیشرفت دارد) و کاملاً آفلاین کار می‌کند.
4. بعد از افزودن:
   * **ترجمهٔ کلمات (EN ⇄ FA)** ابتدا از دیکشنری آفلاین گرفته می‌شود و اگر کلمه نبود، گوگل ترنسلیت (سوییچ دارد).
   * بخش جستجو با پیشوند، نمایش معنی‌ها، نقش دستوری، سطح CEFR، مثال‌ها، صرف‌ها، مترادف/متضاد.
   * ترجمهٔ جمله‌ها همیشه با گوگل است. هیچ داده‌ای از دیکشنری داخل APK نیست؛ فقط فایلی که خودتان بدهید.

## ۴) مجوزها (فقط آنچه لازم است)
| مجوز | چرا | کی پرسیده می‌شود |
|---|---|---|
| `INTERNET` | ترجمهٔ گوگل / تعریف آنلاین کلمه | هنگام نصب، بدون پرسش (مجوز عادی) |

* **هیچ مجوز حافظه/ذخیره‌سازی لازم نیست.** ویدیو، زیرنویس، فایل دیکشنری و بکاپ‌ها با **انتخاب‌گر فایل سیستم (SAF)** باز/ذخیره می‌شوند؛
  برنامه فقط به فایلی که خودتان انتخاب کرده‌اید دسترسی دارد (و دسترسی برای دفعهٔ بعد حفظ می‌شود).
* دوربین/میکروفون/موقعیت/مخاطبین و… درخواست نمی‌شود؛ ترافیک اینترنت فقط HTTPS است (استثنا: سرور محلی داخل خود برنامه روی `127.0.0.1`).

## ۵) نکات و محدودیت‌ها
* برنامه به **Android System WebView نسخهٔ ۱۰۰ یا بالاتر** نیاز دارد (روی گوشی‌های امروزی خودکار به‌روز می‌شود؛ اگر صفحه سفید بود، WebView و Chrome را از Play Store آپدیت کنید).
* پخش با **WebView (Chromium)** گوشی انجام می‌شود. MP4 (H.264/H.265) مطمئن‌ترین است؛ MKV/AVI/کدک‌های عجیب بسته به گوشی ممکن است
  پخش نشود (پیام خطا + دکمهٔ «انتخاب فایل دیگر» نمایش داده می‌شود). به‌روز نگه‌داشتن *Android System WebView* مشکلات کدک را کم می‌کند.
* پیداکردن خودکار زیرنویس کنار ویدیو فقط وقتی کار می‌کند که پوشه را با «پوشه به‌عنوان پلی‌لیست» داده باشید؛ وگرنه ویدیو و `.srt` را
  **با هم** در یک انتخاب بزنید یا از دکمهٔ زیرنویس استفاده کنید.
* همگام‌سازی Google Drive مخصوص افزونهٔ مرورگر بود و در این نسخه وجود ندارد؛ برای بکاپ از بخش **آرشیو** خروجی JSON/Anki بگیرید (محل ذخیره را خودتان انتخاب می‌کنید).
* زبان رابط پنل (از خود افزونه): English / Türkçe / Deutsch / Français / Español. پلیر فارسی هم دارد.
* دکمهٔ Back: ابتدا دیالوگ/صفحهٔ باز را می‌بندد، بعد تمام‌صفحه، بعد خروج.
* تمام‌صفحه صفحه را افقی می‌کند و صفحه تا زمان پخش روشن می‌ماند.

## ۶) ساختار
```
proudvocab-android/
  app/src/main/java/...        Java (بدون هیچ وابستگی خارجی): MainActivity, LocalServer, NativeBridge, Dictionary, ...
  app/src/main/assets/www/     رابط وب (تولیدشده توسط scripts/build-web.mjs از proudvocab-desktop + web-overlay)
  web-overlay/                 تغییرات مخصوص اندروید (پل JS، شِل موبایلی، CSS، صفحهٔ دیکشنری، استاب لایسنس)
  scripts/build-web.mjs        تولید assets + پچ‌های حذف لایسنس (اگر یکی جا نیفتد بیلد خطا می‌دهد)
  scripts/verify.sh            چک‌لیست پیش از بیلد (در CI هم اجرا می‌شود)
  scripts/jtest, e2e/          تست سرور روی JVM و تست سرتاسری در Chromium
  keystore/                    کلید امضا
../.github/workflows/android.yml
```
رابط وب آمادهٔ استفاده در `app/src/main/assets/www` کامیت شده است، پس این پوشه **به‌تنهایی** (بدون `proudvocab-desktop`) هم بیلد می‌شود.
اگر `proudvocab-desktop` کنارش باشد و آن را تغییر دهید، `node scripts/build-web.mjs` رابط وب را دوباره تولید می‌کند (CI خودش هم این کار را می‌کند).

---

## English summary
Android 9+ port of `proudvocab-desktop` (video + subtitles, tappable words, CEFR, SRS, games, Anki export) with **every feature unlocked**
(license / premium logic removed, no 50-word cap) and an **importable offline dictionary** (FastDic-style SQLite, same schema as
`dictionaryproject`). Plain Java + WebView, **zero third-party dependencies**; only the `INTERNET` permission - files are opened with the
system picker (SAF). Every push to **any branch** that touches the app makes GitHub Actions build a signed APK and
publish a Release automatically - `main`/`master` produce stable releases (`android-v1.0.<run>`), other branches
produce prereleases tagged `android-v1.0.<run>-<branch-slug>`; push a tag `android-vX.Y.Z` for a manual version.
See [`CHECKLIST.md`](CHECKLIST.md) for the release checklist, the on-device test list and CI troubleshooting.
