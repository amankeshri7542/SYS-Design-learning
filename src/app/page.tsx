import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/brand";
import { HeroScene } from "@/components/hero";
import { LineIndex, StartLink } from "@/components/home-start";
import { Journeys } from "@/components/journeys";
import { ReadScene } from "@/components/read-scene";
import { RouteMap } from "@/components/route-map";
import { COURSE, LESSONS, STORIES, fastLane, liveLines } from "@/lib/lessons";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function Home() {
  const lines = liveLines();
  const lane = fastLane();
  return (
    <>
      <SiteHeader />
      <section className="masthead wrap-wide">
        <div className="masthead-copy">
          <h1>
            Watch systems work. <span>Then watch them break.</span>
          </h1>
          <p className="lede">
            An animated field guide to system design: {plural(LESSONS.length, "lesson")} on {plural(lines.length, "line")}, and{" "}
            {plural(STORIES.length, "real system")} to build. Each is a live simulation on one screen. See the problem, cause the failure, switch on
            the fix.
          </p>
          <div className="cta">
            <StartLink />
            <a className="btn-quiet" href="#route">
              Pick a station
            </a>
          </div>
          <LineIndex />
        </div>
        <HeroScene />
      </section>

      <section id="route" className="wrap-wide route" aria-labelledby="route-h">
        <div className="section-head">
          <h2 id="route-h" className="section-h">
            The route
          </h2>
          <p className="section-sub">
            Lines are topics; zones are levels. Ride the recommended path from {COURSE[0].code}, or jump to any station. A dimmed one is best after another.
          </p>
        </div>
        <RouteMap />
        <div className="fast-lane">
          <h3>Short on time? The interview fast lane</h3>
          <ol>
            {lane.map((e) => (
              <li key={e.slug} className={`line-${e.line}`}>
                <Link href={`/learn/${e.slug}`}>
                  <span className="stop-code">{e.code}</span> {e.title}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="journeys" className="wrap-wide journeys" aria-labelledby="journeys-h">
        <div className="section-head">
          <h2 id="journeys-h" className="section-h">
            Journeys
          </h2>
          <p className="section-sub">Real systems, built up stage by stage under growing traffic and failures. Each one rides several lines.</p>
        </div>
        <Journeys />
      </section>

      <section id="read" className="wrap-wide read" aria-labelledby="read-h">
        <div className="section-head">
          <h2 id="read-h" className="section-h">
            How to read a scene
          </h2>
          <p className="section-sub">Every scene draws a request the same seven ways. Shape and colour both carry the state, so a scene reads without colour too.</p>
        </div>
        <ReadScene />
      </section>
      <SiteFooter />
    </>
  );
}
