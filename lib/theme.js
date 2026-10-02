// Applies the chosen background universe, Voidy's form, eyes and accessory, and the animations
// switch to an extension page. Saved in chrome.storage.local.
(function () {
  const fallback = { primary: '#9b74ff', secondary: '#ec6eb4' };
  const THEMES = ['void', 'whitehole', 'nebula', 'supernova', 'pulsar', 'aurora', 'eclipse', 'custom'];
  // Themes from before 0.6.0 map to the closest universe.
  const OLD = { violet: 'void', rose: 'nebula', candy: 'nebula', ocean: 'pulsar', sunset: 'supernova',
    ember: 'supernova', mint: 'aurora', forest: 'aurora' };
  const FORMS = ['blackhole', 'whitehole', 'nebula', 'supernova', 'pulsar', 'aurora', 'eclipse', 'galaxy', 'comet'];
  const EYES = ['shiny', 'starry', 'anime', 'beans', 'chill', 'rings', 'pixel'];
  const DEFAULTS = { theme: 'void', customColors: fallback, voidyForm: 'blackhole', voidyAccessory: 'none', voidyEyes: 'shiny', voidyMotion: true };
  const themeName = t => THEMES.includes(t) ? t : OLD[t] || 'void';
  function apply(s) {
    const root = document.documentElement, c = s.customColors || fallback;
    root.style.setProperty('--custom-a1', /^#[\da-f]{6}$/i.test(c.primary || '') ? c.primary : fallback.primary);
    root.style.setProperty('--custom-a2', /^#[\da-f]{6}$/i.test(c.secondary || '') ? c.secondary : fallback.secondary);
    root.setAttribute('data-theme', themeName(s.theme));
    root.setAttribute('data-acc', s.voidyAccessory || 'none');
    root.setAttribute('data-eyes', EYES.includes(s.voidyEyes) ? s.voidyEyes : 'shiny');
    root.setAttribute('data-form', FORMS.includes(s.voidyForm) ? s.voidyForm : 'blackhole');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.toggle('still', reduced || s.voidyMotion === false);
  }
  globalThis.VOIDY_THEME = { THEMES, FORMS, themeName };
  apply(DEFAULTS);
  try {
    chrome.storage.local.get(DEFAULTS, apply);
    chrome.storage.onChanged.addListener(c => {
      if (c.theme || c.customColors || c.voidyForm || c.voidyAccessory || c.voidyEyes || c.voidyMotion) chrome.storage.local.get(DEFAULTS, apply);
    });
  } catch (_) {}
})();
