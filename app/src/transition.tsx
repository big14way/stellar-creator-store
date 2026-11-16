import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";

/**
 * The page change of the reference store: a dark cover slides up, a price tag naming the next
 * page swings in on its hole while a bar fills, the route changes under the cover, then the cover
 * lifts and the tag drops away. Every phase is a fraction of one base duration, as measured.
 */
const D = 800;
/** The tag has settled (.25d + .9d) and the bar is full (.55d + .6d); hold a beat, then swap. */
const SWAP = D * 1.2;
/** The cover lifts after .15d over .9d. */
const LIFT = D * 1.05;

/** Page name and aisle number shown on the tag, by path. */
const PAGES: Record<string, [string, string]> = {
  "/": ["home", "01"],
  "/shop": ["shop", "02"],
  "/sell": ["sell", "03"],
  "/library": ["library", "04"],
  "/dashboard": ["dashboard", "05"],
};

type Dest = { name: string; aisle: string };

/** What the tag says about where a link goes: a product's title, a shop's handle or the page's name. */
function destination(a: HTMLAnchorElement, url: URL): Dest {
  const given = a.dataset.ptName;
  const path = url.pathname;
  if (path.startsWith("/p/")) {
    const title = (given ?? a.querySelector(".box-title, .card-meta strong")?.textContent ?? a.textContent ?? "").trim();
    return { name: title && title.length <= 60 ? title : "the product", aisle: "02" };
  }
  if (path.startsWith("/c/")) {
    const id = decodeURIComponent(path.slice(3));
    return { name: given ?? (id.length <= 20 ? `@${id}` : "a shop"), aisle: "02" };
  }
  const [name, aisle] = PAGES[path] ?? ["paperstall", "00"];
  return { name: given ?? name, aisle };
}

/** Same-site links to another page get the transition; filters, anchors, files and outside links do not. */
function target(e: MouseEvent): { a: HTMLAnchorElement; url: URL } | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest("a") : null;
  if (!a || !a.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return null;
  if (url.pathname === window.location.pathname) return null;
  return { a, url };
}

export function PageTransition() {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<"idle" | "leave" | "enter">("idle");
  const [dest, setDest] = useState<Dest>({ name: "", aisle: "01" });
  const busy = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timers: number[] = [];
    const onClick = (e: MouseEvent) => {
      const hit = target(e);
      if (!hit) return;
      // Taken over before the router's own handler, so the route changes only under the cover.
      e.preventDefault();
      e.stopPropagation();
      if (busy.current) return;
      const to = hit.url.pathname + hit.url.search + hit.url.hash;
      if (reduce.matches) {
        navigate(to);
        return;
      }
      busy.current = true;
      setDest(destination(hit.a, hit.url));
      setPhase("leave");
      timers.push(
        window.setTimeout(() => {
          navigate(to);
          setPhase("enter");
          timers.push(
            window.setTimeout(() => {
              setPhase("idle");
              busy.current = false;
            }, LIFT + 60),
          );
        }, SWAP),
      );
    };
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      timers.forEach(clearTimeout);
      busy.current = false;
    };
  }, [navigate]);

  return (
    <div className={`pt pt-${phase}`} style={{ "--d": `${D}ms` } as CSSProperties} aria-hidden="true" data-testid="page-transition">
      <div className="pt-cover">
        <i className="pt-glow" />
      </div>
      <div className="pt-tag">
        <i className="pt-hole" />
        <p className="pt-at">
          <span>Paperstall</span>
          <span>Next aisle · {dest.aisle}</span>
        </p>
        <p className="pt-name">
          <span>{dest.name}</span>
        </p>
        <div className="pt-bar">
          <i />
        </div>
      </div>
    </div>
  );
}
