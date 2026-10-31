// Sandbox-only guard. TrueCart must never talk to production PayPal.
// Every PayPal URL passes through here: at boot (instrumentation-node.ts) and on every request.

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
export const PAYPAL_SANDBOX_MCP_URL = "https://mcp.sandbox.paypal.com";

const SANDBOX_HOSTS = { api: "api-m.sandbox.paypal.com", mcp: "mcp.sandbox.paypal.com" } as const;
export type SandboxService = keyof typeof SANDBOX_HOSTS;

export class SandboxGuardError extends Error {
  override name = "SandboxGuardError";
}

/**
 * Returns the canonical sandbox URL for `service`, or throws.
 * Unset means sandbox. Anything else must be exactly https://<sandbox host for that service> with no
 * credentials, port, path, query or fragment. The rejected value is never echoed (it may hold secrets).
 */
export function assertSandboxUrl(value: string | undefined, service: SandboxService = "api"): string {
  const host = SANDBOX_HOSTS[service];
  const raw = (value ?? "").trim();
  if (raw === "") return `https://${host}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SandboxGuardError(`PayPal ${service} URL is not a valid URL. TrueCart runs against PayPal sandbox only.`);
  }

  const clean =
    url.protocol === "https:" &&
    url.hostname === host &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";

  if (!clean) {
    throw new SandboxGuardError(
      `PayPal ${service} URL must be https://${host}. TrueCart refuses to run against any other PayPal host.`,
    );
  }
  return `https://${host}`;
}

export function paypalBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return assertSandboxUrl(env.PAYPAL_BASE_URL, "api");
}
