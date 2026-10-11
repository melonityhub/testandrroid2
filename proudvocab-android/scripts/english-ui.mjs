/** Render English fallback labels into the Android panel, before its scripts run.
 * The extension's HTML is Turkish even when appLanguage is English. Keep the
 * data-i18n hooks so later explicit language choices still work at runtime.
 */
export function renderEnglishPanel(html, messages) {
  const message = (key) => {
    const text = messages[key]?.message;
    if (typeof text !== 'string' || !text) throw new Error(`Missing English UI message: ${key}`);
    return text;
  };
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const replaceOne = (pattern, replacement, label) => {
    if ([...html.matchAll(new RegExp(pattern.source, 'g'))].length !== 1) {
      throw new Error(`English panel: expected one ${label}`);
    }
    html = html.replace(pattern, replacement);
  };

  replaceOne(/<html lang="tr">/, '<html lang="en">', 'root language');

  // Translate the text, not the hint button's SVG. Runtime localizeHtml uses
  // textContent on the annotated element, so move this hook onto its label.
  replaceOne(/id="srs-hint-btn" data-i18n="srs_card_hint_btn"/, 'id="srs-hint-btn"', 'hint button');
  replaceOne(/<span>İpucu Göster<\/span>/, '<span data-i18n="srs_card_hint_btn">Show hint</span>', 'hint label');

  for (const [id, key] of Object.entries({
    sourceLangLabel: 'lang_en',
    targetLangLabel: 'lang_tr',
    primeDomainLabel: 'settings_prime_domain_default',
    appLangLabel: 'lang_en',
    poolSelectLabel: 'pool_all',
  })) {
    replaceOne(new RegExp(`(<span\\b[^>]*\\bid="${id}"[^>]*>)[^<]*(</span>)`),
      (_, open, close) => open + escape(message(key)) + close, `${id} label`);
  }
  replaceOne(/(<div\b[^>]*\bid="achievements-count-label"[^>]*>)[^<]*(<\/div>)/,
    (_, open, close) => open + escape(message('achievements_title')) + ' · 0 / 42' + close, 'achievements count');

  replaceOne(/(<div class="material-select-menu" id="appLangMenu">)([\s\S]*?)(<\/div>)/,
    (_, open, body, close) => {
      let count = 0;
      body = body.replace(/<button\b[^>]*\bdata-val="([^"]+)"[^>]*>[\s\S]*?<\/button>/g, (button, lang) => {
        count++;
        button = button.replace(/class="([^"]+)"/, (_, classes) => {
          const names = classes.split(/\s+/).filter((name) => name !== 'on' && name !== 'active');
          if (lang === 'en') names.push('on');
          return `class="${names.join(' ')}"`;
        });
        return button.replace(/<span>[^<]*<\/span>/,
          `<span data-i18n="lang_${lang}">${escape(message('lang_' + lang))}</span>`);
      });
      if (count !== 5) throw new Error(`English panel: expected five app language choices, found ${count}`);
      return open + body + close;
    }, 'app language menu');

  // Native selects must agree with their custom triggers even before settings
  // finish loading. Only the menu defaults to English; translation languages
  // and saved source/target preferences are not changed by this HTML render.
  for (const [id, selected] of Object.entries({
    'source-lang-select': 'en', 'target-lang-select': 'tr', 'app-lang-select': 'en',
  })) {
    replaceOne(new RegExp(`(<select\\b[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</select>)`),
      (_, open, body, close) => open + body.replace(/<option value="([^"]+)">[^<]*<\/option>/g,
        (_, lang) => `<option value="${lang}" data-i18n="lang_${lang}"${lang === selected ? ' selected' : ''}>${escape(message('lang_' + lang))}</option>`) + close,
      `${id} select`);
  }

  // All current annotated labels are leaf elements. Fail on an upstream
  // structural change rather than accidentally removing part of the UI.
  html = html.replace(/(<([a-z][\w-]*)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (_, open, tag, key, body, close) => {
      if (/<[a-z]/i.test(body)) throw new Error(`English panel: non-leaf label ${key} (${tag})`);
      return open + escape(message(key)) + close;
    });
  html = html.replace(/<[a-z][\w-]*\b[^>]*\bdata-i18n-(?:title|placeholder)="[^"]+"[^>]*>/g, (tag) => {
    for (const [, attr, key] of tag.matchAll(/data-i18n-(title|placeholder)="([^"]+)"/g)) {
      const value = `${attr}="${escape(message(key))}"`;
      const existing = new RegExp(`\\s${attr}="[^"]*"`);
      tag = existing.test(tag) ? tag.replace(existing, ' ' + value) : tag.replace(/>$/, ' ' + value + '>');
    }
    return tag;
  });
  for (const [, key] of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) message(key);
  return html;
}
