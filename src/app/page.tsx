import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/brand";
import { HeroScene } from "@/components/hero";
import { DotStrip } from "@/components/legend";
import { RouteMap } from "@/components/route-map";
import { LESSONS } from "@/lib/lessons";

export default function Home() {
  const count = LESSONS.length - 1;
  return (
    <>
      <SiteHeader />
      <section className="hero wrap-wide">
        <div className="hero-copy">
          <p className="eyebrow">An animated field guide to system design</p>
          <h1>
            Watch systems work. <span>Then watch them break.</span>
          </h1>
          <p className="lede">
            {count} short lessons, each a live simulation on one screen. See the problem, switch on the fix, and watch the numbers change.
          </p>
          <div className="cta">
            <Link className="btn-primary" href={`/learn/${LESSONS[0].slug}`}>
              Start at F1 <span aria-hidden="true">→</span>
            </Link>
            <a className="btn-quiet" href="#route">
              See the route map
            </a>
          </div>
          <DotStrip />
        </div>
        <HeroScene />
      </section>

      <section id="route" className="wrap route" aria-labelledby="route-h">
        <div className="route-head">
          <h2 id="route-h" className="section-h">
            The route
          </h2>
          <p className="section-sub">Five lines, from a single request to a full system. Ride them in order, or jump to any station.</p>
        </div>
        <RouteMap />
      </section>
      <SiteFooter />
    </>
  );
}
