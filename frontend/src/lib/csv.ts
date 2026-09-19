/**
 * CSV writing for downloads. Every cell is quoted, and a cell that a spreadsheet
 * could read as a formula (starts with =, +, -, @, tab or carriage return) is
 * prefixed with an apostrophe. The backend already refuses such names on upload;
 * this is the second guard, at the point the file leaves the app.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
