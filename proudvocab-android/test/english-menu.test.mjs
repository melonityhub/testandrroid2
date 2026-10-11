import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const shell = fs.readFileSync(new URL('../web-overlay/shell.js', import.meta.url), 'utf8');
const migration = shell.slice(shell.indexOf('    if (!store.local.__pvEnglishMenuV1)'), shell.indexOf('    seedLicense();', shell.indexOf('    if (!store.local.__pvEnglishMenuV1)')));
assert.ok(migration.includes("appLanguage: 'en'"));

for (const settings of [undefined, { appLanguage: 'auto', targetLanguage: 'fa' }, { appLanguage: 'tr', targetLanguage: 'fa' }]) {
  test(`English menu migration: ${JSON.stringify(settings)}`, () => {
    const store = { local: { words: ['hello'] }, sync: { settings } };
    let saves = 0;
    const context = { store, schedulePersist: () => saves++ };
    vm.runInNewContext(migration, context);
    assert.equal(store.sync.settings.appLanguage, 'en');
    assert.equal(store.sync.settings.targetLanguage, settings?.targetLanguage);
    assert.deepEqual(store.local.words, ['hello']);
    assert.equal(saves, 1);
    store.sync.settings.appLanguage = 'de';
    vm.runInNewContext(migration, context);
    assert.equal(store.sync.settings.appLanguage, 'de');
    assert.equal(saves, 1);
  });
}

test('local-only translation preferences survive migration', () => {
  const store = { local: { settings: { targetLanguage: 'fa' } }, sync: {} };
  vm.runInNewContext(migration, { store, schedulePersist() {} });
  assert.equal(store.sync.settings.appLanguage, 'en');
  assert.equal(store.sync.settings.targetLanguage, 'fa');
});
