import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { AppShell } from "./_components/AppShell";
import "./globals.css";

const grotesk = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });

export const metadata: Metadata = {
  title: "TrueCart (sandbox)",
  description:
    "Shopping agent that buys within a PayPal spending mandate and ranks offers by landed cost. PayPal sandbox only: no real money.",
};

// Applied before paint so a saved dark/light choice never flashes.
const themeScript = `try{var t=localStorage.getItem("tc-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={grotesk.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
