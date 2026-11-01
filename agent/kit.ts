import { formatValue } from "../lib/format.ts";
import { VALUE_KEYS, valueAt, valueDef, type ValueKey } from "../lib/values.ts";
import { checkComponent, type Component } from "./catalog.ts";
import type { CompanyInput } from "./prompt.ts";

// The freeform kit (SPEC §4a): the site's card, grid, stat and chip styles and
// a chart helper, added to every freeform page by its frame (and by the evals'
// renderer), so a page Claude writes looks like the site. kit.chart takes
// metric keys like the components do and looks every value up in the data the
// frame adds, so its charts are drawn to scale and can't show invented numbers.

export const KIT_PIECES = ["card", "grid", "stat", "chip", "chart"] as const;
export type KitPiece = (typeof KIT_PIECES)[number];

// Which pieces a page uses, for its trace.
export function kitUsed(html: string): KitPiece[] {
  return KIT_PIECES.filter((p) => (p === "chart" ? /\bkit\.chart\s*\(/ : new RegExp(`\\bkit-${p}\\b`)).test(html));
}

// Each company's values as the prompt's tables write them: [value, label],
// or "n/r" / "n/m", aligned with its own fiscal years.
type Cell = [number, string] | "n/r" | "n/m";
export interface KitData {
  companies: { ticker: string; name: string; years: number[] }[];
  metrics: Record<string, { label: string; unit: string; values: Cell[][] }>;
}

export function kitData(companies: CompanyInput[]): KitData {
  const metrics: KitData["metrics"] = {};
  for (const key of VALUE_KEYS) {
    const { label, unit } = valueDef(key);
    const values = companies.map(({ financials: f }) =>
      f.fiscalYears.map((fy): Cell => {
        const v = valueAt(f, key, fy);
        return v.status === "value" ? [v.value, formatValue(v.value, unit)] : v.status === "not_meaningful" ? "n/m" : "n/r";
      }),
    );
    metrics[key] = { label, unit, values };
  }
  return { companies: companies.map((c) => ({ ticker: c.ticker, name: c.name, years: c.financials.fiscalYears })), metrics };
}

// Goes in the page's <head>, after the theme variables.
export function kitHead(companies: CompanyInput[]): string {
  const data = JSON.stringify(kitData(companies)).replace(/</g, "\\u003c");
  return `<style>${KIT_CSS}</style><script>window.KIT_DATA=${data};${KIT_SCRIPT}</script>`;
}

// --- Checks at submit time ------------------------------------------------

// The text inside kit.chart( … ), up to its matching parenthesis.
function chartCalls(html: string): string[] {
  const calls: string[] = [];
  for (const m of html.matchAll(/\bkit\.chart\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < html.length && depth > 0; i++) {
      if (html[i] === "(") depth++;
      else if (html[i] === ")") depth--;
    }
    calls.push(html.slice(start, i - 1));
  }
  return calls;
}

// Checks each kit.chart call whose spec is written out, the way the
// component tools check theirs (a spec built in script is checked when it
// draws). Null when every one can draw.
export function checkKitCharts(html: string, companies: CompanyInput[]): string | null {
  const problems: string[] = [];
  for (const call of chartCalls(html)) {
    const type = /\btype\s*:\s*["'`](\w+)["'`]/.exec(call)?.[1];
    const one = /\bkey\s*:\s*["'`](\w+)["'`]/.exec(call)?.[1];
    const list = /\bkeys\s*:\s*\[([^\]]*)\]/.exec(call)?.[1];
    const keys = list !== undefined ? [...list.matchAll(/["'`](\w+)["'`]/g)].map((k) => k[1]) : one ? [one] : null;
    if (!keys) continue;
    const yearText = /\byear\s*:\s*(?:["'`](latest)["'`]|(\d{4}))/.exec(call);
    const year = yearText ? (yearText[1] === "latest" ? "latest" : Number(yearText[2])) : undefined;
    const say = (problem: string) => problems.push(`kit.chart(${call.trim().slice(0, 120)}): ${problem}`);
    const unknown = keys.filter((k) => !(VALUE_KEYS as readonly string[]).includes(k));
    if (unknown.length) {
      say(`unknown metric key${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}. Use keys from the data tables.`);
      continue;
    }
    if (type !== undefined && type !== "line" && type !== "bars") {
      say(`type is "line" or "bars".`);
      continue;
    }
    let component: Component;
    if (year === undefined) {
      if (keys.length !== 1) {
        say("a chart across the years takes one key; to compare several metrics, give a year.");
        continue;
      }
      component = { name: "trend_line", input: { title: "kit", key: keys[0] as ValueKey } };
    } else {
      if (type === "line") {
        say("a line shows every year; leave out year, or use bars.");
        continue;
      }
      if (keys.length > 4) {
        say("at most four metrics in one chart.");
        continue;
      }
      component = { name: "grouped_bars", input: { title: "kit", keys: keys as ValueKey[], year } };
    }
    const problem = checkComponent(component, companies);
    if (problem) say(problem);
  }
  return problems.length ? `${problems.join("\n")}\nFix these charts and submit again.` : null;
}

// --- What the prompt tells Claude ----------------------------------------

export const KIT_PROMPT = `The kit: the page also gets the site's own pieces. Use them for every card, layout, figure and chart they cover, and draw your own only for what they can't show. The kit animates them in; don't add entry animations to them.
- class="kit-card": a card (surface color, rounded, soft shadow, padding). Its first h2 or h3 is the card's title and a p right after it its note.
- class="kit-grid": puts the cards inside it two to a row when the page is wide enough and one to a row on phones; an odd last card takes the full row, so none sits alone.
- class="kit-stat a" (or b, for the second company): one figure with its label: <div class="kit-stat a"><small>Net margin, FY2025</small><strong>24.3%</strong></div>. Never use it for the headline strip's values.
- class="kit-chip a" (or b, or neither): a small pill with the company's color dot, for a legend entry or a tag.
- kit.chart(target, spec) draws a chart into target (an element or a CSS selector, e.g. an empty <div> inside a kit-card), from the data tables: you never pass numbers, it looks each value up. It sizes itself to its container, redraws on resize, puts the axis on round ticks in the data's units, adds a legend and a hover readout, marks n/r and n/m, and draws in when scrolled into view. Call it from a <script> at the end of <body>. Specs:
  {type: "line", key: "revenue"}: both companies across every fiscal year.
  {type: "bars", key: "freeCashFlow"}: the same, as bars grouped by year.
  {type: "bars", keys: ["grossMargin", "operatingMargin", "netMargin"], year: "latest"}: up to four metrics of one unit in one fiscal year ("latest" is each company's own latest; or a year like 2024).
  Write each spec out in the call, so the page can be checked before it is shown.`;

// --- The kit itself -------------------------------------------------------

// :where() keeps every rule at zero specificity, so the page's own CSS
// always wins over the kit's.
const KIT_CSS = `
:where(.kit-card){background:var(--surface);color:var(--ink);border-radius:16px;padding:20px;min-width:0;box-shadow:0 1px 2px light-dark(rgb(25 28 40/.05),rgb(0 0 0/.3)),0 6px 20px light-dark(rgb(25 28 40/.06),rgb(0 0 0/.25))}
:where(.kit-card)>:where(h2,h3):first-child{margin:0 0 4px;font:600 16px/1.35 var(--font-sans);letter-spacing:-.01em}
:where(.kit-card)>:where(h2,h3):first-child+:where(p){margin:0 0 14px;font-size:13.5px;line-height:1.5;color:var(--muted)}
:where(.kit-grid){display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}
@media (min-width:896px){:where(.kit-grid){grid-template-columns:repeat(2,minmax(0,1fr))}:where(.kit-grid)>:last-child:nth-child(odd){grid-column:1/-1}}
:where(.kit-stat){display:grid;gap:3px;align-content:start;padding:12px 14px;border-radius:12px;background:var(--paper);min-width:0}
:where(.kit-stat.a){box-shadow:inset 3px 0 0 var(--series-a)}
:where(.kit-stat.b){box-shadow:inset 3px 0 0 var(--series-b)}
:where(.kit-stat)>:where(small){font-size:12px;line-height:1.35;color:var(--muted)}
:where(.kit-stat)>:where(strong){font-size:22px;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--ink)}
:where(.kit-chip){display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;line-height:1.5;background:var(--paper);color:var(--ink);white-space:nowrap}
:where(.kit-chip.a,.kit-chip.b)::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--series-a)}
:where(.kit-chip.b)::before{background:var(--series-b)}
@keyframes kit-pop{from{opacity:0;transform:translateY(10px) scale(.97)}}
:where(.kit-js .kit-card:not(.kit-seen)){opacity:0}
:where(.kit-js .kit-card.kit-seen){animation:kit-pop .56s cubic-bezier(.34,1.56,.64,1) backwards}
:where(.kit-chart){position:relative;min-width:0}
:where(.kit-chart) svg{display:block;overflow:visible;touch-action:pan-y;outline:none}
:where(.kit-chart) svg:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
:where(.kit-chart) text{font:11px var(--font-sans);fill:var(--muted);font-variant-numeric:tabular-nums}
:where(.kit-legend){display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
:where(.kit-tip){position:absolute;top:34px;z-index:1;pointer-events:none;background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:8px 12px;font-size:12px;box-shadow:0 6px 20px light-dark(rgb(25 28 40/.1),rgb(0 0 0/.35));white-space:nowrap;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .2s cubic-bezier(.16,1,.3,1)}
:where(.kit-tip.on){opacity:1;transform:none}
:where(.kit-tip) b{font-weight:650;font-variant-numeric:tabular-nums}
:where(.kit-tip) i{display:inline-block;width:12px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
:where(.kit-tip) div+div{margin-top:3px}
:where(.kit-tip) span{color:var(--muted)}
:where(.kit-bar){transform-box:fill-box;transform-origin:50% 100%;transition:transform .8s cubic-bezier(.16,1,.3,1)}
:where(.kit-bar.neg){transform-origin:50% 0}
:where(.kit-chart:not(.kit-in)) .kit-bar{transform:scaleY(0)}
:where(.kit-line){stroke-dasharray:var(--len);stroke-dashoffset:var(--len);transition:stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1)}
:where(.kit-in) .kit-line{stroke-dashoffset:0}
:where(.kit-area){opacity:0;transition:opacity .8s .35s}
:where(.kit-in) .kit-area{opacity:1}
:where(.kit-dot){transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .45s cubic-bezier(.34,1.56,.64,1)}
:where(.kit-in) .kit-dot{transform:none}
:where(.kit-cat){transition:opacity .2s}
:where(.kit-chart.kit-hover) .kit-cat:not(.on){opacity:.4}
:where(.kit-chart-error){font-size:13px;color:var(--muted)}
@media (prefers-reduced-motion:reduce){:where(.kit-js .kit-card.kit-seen){animation:none}:where(.kit-chart) *{transition:none!important}}
`.trim();

// Plain JavaScript run inside the sandboxed page: no imports, no network.
const KIT_SCRIPT = String.raw`(function(){
var D=window.KIT_DATA,NS="http://www.w3.org/2000/svg",uid=0,linked=[];
var still=matchMedia("(prefers-reduced-motion: reduce)").matches;
document.documentElement.classList.add("kit-js");
function svg(tag,attrs,parent){var e=document.createElementNS(NS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e}
function html(tag,cls,parent,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;if(parent)parent.appendChild(e);return e}
function tick(v,u){if(u==="percent")return Math.round(v*100)+"%";if(u==="multiple")return v.toFixed(1)+"×";if(u==="years")return v.toFixed(0);var a=Math.abs(v),s=v<0?"−":"",p=u==="shares"?"":"$";if(a>=1e12)return s+p+(+(a/1e12).toFixed(1))+"T";if(a>=1e9)return s+p+(+(a/1e9).toFixed(0))+"B";if(a>=1e6)return s+p+(+(a/1e6).toFixed(0))+"M";return s+p+a}
function ticks(min,max){var span=max-min||Math.abs(max)||1,raw=span/4,mag=Math.pow(10,Math.floor(Math.log10(raw))),step=[1,2,2.5,5,10].map(function(m){return m*mag}).find(function(s){return s>=raw}),out=[];for(var t=Math.floor(min/step)*step;t<=Math.ceil(max/step)*step+step/2;t+=step)out.push(+t.toPrecision(12));return out}
// One company's value of one metric in a fiscal year (or "latest").
function cell(ci,key,fy){var c=D.companies[ci],i=fy==="latest"?c.years.length-1:c.years.indexOf(fy);if(i<0)return{fy:fy,none:true};var x=D.metrics[key].values[ci][i];return typeof x==="string"?{fy:c.years[i],text:x}:{fy:c.years[i],v:x[0],text:x[1]}}
function problem(type,keys,year){if(type!=="line"&&type!=="bars")return 'type is "line" or "bars"';if(!keys.length)return"no metric key";for(var i=0;i<keys.length;i++)if(!D.metrics[keys[i]])return"unknown metric key "+keys[i];if(year===undefined){if(keys.length!==1)return"a chart across the years takes one key"}else{if(type==="line")return"a line shows every year; leave out year";if(keys.length>4)return"at most four metrics";var u=D.metrics[keys[0]].unit;if(keys.some(function(k){return D.metrics[k].unit!==u}))return"mixed units"}return null}
function chart(target,spec){
  var host=typeof target==="string"?document.querySelector(target):target;
  if(!host){console.error("kit.chart: nothing matches "+target);return}
  spec=spec||{};
  var keys=spec.keys||(spec.key?[spec.key]:[]),type=spec.type||(spec.year===undefined?"line":"bars"),year=spec.year===undefined||spec.year==="latest"?spec.year:Number(spec.year);
  var err=problem(type,keys,year);
  if(err){host.textContent="This chart can't be drawn: "+err+".";host.classList.add("kit-chart-error");console.error("kit.chart: "+err);return}
  var unit=D.metrics[keys[0]].unit,n=D.companies.length;
  // Categories along the x axis: fiscal years (one key) or metrics (one year).
  var cats;
  if(year===undefined){var ys={};D.companies.forEach(function(c){c.years.forEach(function(y){ys[y]=1})});cats=Object.keys(ys).map(Number).sort().map(function(y){return{label:"FY"+y,short:"FY"+String(y).slice(2),cells:D.companies.map(function(c,ci){return cell(ci,keys[0],y)})}})}
  else cats=keys.map(function(k){return{label:D.metrics[k].label,cells:D.companies.map(function(c,ci){return cell(ci,k,year)})}});
  var vals=[];cats.forEach(function(c){c.cells.forEach(function(x){if(x.v!==undefined)vals.push(x.v)})});
  if(!vals.length){host.textContent="This chart can't be drawn: neither company reports "+keys.map(function(k){return D.metrics[k].label}).join(" or ")+".";host.classList.add("kit-chart-error");console.error("kit.chart: no values for "+keys.join(", "));return}
  var tk=ticks(Math.min.apply(null,[0].concat(vals)),Math.max.apply(null,[0].concat(vals))),lo=tk[0],hi=tk[tk.length-1];
  if(hi===lo)tk.push(hi=lo+1);
  host.classList.add("kit-chart");host.textContent="";
  var legend=html("div","kit-legend",host);
  // Colors inline: a page's own .a/.b rules would otherwise repaint the legend (kit styles have zero specificity).
  D.companies.forEach(function(c,ci){var y=year!==undefined&&cats[0].cells[ci].fy;html("span","kit-chip "+(ci?"b":"a"),legend,c.ticker+(y&&!cats[0].cells[ci].none?" · FY"+y:"")).style.cssText="background:var(--paper);color:var(--ink)"});
  var tip=html("div","kit-tip",host),box=html("div","",host),id="kit"+(++uid),width=0,active=null,place=null,shown=false;
  // Charts across the years share one hovered year (their x axes are the same years).
  var go=function(i){if(year===undefined)linked.forEach(function(f){f(i)});else place(i)};
  if(year===undefined)linked.push(function(i){if(place)place(i)});
  function draw(){
    var W=box.clientWidth;if(!W||W===width)return;width=W;box.textContent="";
    var H=W<480?200:240,lw=Math.max.apply(null,tk.map(function(t){return tick(t,unit).length}))*6.6+12;
    var M={t:10,r:type==="line"?22:W<480?6:14,b:year===undefined?24:38,l:lw},iw=Math.max(W-M.l-M.r,1),ih=H-M.t-M.b,k=cats.length,band=iw/k;
    var y=function(v){return M.t+ih-(v-lo)/(hi-lo)*ih},base=y(Math.max(lo,Math.min(0,hi)));
    var line=type==="line",x=function(i){return line?M.l+(k===1?iw/2:i*iw/(k-1)):M.l+band*(i+.5)};
    var s=svg("svg",{width:W,height:H,role:"img",tabindex:0,"aria-label":(year===undefined?D.metrics[keys[0]].label+" by fiscal year":keys.map(function(k){return D.metrics[k].label}).join(", ")+(year==="latest"?", latest fiscal year":", FY"+year))+", "+D.companies.map(function(c){return c.ticker}).join(" and ")},box);
    tk.forEach(function(t){svg("line",{x1:M.l,x2:W-M.r,y1:y(t),y2:y(t),stroke:"var(--rule)","stroke-width":t===0?1.5:1},s);svg("text",{x:M.l-8,y:y(t),dy:"0.32em","text-anchor":"end"},s).textContent=tick(t,unit)});
    var labels=svg("g",{},s);
    cats.forEach(function(c,i){
      var t=svg("text",{x:x(i),y:H-M.b+16,"text-anchor":"middle"},labels),words=(band<56&&c.short?c.short:c.label);
      // A metric name that doesn't fit its band wraps onto two lines.
      if(year!==undefined&&words.length*6.2>band-4&&words.indexOf(" ")>0){var sp=words.split(" "),half=Math.ceil(sp.length/2);[sp.slice(0,half).join(" "),sp.slice(half).join(" ")].forEach(function(w,j){svg("tspan",{x:x(i),dy:j?"1.25em":0},t).textContent=w})}
      else t.textContent=words;
    });
    var groups=cats.map(function(c,i){return svg("g",{"class":"kit-cat"},s)});
    var defs=svg("defs",{},s);
    if(line){
      D.companies.forEach(function(c,ci){
        var col="var(--series-"+(ci?"b":"a")+")",g=svg("linearGradient",{id:id+"g"+ci,x1:0,y1:0,x2:0,y2:1},defs);
        svg("stop",{offset:0,style:"stop-color:"+col+";stop-opacity:.14"},g);svg("stop",{offset:.85,style:"stop-color:"+col+";stop-opacity:0"},g);
        // A missing year breaks the line rather than bridging it.
        var runs=[],prev=false;cats.forEach(function(cat,i){var v=cat.cells[ci].v;if(v===undefined){prev=false;return}if(!prev)runs.push([]);runs[runs.length-1].push([x(i),y(v)]);prev=true});
        runs.forEach(function(r){
          if(r.length>1){svg("path",{"class":"kit-area",d:"M"+r[0][0]+","+base+r.map(function(p){return"L"+p[0]+","+p[1]}).join("")+"L"+r[r.length-1][0]+","+base+"Z",fill:"url(#"+id+"g"+ci+")"},s);
            var p=svg("path",{"class":"kit-line",d:r.map(function(p,j){return(j?"L":"M")+p[0]+","+p[1]}).join(""),fill:"none",stroke:col,"stroke-width":2.5,"stroke-linejoin":"round","stroke-linecap":"round"},s);p.style.setProperty("--len",Math.ceil(p.getTotalLength()))}
        });
        cats.forEach(function(cat,i){var v=cat.cells[ci].v;if(v===undefined)return;var d=svg("circle",{"class":"kit-dot",cx:x(i),cy:y(v),r:4,fill:col,stroke:"var(--surface)","stroke-width":2},groups[i]);d.style.transitionDelay=(250+i*900/Math.max(k-1,1))+"ms"});
      });
    }else{
      var gw=Math.min(band*.74,n*40),bw=gw/n-3;
      cats.forEach(function(cat,i){cat.cells.forEach(function(cl,ci){
        var bx=x(i)-gw/2+ci*(gw/n)+1.5;
        if(cl.v===undefined){if(!cl.none)svg("text",{x:bx+bw/2,y:base-5,"text-anchor":"middle"},groups[i]).textContent=cl.text;return}
        var top=y(cl.v),h=Math.abs(top-base),r=Math.min(4,bw/2,h),up=cl.v>=0,y0=up?top:base,y1=up?base:top;
        var d=up?"M"+bx+","+y1+"V"+(y0+r)+"Q"+bx+","+y0+" "+(bx+r)+","+y0+"H"+(bx+bw-r)+"Q"+(bx+bw)+","+y0+" "+(bx+bw)+","+(y0+r)+"V"+y1+"Z":"M"+bx+","+y0+"V"+(y1-r)+"Q"+bx+","+y1+" "+(bx+r)+","+y1+"H"+(bx+bw-r)+"Q"+(bx+bw)+","+y1+" "+(bx+bw)+","+(y1-r)+"V"+y0+"Z";
        var b=svg("path",{"class":"kit-bar"+(up?"":" neg"),d:d,fill:"var(--series-"+(ci?"b":"a")+")"},groups[i]);b.style.transitionDelay=(i*60+ci*30)+"ms";
      })});
    }
    var guide=line?svg("line",{y1:M.t,y2:M.t+ih,stroke:"var(--muted)","stroke-width":1,opacity:0},s):null;
    place=function(i){
      active=i;host.classList.toggle("kit-hover",i!==null&&!line);groups.forEach(function(g,j){g.classList.toggle("on",j===i)});
      if(guide)guide.setAttribute("opacity",i===null?0:1);
      if(i===null){tip.classList.remove("on");return}
      if(guide){guide.setAttribute("x1",x(i));guide.setAttribute("x2",x(i))}
      var c=cats[i];tip.textContent="";html("span","",html("div","",tip),c.label);
      c.cells.forEach(function(cl,ci){var r=html("div","",tip);html("i","",r).style.background="var(--series-"+(ci?"b":"a")+")";if(cl.none){html("span","",r,D.companies[ci].ticker+" has no FY"+cl.fy);return}html("b","",r,cl.text);r.appendChild(document.createTextNode(" "));html("span","",r,D.companies[ci].ticker+(year!==undefined?" FY"+cl.fy:""))});
      var px=x(i);tip.style.left=px>W/2?"":(px+12)+"px";tip.style.right=px>W/2?(W-px+12)+"px":"";tip.classList.add("on");
    };
    var pick=function(e){var r=s.getBoundingClientRect(),rel=e.clientX-r.left-M.l;go(Math.max(0,Math.min(k-1,line?Math.round(rel/iw*(k-1)):Math.floor(rel/band))))};
    s.addEventListener("pointermove",pick);s.addEventListener("pointerdown",pick);
    s.addEventListener("pointerleave",function(){go(null)});s.addEventListener("blur",function(){go(null)});
    s.addEventListener("focus",function(){go(k-1)});
    s.addEventListener("keydown",function(e){if(e.key==="ArrowLeft")go(Math.max(0,(active==null?0:active)-1));if(e.key==="ArrowRight")go(Math.min(k-1,(active==null?0:active)+1))});
  }
  draw();new ResizeObserver(function(){draw()}).observe(box);
  // Draws in once, when it first scrolls into view.
  if(still||!window.IntersectionObserver)host.classList.add("kit-in");
  else{var io=new IntersectionObserver(function(es){if(es.some(function(e){return e.isIntersecting})){io.disconnect();requestAnimationFrame(function(){host.classList.add("kit-in")})}},{threshold:.25});io.observe(host)}
}
window.kit={chart:chart};
// Cards ease in as they scroll into view, a beat apart.
addEventListener("DOMContentLoaded",function(){
  var cards=document.querySelectorAll(".kit-card");
  if(!window.IntersectionObserver){cards.forEach(function(c){c.classList.add("kit-seen")});return}
  var io=new IntersectionObserver(function(es){var n=0;es.forEach(function(e){if(!e.isIntersecting)return;io.unobserve(e.target);e.target.style.animationDelay=(n++*70)+"ms";e.target.classList.add("kit-seen")})},{threshold:.1});
  cards.forEach(function(c){io.observe(c)});
});
})();`;
