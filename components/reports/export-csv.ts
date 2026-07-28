/**
 * CSV export helpers for the Reports page. Build the string from the rendered
 * dataset, then hand it to the browser as a real file download.
 */

/** Quote a field when it contains commas, quotes, or line breaks. */
export function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row + data rows, comma-separated, CRLF line endings. */
export function buildCsv(
  headers: string[],
  rows: (string | number)[][]
): string {
  return [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
}

/** `fortmark-<report>-<preset>.csv` */
export function csvFilename(report: string, preset: string): string {
  return `fortmark-${report}-${preset}.csv`;
}

/** Trigger a real browser download via Blob + object URL, then clean up. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
