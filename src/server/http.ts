// Small helpers for route handlers: JSON responses, body validation and safe error mapping.
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { NoVisitorError } from "./visitor";

export const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return json(
      { error: "Invalid request.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      400,
    );
  return parsed.data;
}

/** Wraps a handler so unexpected errors never leak internals (or secrets) to the browser. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      // Next.js signals (prerender bail-out, redirects) must propagate, not become a 500.
      unstable_rethrow(err);
      if (err instanceof NoVisitorError) return json({ error: "Reload the page to start a session." }, 401);
      console.error(`[api] ${(err as Error).name}: ${(err as Error).message}`);
      return json({ error: "Something went wrong on our side. Nothing was charged." }, 500);
    }
  };
}
