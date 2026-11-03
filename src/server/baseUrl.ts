// Public origin of this app: APP_BASE_URL if set, else Render's RENDER_EXTERNAL_URL, else local dev.
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/+$/, "");
}
