import { SiteHeader } from "@/components/site";

// Plain links throughout: this page's client code is sent with every page (see `brand.tsx`).
export default function NotFound() {
  return (
    <>
      <SiteHeader plain />
      <section className="wrap lost">
        <p className="eyebrow">404</p>
        <h1>This station isn&rsquo;t on the map.</h1>
        <p>
          The page may have moved when the course was rebuilt. <a href="/#route">Pick a lesson from the route map</a>.
        </p>
      </section>
    </>
  );
}
