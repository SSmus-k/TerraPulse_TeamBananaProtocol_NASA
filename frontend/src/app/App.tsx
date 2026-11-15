import { useEffect, useMemo, useRef, useState } from "react";
import { StoreProvider, useStore } from "../engines/data/store";
import { Globe } from "../engines/visualization/globe/Globe";
import { formatLonLat, locateData, type GeoTarget } from "../engines/visualization/globe/globeMath";
import { IndexPanel, Pillars, TopBar, pillarCaption } from "./Cockpit";
import { Inspector } from "./Inspector";
import { MapTab } from "./tabs/MapTab";
import { ModelsTab } from "./tabs/ModelsTab";
import { TablesTab } from "./tabs/TablesTab";
import { TerrainTab } from "./tabs/TerrainTab";
import { UIProvider, useUI, type Tab } from "./ui";

const SPATIAL: Tab[] = ["map", "terrain"];
/** Tablets and small windows: the window is too small for the map/3D, so views open full screen. */
const COMPACT_QUERY = "(max-width: 1100px), (max-aspect-ratio: 23/20)";
const DOCK: { id: Tab; label: string }[] = [
  { id: "map", label: "Map" }, { id: "terrain", label: "Terrain" }, { id: "tables", label: "Tables" }, { id: "models", label: "Models" },
];

function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setM(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/**
 * The cockpit: pillars (views) and the floor index on the left, the porthole on the right.
 * The porthole starts on the Earth; when data with a location arrives (a workspace or an upload),
 * the globe turns and dives to it, then the porthole opens into the map or the 3D terrain.
 */
function Cockpit() {
  const { workspace, datasets, error, selected, select } = useStore();
  const { tab, setTab } = useUI();

  // where the data points (stable while datasets re-inspect)
  const located = locateData(workspace, datasets);
  const lkey = located?.key ?? null;
  const [replay, setReplay] = useState(0);
  // the Earth keeps revolving until the user chooses something (a place, a pillar or their own data)
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (lkey?.startsWith("up:")) setArmed(true); }, [lkey]);
  const target = useMemo<GeoTarget | null>(
    () => (located && armed ? { ...located, key: `${located.key}#${replay}` } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lkey, replay, armed]);

  const [arrivedKey, setArrivedKey] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  useEffect(() => { setManualOpen(false); }, [lkey]);
  const arrived = !!target && arrivedKey === target.key;
  const spatialOpen = arrived || manualOpen;
  const showViews = !SPATIAL.includes(tab) || spatialOpen;
  const flying = !!target && !arrived && !manualOpen;

  // keep the globe mounted until the crossfade finishes
  const [globeMounted, setGlobeMounted] = useState(true);
  useEffect(() => {
    if (!showViews) { setGlobeMounted(true); return; }
    const t = setTimeout(() => setGlobeMounted(false), 1200);
    return () => clearTimeout(t);
  }, [showViews]);

  const compact = useMedia(COMPACT_QUERY);
  const [dismissed, setDismissed] = useState(false); // compact: user went back to the cockpit
  const pick = (t: Tab) => {
    setTab(t); setDismissed(false);
    if (!SPATIAL.includes(t)) return;
    setArmed(true);
    if (!located) setManualOpen(true); // nothing to fly to: open the empty view
  };
  const choosePlace = (id: string) => {
    setArmed(true); setManualOpen(false); setDismissed(false);
    if (id === workspace?.id) { setArrivedKey(null); setReplay((r) => r + 1); } // same place: fly in again
    if (!SPATIAL.includes(tab)) setTab("terrain"); };
  const home = () => { setArmed(false); setManualOpen(false); setArrivedKey(null); if (!SPATIAL.includes(tab)) setTab("terrain"); };
  const shape = !showViews ? "round" : SPATIAL.includes(tab) ? "window" : "panel";

  // full screen for the view inside the window (Esc leaves it)
  // the view expands over the whole screen (CSS); where the browser allows it, true full screen too
  const viewRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    let native = false; // only leave the expanded view when a real full screen we were in has ended
    const onFs = () => { if (document.fullscreenElement) native = true; else if (native) { native = false; setFull(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setFull(false); setDismissed(true); } };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => { if (!showViews) setFull(false); }, [showViews]);
  const toggleFull = () => {
    if (full) { setFull(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); return; }
    setFull(true);
    void document.documentElement.requestFullscreen?.().catch(() => { /* not allowed here: the CSS expansion still applies */ });
  };

  // views fill the screen when asked (full) or, on tablets, whenever a view is open
  const expanded = full || (compact && showViews && !dismissed);
  const leaveExpanded = () => {
    if (full) { setFull(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
    if (compact) { setDismissed(true); home(); } // back to the revolving globe
  };

  const [hoverPillar, setHoverPillar] = useState<number | null>(null);

  // gentle pointer parallax between the depth layers (wall, pillars, floor); off while a view is in use
  const cockpitRef = useRef<HTMLDivElement>(null);
  const parallaxOn = !showViews && !expanded;
  useEffect(() => {
    const el = cockpitRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!parallaxOn || reduce) { el.style.setProperty("--mx", "0"); el.style.setProperty("--my", "0"); return; }
    let raf = 0, tx = 0, ty = 0, x = 0, y = 0;
    const tick = () => {
      x += (tx - x) * 0.08; y += (ty - y) * 0.08;
      el.style.setProperty("--mx", x.toFixed(4)); el.style.setProperty("--my", y.toFixed(4));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(tick) : 0;
    };
    const move = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1; ty = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move);
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, [parallaxOn]);

  const live = true; // the live, revolving Earth fills the painted window
  return (
    <div ref={cockpitRef} className={`cockpit ${expanded ? "is-full" : ""} ${compact ? "is-compact" : ""} ${showViews ? "is-viewing" : ""}`}>
      {/* the team artwork, scaled like a cover image; everything below is placed in its coordinates */}
      <div className="scene">
        {/* the artwork with the pillars and floor removed (they are separate layers above it) */}
        <img className="scene__art" src="/assets/cockpit/plate.webp" alt="" draggable={false} />

        <div className="window" aria-label="Main view">
          <div className="window__space" aria-hidden="true" />
          {globeMounted && live && (
            <div className={`window__globe ${showViews ? "is-out" : ""}`}>
              {/* the globe fills the painted porthole; after the dive the place slides into the visible glass */}
              <Globe target={target} onArrive={(t) => setArrivedKey(t.key)} focus={[-0.4, -0.13]} />
            </div>
          )}
          <div ref={viewRef} className={`window__view ${live ? "is-live" : ""} ${flying ? "is-flying" : ""}`}>
            <div className={`window__views ${showViews ? "is-in" : ""} window__views--${shape}`}>
              <div className="tab-pane" hidden={tab !== "map"}><MapTab /></div>
              {showViews && tab === "terrain" && <div className="tab-pane"><TerrainTab key={workspace?.id ?? "none"} /></div>}
              {tab === "tables" && <div className="tab-pane tab-pane--scroll"><TablesTab /></div>}
              {tab === "models" && <div className="tab-pane tab-pane--scroll"><ModelsTab /></div>}
            </div>

            {!showViews && (
              <div className="window__hud">
                {located && armed ? (
                  <>
                    <span className="hud__state">{flying ? "Locating" : "Data received"}</span>
                    <strong className="hud__label">{located.label}</strong>
                    <span className="hud__coord">{formatLonLat(located.lon, located.lat)}</span>
                    <span className="hud__credit">Globe: NASA Blue Marble · close-up imagery © Esri, Maxar, Earthstar Geographics</span>
                  </>
                ) : (
                  <>
                    <span className="hud__state">Standing by</span>
                    <strong className="hud__label">Choose a place or bring data</strong>
                    <span className="hud__coord">Index · pillars · GeoTIFF, GeoJSON or CSV with coordinates</span>
                  </>
                )}
              </div>
            )}
            {expanded && (
              <nav className="dock" aria-label="Views">
                <button className="dock__back" onClick={leaveExpanded} title="Back to the cockpit (Esc)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg><span>Cockpit</span>
                </button>
                {DOCK.map((d) => (
                  <button key={d.id} className={tab === d.id ? "is-active" : ""} aria-pressed={tab === d.id} onClick={() => pick(d.id)}>{d.label}</button>
                ))}
              </nav>
            )}
            {showViews && !compact && (
              <button className="window__full" onClick={toggleFull} title={full ? "Exit full screen (Esc)" : "Full screen"}
                aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full}>
                <svg viewBox="0 0 24 24">{full
                  ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                  : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
              </button>
            )}
            {showViews && SPATIAL.includes(tab) && !expanded && (
              <button className="window__home" onClick={home} title="Back to the revolving globe" aria-label="Back to the globe">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 7v10M7 12h10" /></svg>
              </button>
            )}
            {error && <div className="banner banner--error window__error" role="alert">{error}</div>}
          </div>
        </div>

        <div className="scene__hero">
          <p className="deck__kicker">Earth observatory</p>
          <h1 className="deck__title">Reading the pulse <span>of a changing surface.</span></h1>
        </div>
        <Pillars onPick={pick} onHover={setHoverPillar} />
        <IndexPanel onChoose={choosePlace} caption={pillarCaption(hoverPillar)} />
      </div>

      <TopBar onHome={home} />

      {selected && (
        <div className="drawer" role="dialog" aria-label="Dataset inspector">
          <button className="drawer__close" onClick={() => select(null)} aria-label="Close inspector">×</button>
          <Inspector />
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <UIProvider>
        <Cockpit />
      </UIProvider>
    </StoreProvider>
  );
}
