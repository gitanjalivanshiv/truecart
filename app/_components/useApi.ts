"use client";

import { useCallback, useEffect, useState } from "react";

/** Any mutation dispatches this; every panel that shows server state refetches. */
export const REFRESH_EVENT = "truecart:refresh";
export const refreshAll = () => window.dispatchEvent(new Event(REFRESH_EVENT));

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function useApi<T>(url: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });

  const reload = useCallback(
    () =>
      getJson<T>(url).then(
        (data) => setState({ data, error: null, loading: false }),
        (err: Error) => setState((s) => ({ ...s, error: err.message, loading: false })),
      ),
    [url],
  );

  useEffect(() => {
    let alive = true;
    const run = () =>
      getJson<T>(url).then(
        (data) => alive && setState({ data, error: null, loading: false }),
        (err: Error) => alive && setState((s) => ({ ...s, error: err.message, loading: false })),
      );
    run();
    window.addEventListener(REFRESH_EVENT, run);
    return () => {
      alive = false;
      window.removeEventListener(REFRESH_EVENT, run);
    };
  }, [url]);

  return { ...state, reload };
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json as T;
}
