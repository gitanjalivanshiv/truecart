// Spreadsheet apps run cells that start with = + @ (or a tab/CR) as formulas. Product titles come from
// third-party listings, so neutralise them before they reach a CSV (OWASP "CSV injection").
export function csvSafe(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /^[=+@\t\r]|^-(?![\d.])/.test(text) ? `'${text}` : text;
}
