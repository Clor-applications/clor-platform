import React, { useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { notify } from './ui/notify';
import { mountPrintableClone, paperWidthPx, printElement } from '../utils/printElement';

/**
 * Print and Download, around any document that can be put on paper.
 *
 * This was written for the invoice and lived inside the sales module, so it was
 * the only document in the product anybody could hand to a customer. Nothing in
 * it was ever invoice-specific — it sets the page title so the browser's own
 * print header carries the document number, puts the app into print-mode and
 * renders whatever it is given — so it is now the frame every document uses.
 *
 * @param title     what this is, shown above the paper
 * @param fileBase  the document number; becomes the PDF's filename
 */
export const PrintDownloadFrame = ({ title, fileBase, children, page = {} }) => {
  const paperRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const docNumber = String(fileBase || '').trim();

  const doPrint = () => {
    try {
      printElement({ element: paperRef.current, title: docNumber, page });
    } catch {
      // ignore
    }
  };

  const doDownload = async () => {
    const source = paperRef.current;
    if (!source || downloading) return;

    setDownloading(true);
    const prevTitle = document.title;
    const filenameBase = (docNumber || 'document').replace(/[\\/:*?"<>|]/g, '-').trim() || 'document';
    let mounted = null;

    try {
      if (docNumber) document.title = docNumber;
      const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
      const orientation = page.orientation === 'landscape' ? 'landscape' : 'portrait';
      const format = ['a4', 'a5', 'letter'].includes(page.paperSize) ? page.paperSize : 'a4';
      const pageMargin = page.margin === 'compact' ? 12 : page.margin === 'wide' ? 36 : 20;
      const doc = new jsPDF({ orientation, unit: 'pt', format });
      const contentWidth = doc.internal.pageSize.getWidth() - (pageMargin * 2);
      mounted = mountPrintableClone(source, page);
      const el = mounted?.clone || source;

      /* jsPDF's html() applies both its CSS-width conversion and html2canvas's
         scale. On a modal document that combination enlarged the invoice and
         clipped its right side. Capture once at the selected paper's CSS
         width, then place that bitmap explicitly inside the PDF margins. */
      const captureWidth = paperWidthPx(format, orientation);
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: captureWidth,
        windowWidth: captureWidth,
        scrollX: 0,
        scrollY: 0,
      });
      const usableHeight = doc.internal.pageSize.getHeight() - (pageMargin * 2);
      const pixelsPerPoint = canvas.width / contentWidth;
      const sliceHeightPx = Math.max(1, Math.floor(usableHeight * pixelsPerPoint));
      let offsetPx = 0;
      let pageIndex = 0;
      while (offsetPx < canvas.height) {
        if (pageIndex > 0) doc.addPage(format, orientation);
        const heightPx = Math.min(sliceHeightPx, canvas.height - offsetPx);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = heightPx;
        slice.getContext('2d').drawImage(canvas, 0, offsetPx, canvas.width, heightPx, 0, 0, canvas.width, heightPx);
        const drawHeight = heightPx / pixelsPerPoint;
        doc.addImage(slice.toDataURL('image/png'), 'PNG', pageMargin, pageMargin, contentWidth, drawHeight, undefined, 'FAST');
        offsetPx += heightPx;
        pageIndex += 1;
      }
      if (page?.options?.pageNumbers !== false) {
        const totalPages = doc.getNumberOfPages();
        for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
          doc.setPage(pageNo);
          doc.setFontSize(8);
          doc.setTextColor(110);
          doc.text(`Page ${pageNo} of ${totalPages}`, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 7, { align: 'center' });
        }
      }

      doc.save(`${filenameBase}.pdf`);
    } catch {
      notify.error('Unable to generate PDF. Please try again.');
    } finally {
      document.title = prevTitle;
      mounted?.host.remove();
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="ui-muted text-sm">{title}</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={doPrint} className="ui-btn ui-btn-secondary">
            <Printer size={16} /> Print
          </button>
          <button
            type="button"
            onClick={doDownload}
            disabled={downloading}
            className="px-3 py-2 rounded-lg ui-btn ui-btn-primary flex items-center gap-2"
          >
            <Download size={16} /> {downloading ? 'Preparing...' : 'Download'}
          </button>
        </div>
      </div>

      <div ref={paperRef}>{children}</div>
    </div>
  );
};

export default PrintDownloadFrame;
