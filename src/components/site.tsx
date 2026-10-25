import Link from "next/link";
import { Brand } from "./brand";

// The site's header and footer, for the pages that scroll (home, glossary, progress, My System's gallery, 404). Apart
// from the mark (`brand.tsx`), which every lesson page carries in its bar.

/** Plain links on the 404 page: see `Brand`. */
type Plain = { plain?: boolean };

export function SiteHeader({ plain = false }: Plain) {
  const A = plain ? "a" : Link;
  return (
    <header className="site-head">
      <Brand plain={plain} />
      <nav className="site-nav" aria-label="Site">
        <A href="/#route">Map</A>
        <A href="/#journeys">Journeys</A>
        <A href="/my-system">My system</A>
        <A href="/glossary" className="nav-wide">
          Glossary
        </A>
        <A href="/progress">Progress</A>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <p>
        Simulations are deterministic models with real queueing behaviour, slowed down so you can follow each request. Every term is in the{" "}
        <a href="/glossary">glossary</a>.
      </p>
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
