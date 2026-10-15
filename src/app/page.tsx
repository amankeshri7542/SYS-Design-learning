import Link from "next/link";
import { HeroScene } from "@/components/hero";
import { Legend } from "@/components/legend";
import { RouteMap } from "@/components/route-map";
import { LESSONS } from "@/lib/lessons";

export default function Home() {
  const count = LESSONS.length - 1;
  return (
    <>
      <section className="hero wrap">
        <p className="eyebrow">An animated field guide to system design</p>
        <h1>
          Watch systems work. <span>Then watch them break.</span>
        </h1>
        <div className="hero-row">
          <p className="lede">
            {count} short lessons, each one a live simulation. See the problem first, then the fix, with the numbers changing as you
            turn the knobs.
          </p>
          <div className="cta">
            <Link className="btn-primary" href={`/learn/${LESSONS[0].slug}`}>
              Start at F1 <span aria-hidden="true">→</span>
            </Link>
            <a className="btn-quiet" href="#route">
              See the route map
            </a>
          </div>
        </div>
      </section>

      <section className="wrap hero-scene" aria-label="Live example">
        <HeroScene />
      </section>

      <section className="wrap read" aria-labelledby="read-h">
        <h2 id="read-h" className="section-h">
          How to read a scene
        </h2>
        <p className="section-sub">Every lesson uses the same symbols. Learn them once here.</p>
        <Legend />
      </section>

      <section id="route" className="wrap route" aria-labelledby="route-h">
        <h2 id="route-h" className="section-h">
          The route
        </h2>
        <p className="section-sub">
          Five lines, from a single request to a full system. Ride them in order, or jump to any station. Each takes a few minutes.
        </p>
        <RouteMap />
      </section>
    </>
  );
}
