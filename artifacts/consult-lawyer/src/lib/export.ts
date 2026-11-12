import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { AlignmentType, Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { ensureDocumentFont, getDocumentFontFamily, getDocumentFontName, hasNonLatin, isRtl } from '@/lib/document-fonts';

function safeName(title: string) {
  // Keep Unicode letters so non-Latin titles still produce a meaningful filename.
  return (title || 'document').replace(/[^\p{L}\p{N}\p{M}\- ]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'document';
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function plain(line: string) {
  return line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`/g, '');
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string) {
  return esc(s).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/`/g, '');
}

function markdownToHtml(content: string) {
  return content
    .split('\n')
    .map((l) => {
      const h = l.match(/^(#{1,3})\s+(.*)/);
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      if (/^[-*]\s+/.test(l)) return `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`;
      if (/^---+$/.test(l)) return '<hr/>';
      if (!l.trim()) return '<div style="height:10px"></div>';
      return `<p>${inline(l)}</p>`;
    })
    .join('');
}

export function exportMarkdown(title: string, content: string) {
  download(new Blob([content], { type: 'text/markdown;charset=utf-8' }), `${safeName(title)}.md`);
}

function addPageNumbers(pdf: jsPDF) {
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(128, 128, 128);
    pdf.text(`Page ${i} of ${total}`, pdf.internal.pageSize.getWidth() / 2, pdf.internal.pageSize.getHeight() - 10, { align: 'center' });
    pdf.setTextColor(0, 0, 0);
  }
}

/** Unicode-safe PDF: renders through the browser's text shaping, then rasterises (as in the original app). */
async function exportPdfCanvas(title: string, content: string, language?: string | null) {
  ensureDocumentFont(language);
  const rtl = isRtl(language);
  const container = document.createElement('div');
  container.dir = rtl ? 'rtl' : 'ltr';
  container.style.cssText = `position:absolute;left:-9999px;top:0;width:640px;padding:40px;font-family:${getDocumentFontFamily(language)};font-size:14px;line-height:1.75;color:#111;background:#fff;text-align:${rtl ? 'right' : 'left'};`;
  container.innerHTML = `<style>h1{font-size:22px;font-weight:700;margin:16px 0 8px}h2{font-size:18px;font-weight:700;margin:14px 0 6px}h3{font-size:16px;font-weight:700;margin:12px 0 4px}p{margin:0}li{margin:4px 0;margin-inline-start:20px}hr{border:none;border-top:1px solid #ccc;margin:12px 0}</style>${markdownToHtml(content)}`;
  document.body.appendChild(container);
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const uw = pw - margin * 2;
    const uh = ph - margin * 2 - 10;
    const pageImgH = Math.floor((uh / uw) * canvas.width);
    let srcY = 0;
    let page = 0;
    while (srcY < canvas.height) {
      if (page > 0) pdf.addPage();
      const sliceH = Math.min(pageImgH, canvas.height - srcY);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, slice.width, sliceH);
        ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      }
      pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, uw, (uw / canvas.width) * sliceH);
      srcY += sliceH;
      page++;
    }
    addPageNumbers(pdf);
    pdf.save(`${safeName(title)}.pdf`);
  } finally {
    container.remove();
  }
}

function exportPdfText(title: string, content: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 56;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const pageH = doc.internal.pageSize.getHeight();
  let y = margin;
  const write = (text: string, size: number, bold: boolean, gap: number) => {
    doc.setFont('times', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text || ' ', width) as string[];
    for (const l of lines) {
      if (y > pageH - margin - 20) {
        doc.addPage();
        y = margin;
      }
      doc.text(l, margin, y);
      y += size * 1.4;
    }
    y += gap;
  };
  for (const raw of content.split('\n')) {
    const h = raw.match(/^(#{1,3})\s+(.*)/);
    if (h) write(plain(h[2]), h[1].length === 1 ? 17 : 14, true, 6);
    else write(plain(raw.replace(/^[-*]\s+/, '\u2022  ')), 11.5, false, 2);
  }
  addPageNumbers(doc);
  doc.save(`${safeName(title)}.pdf`);
}

/**
 * Exports PDF. Latin-only English content uses selectable vector text; any other language or any
 * non-Latin glyph goes through the Unicode raster path so scripts are never silently corrupted.
 */
export async function exportPdf(title: string, content: string, language?: string | null) {
  const latinOnly = !hasNonLatin(content + title);
  const english = !language || /^english$/i.test(language.trim()) || language === 'en';
  if (latinOnly && english) exportPdfText(title, content);
  else await exportPdfCanvas(title, content, language);
}

export async function exportDocx(title: string, content: string, language?: string | null) {
  const font = getDocumentFontName(language);
  const rtl = isRtl(language);
  const run = (text: string, o: { bold?: boolean; italics?: boolean } = {}) =>
    new TextRun({ text, font: { ascii: font, hAnsi: font, cs: font, eastAsia: font }, rightToLeft: rtl, ...o });
  const runs = (text: string) => {
    const out: TextRun[] = [];
    const re = /\*\*(.*?)\*\*|\*(.*?)\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(run(text.slice(last, m.index)));
      out.push(m[1] !== undefined ? run(m[1], { bold: true }) : run(m[2] ?? '', { italics: true }));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(run(text.slice(last)));
    return out.length ? out : [run('')];
  };
  const para = { bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT };
  const paragraphs = content.split('\n').map((raw) => {
    const h = raw.match(/^(#{1,3})\s+(.*)/);
    if (h)
      return new Paragraph({
        ...para,
        heading: h[1].length === 1 ? HeadingLevel.HEADING_1 : h[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        children: [run(plain(h[2]), { bold: true })],
      });
    if (/^[-*]\s+/.test(raw)) return new Paragraph({ ...para, bullet: { level: 0 }, children: runs(raw.replace(/^[-*]\s+/, '')) });
    return new Paragraph({ ...para, children: runs(raw) });
  });
  const doc = new DocxDocument({
    styles: { default: { document: { run: { font: { ascii: font, hAnsi: font, cs: font, eastAsia: font } } } } },
    sections: [{ children: paragraphs }],
  });
  download(await Packer.toBlob(doc), `${safeName(title)}.docx`);
}
