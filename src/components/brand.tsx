import Link from "next/link";

/**
 * Plain links, for the 404 page: the root layout sends its not-found page's client code with every page, and a `Link`
 * there would put a second copy of `next/link` on every lesson page.
 */
type Plain = { plain?: boolean };

/** The roundel mark: a station on a line, with a request about to arrive. */
export function Brand({ compact = false, plain = false }: { compact?: boolean } & Plain) {
  const A = plain ? "a" : Link;
  return (
    <A href="/" className={`brand${compact ? " brand-compact" : ""}`} aria-label="System Lab home">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
        <circle cx="16" cy="16" r="13" />
        <path d="M3 16h26" />
        <circle cx="22.5" cy="16" r="3.4" className="brand-dot" />
      </svg>
      <span className="brand-name">System Lab</span>
    </A>
  );
}
