/* Preview only: try a face with ?font=geist|manrope|outfit|jakarta|noto (kept while you browse). */
(function () {
  try {
    var f = new URLSearchParams(location.search).get('font');
    if (f) sessionStorage.setItem('clor-font', f);
    f = f || sessionStorage.getItem('clor-font');
    if (f && /^(geist|manrope|outfit|jakarta|noto)$/.test(f)) document.documentElement.setAttribute('data-font', f);
  } catch (e) {}
})();
