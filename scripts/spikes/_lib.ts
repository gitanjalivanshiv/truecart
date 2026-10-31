// Shared helpers for feasibility spikes. Spikes print compact, redacted results only.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { redact } from "@/src/lib/redact";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* file absent: fine */
  }
}

const OUT = join(process.cwd(), "scripts/spikes/.out"); // git-ignored: holds ids between spike steps

export const EXIT_BLOCKED = 2;

/** Exits with code 2 and a checklist if any env var is missing. Never prints values. */
export function requireEnv(...names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.log(`BLOCKED: missing env ${missing.join(", ")} (set them in .env; see .env.example)`);
    process.exit(EXIT_BLOCKED);
  }
}

export function save(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
}

export function load<T>(name: string): T | undefined {
  const p = join(OUT, `${name}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : undefined;
}

export function show(label: string, data: unknown): void {
  console.log(`\n== ${label}\n${JSON.stringify(redact(data), null, 2)}`);
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

export async function run(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    const e = err as Error & { status?: number; debugId?: string; issue?: string; body?: unknown };
    console.log(`FAIL: ${e.name}: ${e.message}`);
    if (e.body) show("error body (redacted)", e.body);
    process.exit(1);
  }
}
