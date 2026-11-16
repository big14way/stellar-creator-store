// Motion, measured from the reference design: reveals ease on cubic-bezier(.2,.8,.2,1),
// headline words rise out of a mask over 1s, springs overshoot on cubic-bezier(.34,1.56,.64,1).

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** True once the element has scrolled into view (and stays true). */
export function useInView<T extends Element>(margin = "0px 0px -12% 0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return setInView(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, inView] as const;
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  style?: CSSProperties;
  as?: "div" | "p" | "span" | "li" | "section";
};

/** Fades and rises into place when scrolled into view. */
export function Reveal({ children, className, delay = 0, style, as = "div" }: RevealProps) {
  const [ref, on] = useInView<HTMLElement>();
  const Tag = as as "div";
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`rv ${on ? "is-on" : ""} ${className ?? ""}`}
      style={{ ...style, transitionDelay: delay ? `${delay}ms` : undefined }}
    >
      {children}
    </Tag>
  );
}

type HeadlineProps = {
  lines: string[];
  /** Index of the line set in the accent colour, with the underline that draws in. */
  accent?: number;
  as?: "h1" | "h2" | "h3";
  className?: string;
  id?: string;
  testId?: string;
};

/** A headline whose words rise out of a mask, one after another, when it scrolls into view. */
export function Headline({ lines, accent, as = "h2", className, id, testId }: HeadlineProps) {
  const [ref, on] = useInView<HTMLHeadingElement>();
  const Tag = as;
  let n = 0;
  return (
    <Tag ref={ref} id={id} data-testid={testId} className={`hd ${on ? "is-on" : ""} ${className ?? ""}`}>
      {lines.map((line, li) => (
        <span key={li} className={`hd-l ${li === accent ? "accent hd-acc" : ""}`}>
          {line.split(" ").map((word, wi, words) => (
            <span key={wi}>
              <span className="hd-w">
                <span className="hd-i" style={{ transitionDelay: `${n++ * 70}ms` }}>
                  {word}
                </span>
              </span>
              {wi < words.length - 1 ? " " : null}
            </span>
          ))}
          {li < lines.length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}

/** A number that counts up from zero when it scrolls into view. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-US") }: { value: number; format?: (n: number) => string }) {
  const [ref, on] = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!on) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setShown(value);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1400);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, value]);
  return <span ref={ref}>{format(shown)}</span>;
}
