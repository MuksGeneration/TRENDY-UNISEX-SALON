import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getGoogleAccessToken } from './firebaseAuth';
import type { POSTransactionRecord, SalonBranding } from '../types';

let memorySalonToken: string | null = null;

export function setSalonSessionToken(token: string | null) {
  memorySalonToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      sessionStorage.setItem('trendy_salon_token', token);
    } else {
      sessionStorage.removeItem('trendy_salon_token');
    }
  }
}

export function getSalonSessionToken(): string | null {
  if (memorySalonToken) return memorySalonToken;
  if (typeof window !== 'undefined') {
    const stored = sessionStorage.getItem('trendy_salon_token');
    if (stored) {
      memorySalonToken = stored;
      return stored;
    }
  }
  return null;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const salonToken = getSalonSessionToken();
  if (salonToken) {
    headers.set('x-session-token', salonToken);
  }
  const googleToken = getGoogleAccessToken();
  if (googleToken) {
    headers.set('x-google-token', googleToken);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error('Uploaded files are too large for the server. Please use smaller image or PDF files.');
        }
        throw new Error(`Request failed (${res.status}): ${text.slice(0, 140)}`);
      }
      throw new Error('Server returned an unexpected non-JSON response.');
    }
  }
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' && data.error ? data.error : `Request failed (${res.status})`
    );
  }
  return data as T;
}

export async function fetchDriveMediaBlobUrl(
  fileId: string
): Promise<{ blobUrl: string; mimeType: string }> {
  const headers = new Headers();
  const salonToken = getSalonSessionToken();
  if (salonToken) {
    headers.set('x-session-token', salonToken);
  }
  const googleToken = getGoogleAccessToken();
  if (googleToken) {
    headers.set('x-google-token', googleToken);
  }

  const res = await fetch(`/api/workspace/drive/media/${encodeURIComponent(fileId)}`, {
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = `Failed to load Drive file (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) msg = parsed.error;
    } catch {
      // ignore non-json
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  return {
    blobUrl: URL.createObjectURL(blob),
    mimeType: blob.type || 'application/octet-stream',
  };
}

export function formatUGX(amount: number | null | undefined): string {
  const n = Number(amount || 0);
  return `UGX ${Math.round(n).toLocaleString('en-UG')}`;
}

export function exportRowsToExcel(
  fileName: string,
  sheets: Array<{ name: string; rows: Record<string, unknown>[] }>
) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length > 0 ? sheet.rows : [{ Info: 'No records' }]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

export function exportReportToPdf(
  title: string,
  subtitle: string,
  columns: string[],
  rows: (string | number)[][],
  summaryLines: string[] = []
) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
  // Official Trendy Unisex Salon Brand Header
  doc.setFillColor(232, 59, 132); // #E83B84
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text('TRENDY UNISEX SALON', 14, 11);
  doc.setFontSize(9);
  doc.text("Where Beauty Meets Style  |  Busia District Road, Madibira 'A', Uganda", 14, 18);

  doc.setTextColor(29, 23, 23); // #1D1717
  doc.setFontSize(13);
  doc.text(title, 14, 34);
  doc.setFontSize(9);
  doc.setTextColor(90, 80, 80);
  doc.text(`${subtitle}  ·  Generated ${new Date().toLocaleString()}`, 14, 40);

  let startY = 46;
  if (summaryLines.length > 0) {
    doc.setFontSize(9.5);
    doc.setTextColor(29, 23, 23);
    summaryLines.forEach((line, i) => {
      doc.text(line, 14, startY + i * 5.5);
    });
    startY += summaryLines.length * 5.5 + 4;
  }

  autoTable(doc, {
    startY,
    head: [columns],
    body: rows,
    headStyles: {
      fillColor: [29, 23, 23],
      textColor: [255, 255, 255],
      fontSize: 8.5,
    },
    alternateRowStyles: {
      fillColor: [248, 238, 235],
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
    },
  });

  doc.save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`);
}

export function downloadReceiptPdf(tx: POSTransactionRecord, branding?: SalonBranding) {
  const doc = new jsPDF({ format: [80, 198], unit: 'mm' });
  const businessName = (branding?.businessName || 'Trendy Unisex Salon').toUpperCase();
  const tagline = branding?.tagline || 'Where Beauty Meets Style';
  const phone = branding?.phone || '0740301726';
  const social = branding?.socialHandle || '@Trendyunisex.salon';
  const walkIns = branding?.walkInsWelcome !== false;

  doc.setFillColor(232, 59, 132);
  doc.rect(0, 0, 80, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(businessName, 40, 7.5, { align: 'center' });
  doc.setFontSize(7);
  doc.text(tagline, 40, 12, { align: 'center' });
  doc.text("Busia District Rd, near ASA Microfinance", 40, 16, { align: 'center' });
  doc.text(`Book: ${phone}  ·  ${social}`, 40, 19.8, { align: 'center' });

  doc.setTextColor(29, 23, 23);
  doc.setFontSize(8);
  let y = 27;
  doc.text(`Receipt: ${tx.reference}`, 5, y);
  y += 4.5;
  doc.text(`Date: ${tx.date}  ·  Cashier: ${tx.cashierName}`, 5, y);
  y += 4.5;
  doc.text(`Client: ${tx.customerName}`, 5, y);
  y += 4;
  doc.line(5, y, 75, y);
  y += 5;

  for (const item of tx.items) {
    const label = `${item.quantity}x ${item.name}`.slice(0, 32);
    doc.text(label, 5, y);
    doc.text(formatUGX(item.lineTotal), 75, y, { align: 'right' });
    y += 4;
    if (item.employeeName) {
      doc.setFontSize(6.8);
      doc.setTextColor(100, 90, 90);
      doc.text(`   Stylist: ${item.employeeName}`, 5, y);
      doc.setFontSize(8);
      doc.setTextColor(29, 23, 23);
      y += 3.5;
    }
  }

  y += 2;
  doc.line(5, y, 75, y);
  y += 5;
  doc.text('Subtotal:', 5, y);
  doc.text(formatUGX(tx.subtotal), 75, y, { align: 'right' });
  y += 4.5;
  if (tx.discountTotal > 0) {
    doc.text('Discount:', 5, y);
    doc.text(`-${formatUGX(tx.discountTotal)}`, 75, y, { align: 'right' });
    y += 4.5;
  }
  if (tx.tipAmount > 0) {
    doc.text('Tip:', 5, y);
    doc.text(formatUGX(tx.tipAmount), 75, y, { align: 'right' });
    y += 4.5;
  }
  doc.setFontSize(9.5);
  doc.text('TOTAL:', 5, y);
  doc.text(formatUGX(tx.totalAmount), 75, y, { align: 'right' });
  y += 5;
  doc.setFontSize(8);
  for (const p of tx.payments) {
    doc.text(`Paid (${p.method}):`, 5, y);
    doc.text(formatUGX(p.amount), 75, y, { align: 'right' });
    y += 4;
  }
  if (tx.balanceDue > 0) {
    doc.setTextColor(220, 38, 38);
    doc.text('BALANCE DUE:', 5, y);
    doc.text(formatUGX(tx.balanceDue), 75, y, { align: 'right' });
    y += 5;
    doc.setTextColor(29, 23, 23);
  }
  y += 4;
  doc.setFontSize(7);
  doc.text(`Thank you for choosing ${branding?.businessName || 'Trendy Unisex Salon'}!`, 40, y, { align: 'center' });
  y += 3.5;
  doc.text(
    `${walkIns ? 'Walk-Ins Welcome  ·  ' : ''}${social} (TikTok · IG · FB)`,
    40,
    y,
    { align: 'center' }
  );
  doc.save(`receipt_${tx.reference}.pdf`);
}
