// CSV writing, shared by every export in the app.
//
// Deliberately DOM-free so it can be used from server components (the public
// site report renders on the server) as well as from the browser-side exports in
// lib/export.ts, which owns the actual download.
//
// The escaping here is the security-relevant part: these files get opened in
// Excel, and several get sent to clients or an accountant.

/**
 * Escape one CSV field.
 *
 * Two jobs. The obvious one is quoting, so a value containing a comma, a quote
 * or a newline survives the round trip.
 *
 * The less obvious one is **formula injection**. Excel and Google Sheets treat a
 * cell starting with `=`, `+`, `-` or `@` as a formula, so a value like
 * `-2 drops` renders as an error and, worse, `=HYPERLINK(...)` or `=cmd|...`
 * becomes live content on the recipient's machine. Prefixing with an apostrophe
 * forces the cell to be read as text; the apostrophe itself is not displayed.
 *
 * Tab and carriage return are included because Excel strips leading whitespace
 * before deciding whether a cell is a formula.
 */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  const needsGuard = /^[\s]*[=+\-@\t\r]/.test(s);
  const body = needsGuard ? `'${s}` : s;
  return `"${body.replace(/"/g, '""')}"`;
}

/** One escaped row. */
export const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(',');

/**
 * A whole sheet. CRLF because that's what RFC 4180 specifies and what Excel
 * expects; every reader handles it.
 */
export const toCSV = (rows: unknown[][]): string => rows.map(csvRow).join('\r\n');

/**
 * Byte-order mark. Without it Excel reads a UTF-8 file as the system codepage
 * and mangles anything non-ASCII — accented site names, the é in a contractor's
 * name, the en dashes in a date range.
 */
export const UTF8_BOM = '﻿';

/**
 * Escape one field for a tab-separated clipboard paste.
 *
 * Tab-separated is what Excel, Google Sheets and Numbers all expect on the
 * clipboard: paste and the values land in separate columns with no import
 * dialog. That convenience is exactly why we cannot quote-wrap the way CSV
 * does — a paste is read literally, so quotes would show up in the cells.
 *
 * Instead the field is flattened: a tab or newline inside a value would push
 * the rest of the row into the wrong columns, so they collapse to a space.
 *
 * The formula-injection guard from csvCell applies unchanged — a note that
 * starts with '=' is just as live when pasted as when opened from a file.
 */
export function tsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  const flat = s.replace(/[\t\r\n]+/g, ' ');
  return /^\s*[=+\-@]/.test(flat) ? `'${flat}` : flat;
}

/** A whole sheet as clipboard-ready TSV. */
export const toTSV = (rows: unknown[][]): string =>
  rows.map((r) => r.map(tsvCell).join('\t')).join('\r\n');
