import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Overpass, Overpass_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Overpass({ subsets: ["latin"], weight: ["600", "700", "800", "900"], variable: "--font-display" });
const body = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-body",
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});
const mono = Overpass_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "System Lab: watch systems work, then break", template: "%s · System Lab" },
  description:
    "An animated field guide to system design. Watch requests flow, caches hit and miss, queues fill and servers fail, with live metrics for every idea.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f17" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-head">
          <Link href="/" className="brand" aria-label="System Lab home">
            <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
              <circle cx="16" cy="16" r="13" />
              <path d="M3 16h26" />
              <circle cx="22.5" cy="16" r="3.4" className="brand-dot" />
            </svg>
            <span>System Lab</span>
          </Link>
          <nav className="site-nav" aria-label="Site">
            <Link href="/#route">Route map</Link>
            <Link href="/learn/capstone">Capstone</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-foot">
          <p>Simulations are deterministic models with real queueing behaviour, slowed down so you can follow each request.</p>
          <p>
            Made with care by{" "}
            <a href="https://amankeshri.com" rel="noopener">
              Aman
            </a>
            .
          </p>
        </footer>
      </body>
    </html>
  );
}
