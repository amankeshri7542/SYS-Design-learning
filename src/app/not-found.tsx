import Link from "next/link";
import { SiteHeader } from "@/components/brand";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <section className="wrap lost">
        <p className="eyebrow">404</p>
        <h1>This station isn&rsquo;t on the map.</h1>
        <p>
          The page may have moved when the course was rebuilt. <Link href="/#route">Pick a lesson from the route map</Link>.
        </p>
      </section>
    </>
  );
}
