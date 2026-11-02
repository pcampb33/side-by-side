"use client";

import { useEffect, useRef, useState } from "react";

// A featured card's key metric, both companies, drawn in the first time the card
// scrolls into view. No numbers: the card is a link, and every number on the
// site opens its citation. Sized by its CSS box, measured, so strokes stay 2px.
export function Sparkline({ series, caption, delay, className = "" }: { series: (number | null)[][]; caption: string; delay: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [[W, H], setSize] = useState([0, 0]);
  // The ms to wait before drawing: what's left of `delay` (the card's own rise-in) since mount.
  const [wait, setWait] = useState<number | null>(null);
  useEffect(() => {
    const mounted = performance.now();
    const plot = ref.current!.firstElementChild!;
    const resize = new ResizeObserver(([entry]) => setSize([entry.contentRect.width, entry.contentRect.height]));
    const view = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setWait(Math.max(0, delay - (performance.now() - mounted)));
      view.disconnect();
    }, { threshold: 0.6 });
    resize.observe(plot);
    view.observe(ref.current!);
    return () => (resize.disconnect(), view.disconnect());
  }, [delay]);

  const values = series.flat().filter((v) => v !== null);
  const [lo, hi] = [Math.min(0, ...values), Math.max(0, ...values)];
  const x = (i: number) => 4 + ((W - 8) * i) / Math.max(series[0].length - 1, 1);
  const y = (v: number) => 4 + (H - 8) * (1 - (v - lo) / (hi - lo || 1));
  const lines = series.map((s) => s.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)] as const])));
  const d = (pts: (typeof lines)[number]) => pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join("");
  const b = lines[1];

  return (
    <div ref={ref} aria-hidden className={`spark ${className}`} data-drawn={wait !== null || undefined} style={{ "--spark-delay": `${wait ?? 0}ms` } as React.CSSProperties}>
      <svg className="spark-plot" viewBox={`0 0 ${W} ${H}`}>
        {W > 0 && b.length > 1 && <path className="spark-area" d={`${d(b)}L${b.at(-1)![0]},${H}L${b[0][0]},${H}Z`} fill="var(--series-b)" />}
        {W > 0 &&
          lines.map((pts, j) => (
            <g key={j} style={{ "--j": j } as React.CSSProperties}>
              <path className="spark-line" d={d(pts)} pathLength={1} stroke={`var(--series-${j ? "b" : "a"})`} />
              {pts.length > 0 && <circle className="spark-end" cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r={3} fill={`var(--series-${j ? "b" : "a"})`} />}
            </g>
          ))}
      </svg>
      <div className="spark-cap">{caption}</div>
    </div>
  );
}
