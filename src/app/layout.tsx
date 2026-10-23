import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Newsreader, Overpass, Overpass_Mono } from "next/font/google";
import "./globals.css";

// All four faces are variable fonts: one file each covers every weight.
const display = Overpass({ subsets: ["latin"], variable: "--font-display" });
const guide = Newsreader({ subsets: ["latin"], axes: ["opsz"], variable: "--font-guide", fallback: ["Georgia", "serif"] });
const body = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-body",
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});
const mono = Overpass_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "System Lab: watch systems work, then break", template: "%s · System Lab" },
  description:
    "An animated field guide to system design. Watch requests flow, caches hit and miss, queues fill and servers fail, with live metrics for every idea.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${guide.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
