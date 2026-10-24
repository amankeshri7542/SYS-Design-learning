import Link from "next/link";

/** The roundel mark: a station on a line, with a request about to arrive. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`brand${compact ? " brand-compact" : ""}`} aria-label="System Lab home">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
        <circle cx="16" cy="16" r="13" />
        <path d="M3 16h26" />
        <circle cx="22.5" cy="16" r="3.4" className="brand-dot" />
      </svg>
      <span className="brand-name">System Lab</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-head">
      <Brand />
      <nav className="site-nav" aria-label="Site">
        <Link href="/#route">Map</Link>
        <Link href="/#journeys">Journeys</Link>
        <Link href="/glossary">Glossary</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
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
  );
}
