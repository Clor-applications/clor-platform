import { useEffect } from 'react';

const safeKey = (value) => String(value || '').replace(/[^a-z0-9:_-]+/gi, '-').slice(0, 180);

/** Adds spreadsheet-style column resizing to every application table. */
export default function ResizableTables() {
  useEffect(() => {
    const cleanups = new Map();

    const prepare = (table, tableIndex) => {
      if (!(table instanceof HTMLTableElement) || table.dataset.columnResizeReady === 'true') return;
      const headers = [...table.querySelectorAll(':scope > thead > tr:first-child > th')];
      if (!headers.length) return;
      table.dataset.columnResizeReady = 'true';
      const labels = headers.map((header) => header.textContent.trim()).join('|');
      const storageKey = `app-table-widths:v1:${safeKey(`${location.hash || location.pathname}:${table.dataset.resizeKey || tableIndex}:${labels}`)}`;
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { saved = {}; }

      table.style.tableLayout = 'fixed';
      headers.forEach((header, index) => {
        header.classList.add('global-resizable-heading');
        const labelMinimum = Math.max(76, header.textContent.trim().length * 7.5 + 34);
        if (saved[index]) header.style.width = `${Math.max(labelMinimum, saved[index])}px`;
        const handle = document.createElement('span');
        handle.className = 'global-column-resizer';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', `Resize ${header.textContent.trim() || `column ${index + 1}`}`);

        const onPointerDown = (event) => {
          event.preventDefault(); event.stopPropagation();
          handle.setPointerCapture?.(event.pointerId);
          const startX = event.clientX;
          const startWidth = header.getBoundingClientRect().width;
          const initialWidths = headers.map((item) => Math.round(item.getBoundingClientRect().width));
          headers.forEach((item, itemIndex) => { item.style.width = `${initialWidths[itemIndex]}px`; });
          const containerWidth = table.parentElement?.clientWidth || 0;
          const initialTableWidth = Math.max(containerWidth, initialWidths.reduce((sum, width) => sum + width, 0));
          table.style.width = `${initialTableWidth}px`;
          table.style.minWidth = '100%';

          const onMove = (moveEvent) => {
            const nextWidth = Math.max(labelMinimum, Math.round(startWidth + moveEvent.clientX - startX));
            header.style.width = `${nextWidth}px`;
            table.style.width = `${Math.max(containerWidth, initialTableWidth + nextWidth - startWidth)}px`;
          };
          const onUp = (upEvent) => {
            const clientX = Number.isFinite(upEvent.clientX) ? upEvent.clientX : startX;
            const nextWidth = Math.max(labelMinimum, Math.round(startWidth + clientX - startX));
            header.style.width = `${nextWidth}px`;
            saved[index] = nextWidth;
            localStorage.setItem(storageKey, JSON.stringify(saved));
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('is-resizing-report-column');
          };
          document.body.classList.add('is-resizing-report-column');
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onUp);
        };

        handle.addEventListener('pointerdown', onPointerDown);
        header.appendChild(handle);
        cleanups.set(handle, () => handle.removeEventListener('pointerdown', onPointerDown));
      });
    };

    const scan = () => [...document.querySelectorAll('table:not([data-no-column-resize])')].forEach(prepare);
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cleanups.forEach((cleanup, handle) => { cleanup(); handle.remove(); });
      cleanups.clear();
    };
  }, []);

  return null;
}
