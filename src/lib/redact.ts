// Redaction for anything that leaves the process: logs, spike output, the "PayPal activity" panel.

const DROP =
  /^(access_token|refresh_token|id_token|client_secret|secret|password|authorization|api[-_]?key|x-api-key|nonce)$/i;
const MASK_TAIL =
  /^(vault_id|payment_token|customer_id|payer_id|account_id|merchant_id|email_address|email|phone_number|national_number)$/i;

// Personal fields from PayPal payer/shipping objects (sandbox data, but never shown in the UI).
const PERSONAL =
  /^(given_name|surname|full_name|middle_name|address_line_1|address_line_2|admin_area_1|admin_area_2|postal_code|birth_date)$/i;

export function maskTail(value: string, keep = 4): string {
  if (value.length <= keep) return "*".repeat(value.length);
  return `${"*".repeat(Math.min(8, value.length - keep))}${value.slice(-keep)}`;
}

/** Deep-copies `input`, dropping secrets and masking identifiers. Safe on cycles. */
export function redact<T>(input: T, seen = new WeakSet<object>()): T {
  if (input === null || typeof input !== "object") return input;
  if (seen.has(input as object)) return "[cycle]" as unknown as T;
  seen.add(input as object);

  if (Array.isArray(input)) return input.map((v) => redact(v, seen)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (DROP.test(key)) out[key] = "[redacted]";
    else if (MASK_TAIL.test(key) && typeof value === "string") out[key] = maskTail(value);
    else if (PERSONAL.test(key) && typeof value === "string") out[key] = "[personal]";
    else if (key === "href" && typeof value === "string")
      out[key] = value.replace(/([?&](token|ba_token)=)[^&]+/gi, "$1[redacted]");
    else out[key] = redact(value, seen);
  }
  return out as T;
}
