/* /pricing?period=yearly: marks the page before its first paint, so the yearly prices show at once instead of monthly first (the site's CSP allows no inline script). */
if (/[?&]period=yearly(&|$)/.test(window.location.search)) document.documentElement.dataset.period = 'yearly';
