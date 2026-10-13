const marginCss = (value) => (value === 'compact' ? '6mm' : value === 'wide' ? '18mm' : '10mm');

export const paperWidthPx = (paperSize, orientation = 'portrait') => {
  const portrait = paperSize === 'a5' ? 559 : paperSize === 'letter' ? 816 : 794;
  const landscape = paperSize === 'a5' ? 794 : paperSize === 'letter' ? 1056 : 1123;
  return orientation === 'landscape' ? landscape : portrait;
};

export const mountPrintableClone = (element, page = {}) => {
  if (!element) return null;
  const host = document.createElement('div');
  host.className = 'invoice-print-host';
  host.style.width = `${paperWidthPx(page.paperSize, page.orientation)}px`;
  host.style.setProperty('--invoice-page-margin', marginCss(page.margin));
  const clone = element.cloneNode(true);
  clone.removeAttribute('data-invoice-preview');
  clone.style.width = '100%';
  clone.style.maxWidth = 'none';
  clone.style.margin = '0';
  host.appendChild(clone);
  document.body.appendChild(host);
  return { host, clone };
};

export const printElement = ({ element, title, page = {} }) => {
  const mounted = mountPrintableClone(element, page);
  if (!mounted) return;
  const previousTitle = document.title;
  const style = document.createElement('style');
  style.setAttribute('data-invoice-page-style', '');
  /* Zero browser margin suppresses Chromium's URL/date header and footer.
     The chosen visual margin belongs to the isolated invoice host instead. */
  style.textContent = `@page { size: ${page.paperSize || 'a4'} ${page.orientation || 'portrait'}; margin: 0; }`;
  document.head.appendChild(style);
  if (title) document.title = title;
  document.body.classList.add('print-mode');

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    document.body.classList.remove('print-mode');
    document.title = previousTitle;
    style.remove();
    mounted.host.remove();
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1600);
};

