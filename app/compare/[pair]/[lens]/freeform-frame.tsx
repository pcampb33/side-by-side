"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { themeCss, type ThemeChoice } from "@/lib/theme";
import { useTheme } from "@/app/theme-switch";

// A page Claude wrote, in a sandbox without allow-same-origin: its scripts
// run, but it can't touch this page, its cookies or the network.

// Inline scripts and styles only; images and fonts only as data: URIs.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

// The frame can't be measured from outside, so the page reports its own height.
const HEIGHT_SCRIPT = `addEventListener("DOMContentLoaded",function(){var b=document.body,p=function(){parent.postMessage({freeformHeight:Math.ceil(b.getBoundingClientRect().bottom+parseFloat(getComputedStyle(b).marginBottom||"0"))},"*")};new ResizeObserver(p).observe(b);addEventListener("load",p);p()});`;

// The model's page with the CSP, the site's theme variables and the height
// reporter first in its <head> (agent/freeform.ts checks it has one).
export function framePage(html: string, theme: ThemeChoice = "system"): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${themeCss(theme)}</style><script>${HEIGHT_SCRIPT}</script>`;
  return html.replace(/<head(\s[^>]*)?>/i, (tag) => tag + head);
}

export function FreeformFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // A theme switch reloads the page, so colors it computed in script follow too.
  const theme = useTheme();
  const srcDoc = useMemo(() => framePage(html, theme), [html, theme]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = (e.data as { freeformHeight?: unknown } | null)?.freeformHeight;
      if (typeof h === "number" && h > 0) setHeight(Math.min(h, 30_000));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      title="Comparison page written by Claude"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="freeform block w-full border-0"
      data-ready={height !== null || undefined}
      style={{ height: height ?? 600 }}
    />
  );
}
