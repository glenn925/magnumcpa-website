// FILE: csv.ts
// WEBSITE FEATURE: the "download leads as CSV/Excel" button on the video
// library admin page. USED BY: leads.ts (builds the export).
// TESTED IN: test/units.test.ts ("csv").
//
// CSV generation for the admin lead export. Pure module — unit-tested directly.
//
// Lead names and emails are attacker-controlled text that ends up opened in
// Excel on Glenn's machine, so this is a security boundary, not a formatting
// helper. Two things matter and both are easy to get wrong:
//   1. Formula injection — a cell starting with = + - @ is evaluated by Excel.
//   2. Encoding — without a UTF-8 BOM, Excel reads the file as the system
//      codepage and mangles any non-ASCII name.

// Characters Excel treats as the start of a formula.
// WHY: a visitor could type "=HYPERLINK(...)" as their name; without this guard
// Excel would run it when Glenn opens the export ("CSV formula injection").
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

// Values that start with a trigger character but cannot form a dangerous
// formula: digits, spaces, and arithmetic/grouping punctuation only. This
// keeps E.164 phone numbers (+15555555555) and negative numbers readable
// instead of showing a stray apostrophe in every row. Every known injection
// payload needs something outside this set — letters for HYPERLINK/WEBSERVICE/
// cmd, or | ! ' for DDE — so excluding letters and those symbols is what makes
// the exemption safe.
const SAFE_NUMERICISH = /^[+-]?[\d\s().+-]+$/;

// Makes one value safe to put in a CSV cell. Input: any value (null -> empty).
// Returns: the cell text — prefixed with ' if it could be a formula, and
// wrapped in quotes if it contains a comma, quote or line break. No side effects.
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);

  // Normalize line endings first so the quoting decision below sees them.
  s = s.replace(/\r\n/g, '\n');

  // The formula guard: a leading apostrophe tells Excel "this is plain text".
  if (FORMULA_TRIGGER.test(s) && !SAFE_NUMERICISH.test(s)) {
    s = `'${s}`;
  }

  // Standard CSV quoting: wrap in "..." and double any " inside, so commas and
  // line breaks inside a value don't split it into extra columns/rows.
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Builds a whole CSV file. Inputs: header names + rows of values. Returns: the
// file text (every cell passed through csvCell). No side effects.
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // ﻿ = UTF-8 BOM; CRLF line endings per RFC 4180.
  return `﻿${lines.join('\r\n')}\r\n`;
}
