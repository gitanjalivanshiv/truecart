import { connection } from "next/server";
import { paypalBaseUrl } from "@/src/config/sandbox";

// Liveness for Render and the judge smoke script. Never reports secrets, only whether they are configured.
export async function GET() {
  await connection();
  paypalBaseUrl(); // throws if PAYPAL_BASE_URL is not sandbox
  const configured = (name: string) => Boolean(process.env[name]);
  return Response.json({
    ok: true,
    paypal: "sandbox",
    configured: {
      paypal: configured("PAYPAL_CLIENT_ID") && configured("PAYPAL_CLIENT_SECRET"),
      webhook: configured("PAYPAL_WEBHOOK_ID"),
      llm: configured("GEMINI_API_KEY"),
      channel3: configured("CHANNEL3_API_KEY"),
    },
    time: new Date().toISOString(),
  });
}
