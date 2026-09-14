'use strict';
// Only the locale is persisted. We never persist or replace a learner implicitly.
let initialLocale = document.documentElement.dataset.defaultLang || 'en';
try {
  const requested = new URL(location.href).searchParams.get('lang');
  const stored = localStorage.getItem('ppo-studio.locale');
  if (requested === 'en' || requested === 'ko') initialLocale = requested;
  else if (document.documentElement.dataset.defaultLang !== 'ko' && ['en','ko'].includes(stored)) initialLocale = stored;
} catch (_) { /* file:// and restrictive browser contexts can disable storage. */ }
const I18n = makeI18n(I18N_CATALOG, initialLocale);
const tr = (key, ...values) => I18n.t(key, ...values);
function localizeStatic() {
  document.documentElement.lang = I18n.language;
  document.querySelectorAll('[data-i18n]').forEach(el => {el.textContent = tr(el.dataset.i18n);});
  for (const attr of ['title','aria-label','placeholder'])
    document.querySelectorAll('[data-i18n-'+attr+']').forEach(el => el.setAttribute(attr, tr(el.getAttribute('data-i18n-'+attr))));
  const select = document.getElementById('language');
  if (select) select.value = I18n.language;
}
localizeStatic();
