import type { Metadata } from "next";
import { IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import { Header } from "./_components/Header";
import "./globals.css";

const grotesk = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "TrueCart (sandbox)",
  description:
    "Shopping agent that buys within a PayPal spending mandate and ranks offers by landed cost. PayPal sandbox only: no real money.",
};

// Applied before paint so a saved dark/light choice never flashes.
const themeScript = `try{var t=localStorage.getItem("tc-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${grotesk.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <div
          role="status"
          className="bg-ink px-4 py-1.5 text-center font-mono text-[11px] tracking-[0.08em] text-paper uppercase"
        >
          Sandbox: no real money. Merchants are simulated. Shipping, tax and FX figures are estimates.
        </div>
        <Header />
        <main className="mx-auto max-w-[1240px] px-4 pt-10 pb-20 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-[1240px] border-t border-rule px-4 py-6 text-[13px] text-muted sm:px-6">
          PayPal sandbox · Offers from Channel3 · Rates from Frankfurter · AI model: Gemini (free tier). Product names
          and stores are masked in demo mode.
        </footer>
      </body>
    </html>
  );
}
