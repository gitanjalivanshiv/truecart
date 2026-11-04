// Tiny toast bus: any component calls toast(); the Toaster in the app shell shows it.
export type ToastTone = "success" | "warning" | "danger" | "info";
export interface ToastMessage {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}

export const TOAST_EVENT = "truecart:toast";
let next = 1;

export function toast(title: string, opts: { body?: string; tone?: ToastTone } = {}) {
  if (typeof window === "undefined") return;
  const detail: ToastMessage = { id: next++, title, body: opts.body, tone: opts.tone ?? "info" };
  window.dispatchEvent(new CustomEvent<ToastMessage>(TOAST_EVENT, { detail }));
}
