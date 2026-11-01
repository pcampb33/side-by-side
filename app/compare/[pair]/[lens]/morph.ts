// The text lens's one orchestrated motion: each pill read from a 10-K morphs
// into its subject once Claude's grouping arrives; a shared subject takes one
// pill from each company. Then labels rise, icons draw and group counts tick
// up. Plain Web Animations, no library.

export interface PillSnapshot {
  ref: string; // "AAPL-r3"
  side: 0 | 1; // which company
  text: string;
  x: number; // relative to the stage
  y: number;
  w: number;
  h: number;
}

const EASE = "cubic-bezier(.16, 1, .3, 1)";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Snapshot every pill on screen, relative to the stage, before they unmount.
export function snapshotPills(stage: HTMLElement): PillSnapshot[] {
  const box = stage.getBoundingClientRect();
  return Array.from(stage.querySelectorAll<HTMLElement>("[data-pill]")).map((el) => {
    const r = el.getBoundingClientRect();
    return { ref: el.dataset.pill!, side: Number(el.dataset.side) as 0 | 1, text: el.textContent ?? "", x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
  });
}

// CSS custom properties resolved to colors WAAPI can interpolate.
function resolveColor(stage: HTMLElement, value: string): string {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;background:${value}`;
  stage.appendChild(probe);
  const c = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return c;
}

/**
 * Runs the morph into `root` (the tiles component). `tileFor` maps a pill's
 * ref to its tile element. Returns a cancel function that leaves the final
 * layout fully visible, so an interrupted morph never hides content.
 */
export function playMorph(opts: { stage: HTMLElement; root: HTMLElement; pills: PillSnapshot[]; tileFor: (ref: string) => HTMLElement | null; onDone: () => void }): () => void {
  const { stage, root, pills } = opts;
  const anims: Animation[] = [];
  const ghosts: HTMLElement[] = [];
  const timers: number[] = [];
  const tiles = Array.from(root.querySelectorAll<HTMLElement>("[data-tile]"));
  const reveal = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    anims.forEach((a) => a.cancel());
    timers.forEach(clearTimeout);
    ghosts.forEach((g) => g.remove());
    tiles.forEach((t) => delete t.dataset.pre);
    reveal.forEach((el) => (el.style.opacity = ""));
    root.querySelectorAll<SVGElement>("[data-tile] svg *").forEach((el) => {
      el.style.strokeDasharray = "";
      el.removeAttribute("pathLength");
    });
    root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => (el.textContent = el.dataset.count!));
  };

  tiles.forEach((t) => (t.dataset.pre = ""));
  reveal.forEach((el) => (el.style.opacity = "0"));

  const box = stage.getBoundingClientRect();
  const rule = resolveColor(stage, "var(--rule)");

  // Cascade by destination: top to bottom, then left to right.
  const jobs = pills
    .map((p) => {
      const tile = opts.tileFor(p.ref);
      if (!tile) return null;
      const r = tile.getBoundingClientRect();
      return { p, to: { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height } };
    })
    .filter((j) => j !== null)
    .sort((a, b) => a.to.y - b.to.y || a.to.x - b.to.x);

  const moves = jobs.map(({ p, to }, n) => {
    const g = document.createElement("div");
    g.className = "morph-ghost";
    const label = g.appendChild(document.createElement("span"));
    label.textContent = p.text;
    g.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
    stage.appendChild(g);
    ghosts.push(g);
    const delay = n * 30;
    anims.push(label.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay, fill: "forwards" }));
    const move = g.animate(
      [
        { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`, borderColor: rule, borderRadius: `${p.h / 2}px` },
        { left: `${to.x}px`, top: `${to.y}px`, width: `${to.w}px`, height: `${to.h}px`, borderColor: "transparent", borderRadius: "12px" },
      ],
      { duration: 820, delay, easing: EASE, fill: "forwards" },
    );
    anims.push(move);
    return move.finished;
  });

  Promise.all(moves)
    .then(() => {
      if (finished) return;
      ghosts.forEach((g) => g.remove());
      tiles.forEach((t) => delete t.dataset.pre);
      reveal.forEach((el, i) => {
        el.style.opacity = "";
        anims.push(el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 480, delay: i * 30, easing: EASE, fill: "backwards" }));
      });
      // Icons draw themselves, stroke by stroke.
      tiles.forEach((t, i) =>
        t.querySelectorAll<SVGGeometryElement>("svg path, svg circle, svg rect, svg line, svg polyline, svg polygon, svg ellipse").forEach((el) => {
          el.setAttribute("pathLength", "1");
          el.style.strokeDasharray = "1";
          const a = el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 700, delay: 60 + i * 45, easing: "cubic-bezier(.65, 0, .35, 1)", fill: "backwards" });
          anims.push(a);
          a.finished.then(() => {
            el.style.strokeDasharray = "";
            el.removeAttribute("pathLength");
          }, () => {});
        }),
      );
      root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
        const n = Number(el.dataset.count);
        const t0 = performance.now();
        const tick = () => {
          if (finished) return;
          const k = Math.min(1, (performance.now() - t0) / 600);
          el.textContent = String(Math.round(n * (1 - (1 - k) ** 3)));
          if (k < 1) requestAnimationFrame(tick);
        };
        el.textContent = "0";
        requestAnimationFrame(tick);
      });
      timers.push(window.setTimeout(() => {
        finish();
        opts.onDone();
      }, 60 + tiles.length * 45 + 760));
    })
    .catch(() => {}); // cancelled: finish() already restored the layout

  return finish;
}
