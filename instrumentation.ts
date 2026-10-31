// Runs once when the Next.js server starts. The Node.js server refuses to boot unless PayPal points at sandbox.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
