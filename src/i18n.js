'use strict';
/** Tiny, deterministic message formatter. It owns text, never simulation state. */
function makeI18n(catalog, initial = 'en') {
  let language;
  const api = {
    get language() { return language; },
    setLanguage(next) {
      if (!['en', 'ko'].includes(next) || !catalog[next]) throw new Error('Unsupported language: ' + next);
      language = next;
    },
    t(key, ...args) {
      const value = catalog[language]?.[key];
      if (typeof value !== 'string') throw new Error('Missing translation: ' + language + '.' + key);
      return value.replace(/\{(\d+)\}/g, (_, index) => {
        if (+index >= args.length) throw new Error('Missing message variable: ' + key + '[' + index + ']');
        return String(args[index]);
      });
    }
  };
  api.setLanguage(initial);
  return api;
}
if (typeof module !== 'undefined') module.exports = {makeI18n};
