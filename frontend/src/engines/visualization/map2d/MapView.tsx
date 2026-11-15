/**
 * Interactive 2D map (MapLibre GL). Renders any visible dataset that can be
 * placed in lon/lat: rasters (as images), GeoJSON vectors, and table points.
 */
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Dataset } from "../../data/types";
import type { LegendSpec } from "../../data/terrainTypes";
import { CATEGORICAL } from "../charts/palette";
import { ProvenanceBadge } from "../common/ProvenanceBadge";
import { LegendSwatch } from "../terrain3d/Legend";
import { sourceKey } from "../../analysis/raster";
import { renderDataset, rgbaToDataUrl } from "../rasterColor";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
/** Global basemaps (no API key). Imagery date varies by place: context only, never event evidence. */
export const BASEMAPS: Record<"satellite" | "streets" | "topo" | "none", { label: string; style: StyleSpecification }> = {
  satellite: {
    label: "Satellite (high-res)",
    style: {
      version: 8,
      sources: {
        img: { type: "raster", tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19,
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community" },
        ref: { type: "raster", tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
      },
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#05070d" } },
        { id: "img", type: "raster", source: "img" }, { id: "ref", type: "raster", source: "ref", paint: { "raster-opacity": 0.9 } }],
    },
  },
  streets: {
    label: "Streets (OpenStreetMap)",
    style: {
      version: 8,
      sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19,
        attribution: "© OpenStreetMap contributors" } },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
  },
  topo: {
    label: "Topographic",
    style: {
      version: 8,
      sources: { topo: { type: "raster", tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 17,
        attribution: "© OpenStreetMap contributors, SRTM · style © OpenTopoMap (CC-BY-SA)" } },
      layers: [{ id: "topo", type: "raster", source: "topo" }],
    },
  },
  none: { label: "None", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#05070d" } }] } },
};
type BasemapId = keyof typeof BASEMAPS;

const rasterCache = new Map<string, Promise<{ url: string; legend: LegendSpec }>>();
function rasterImage(ds: Dataset) {
  const key = `${sourceKey(ds)}:${ds.kind}:${ds.raster?.sarScale ?? ""}:${JSON.stringify(ds.display ?? {})}`;
  let p = rasterCache.get(key);
  if (!p) {
    p = renderDataset(ds, 1024).then((r) => ({ url: rgbaToDataUrl(r.rgba, r.cols, r.rows), legend: r.legend }));
    rasterCache.set(key, p);
  }
  return p;
}

function tablePoints(ds: Dataset) {
  const sheet = ds.table?.sheets.find((s) => s.coordinates && s.coordinates.valid_rows > 0);
  if (!sheet?.coordinates) return null;
  const { lat, lon } = sheet.coordinates;
  const colorBy = sheet.suggestions.target_candidates[0];
  const values = colorBy ? [...new Set(sheet.records.map((r) => String(r[colorBy])))].slice(0, 2) : [];
  const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: sheet.records
    .filter((r) => Number.isFinite(Number(r[lat])) && Number.isFinite(Number(r[lon])))
    .map((r) => ({ type: "Feature", properties: { ...r, __cls: colorBy ? String(r[colorBy]) : "" },
      geometry: { type: "Point", coordinates: [Number(r[lon]), Number(r[lat])] } })) };
  return { fc, colorBy, values };
}

export interface MapFocus { bbox: [number, number, number, number]; key: number }

interface Props {
  datasets: Dataset[];
  center?: [number, number];
  zoom?: number;
  focus?: MapFocus | null;
  onSelect?: (id: string) => void;
}

interface LegendRow { id: string; name: string; legend: LegendSpec; provenance: Dataset["provenance"]; extra?: string }

export function MapView({ datasets, center, zoom, focus, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const managed = useRef<{ layers: string[]; sources: string[] }>({ layers: [], sources: [] });
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [legend, setLegend] = useState<LegendRow[]>([]);
  const [warn, setWarn] = useState<string[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: BASEMAPS.satellite.style, center: center ?? [0, 20], zoom: zoom ?? 1.5,
      attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => setReady(true));
    map.current = m;
    // the porthole morphs and tabs hide/show the map, so follow the container size, not just the window
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (ready && center) map.current?.jumpTo({ center, zoom: zoom ?? 11 }); }, [ready, center, zoom]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setStyle(BASEMAPS[basemap].style);
    managed.current = { layers: [], sources: [] };
    m.once("styledata", () => setReady((r) => r)); // layers are re-added by the sync effect below
  }, [basemap, ready]);

  // sync dataset layers
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let cancelled = false;
    (async () => {
      const rows: LegendRow[] = [];
      const warnings: string[] = [];
      const rasters = datasets.filter((d) => d.raster || d.grid);
      const images = await Promise.all(rasters.map(async (d) => {
        if (!d.raster?.lonLatCorners) { warnings.push(`${d.name}: cannot be placed on the map (${d.raster?.crs.label ?? "unknown CRS"}).`); return null; }
        try { return { d, img: await rasterImage(d) }; } catch (e) { warnings.push(`${d.name}: ${(e as Error).message}`); return null; }
      }));
      if (cancelled || !map.current) return;
      if (!m.isStyleLoaded()) await new Promise((r) => m.once("idle", r));
      for (const id of managed.current.layers) if (m.getLayer(id)) m.removeLayer(id);
      for (const id of managed.current.sources) if (m.getSource(id)) m.removeSource(id);
      const layers: string[] = [], sources: string[] = [];

      for (const it of images) {
        if (!it) continue;
        const sid = `tp-src-${it.d.id}`;
        m.addSource(sid, { type: "image", url: it.img.url, coordinates: it.d.raster!.lonLatCorners! });
        m.addLayer({ id: `tp-r-${it.d.id}`, type: "raster", source: sid, paint: { "raster-opacity": it.d.kind === "dem" ? 0.85 : 0.9, "raster-fade-duration": 0 } });
        sources.push(sid); layers.push(`tp-r-${it.d.id}`);
        rows.push({ id: it.d.id, name: it.d.name, legend: it.img.legend, provenance: it.d.provenance });
      }
      for (const d of datasets.filter((x) => x.vector)) {
        const sid = `tp-src-${d.id}`, color = "#e2c27a";
        m.addSource(sid, { type: "geojson", data: d.vector!.geojson });
        m.addLayer({ id: `tp-vf-${d.id}`, type: "fill", source: sid, filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": color, "fill-opacity": 0.25 } });
        m.addLayer({ id: `tp-vl-${d.id}`, type: "line", source: sid, filter: ["in", ["geometry-type"], ["literal", ["Polygon", "LineString"]]],
          paint: { "line-color": color, "line-width": 1.6 } });
        m.addLayer({ id: `tp-vp-${d.id}`, type: "circle", source: sid, filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-color": color, "circle-radius": 5, "circle-stroke-color": "#171a1e", "circle-stroke-width": 2 } });
        sources.push(sid); layers.push(`tp-vf-${d.id}`, `tp-vl-${d.id}`, `tp-vp-${d.id}`);
        rows.push({ id: d.id, name: d.name, legend: { type: "swatch", color }, provenance: d.provenance });
      }
      for (const d of datasets.filter((x) => x.table)) {
        const pts = tablePoints(d);
        if (!pts) continue;
        const sid = `tp-src-${d.id}`;
        m.addSource(sid, { type: "geojson", data: pts.fc });
        const color: maplibregl.ExpressionSpecification | string = pts.values.length === 2
          ? ["match", ["get", "__cls"], pts.values[0], CATEGORICAL[0], pts.values[1], CATEGORICAL[1], "#9aa4ad"] : CATEGORICAL[2];
        m.addLayer({ id: `tp-tp-${d.id}`, type: "circle", source: sid,
          paint: { "circle-color": color, "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 13, 6],
            "circle-stroke-color": "#171a1e", "circle-stroke-width": 1 } });
        sources.push(sid); layers.push(`tp-tp-${d.id}`);
        if (pts.values.length === 2) {
          pts.values.forEach((v, k) => rows.push({ id: `${d.id}-${k}`, name: `${d.name}: ${pts.colorBy} = ${v}`,
            legend: { type: "swatch", color: CATEGORICAL[k] }, provenance: d.provenance }));
        } else rows.push({ id: d.id, name: d.name, legend: { type: "swatch", color: CATEGORICAL[2] }, provenance: d.provenance });
      }
      managed.current = { layers, sources };
      setLegend(rows);
      setWarn(warnings);
    })();
    return () => { cancelled = true; };
  }, [datasets, ready, basemap]);

  // click → popup / select
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      const feats = m.queryRenderedFeatures(e.point).filter((f) => f.layer.id.startsWith("tp-v") || f.layer.id.startsWith("tp-tp"));
      if (!feats.length) return;
      const f = feats[0];
      const dsId = f.layer.id.replace(/^tp-(vf|vl|vp|tp)-/, "");
      onSelectRef.current?.(dsId);
      const props = Object.entries(f.properties ?? {}).filter(([k]) => k !== "__cls").slice(0, 12);
      const html = `<table class="popup-table">${props.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join("")}</table>`;
      new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(html).addTo(m);
    };
    m.on("click", handler);
    return () => { m.off("click", handler); };
  }, [ready]);

  useEffect(() => {
    if (ready && focus) map.current?.fitBounds([[focus.bbox[0], focus.bbox[1]], [focus.bbox[2], focus.bbox[3]]], { padding: 40, maxZoom: 15, duration: 600 });
  }, [focus, ready]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div className="map__controls">
        <label>Basemap{" "}
          <select value={basemap} onChange={(e) => setBasemap(e.target.value as BasemapId)}>
            {(Object.keys(BASEMAPS) as BasemapId[]).map((k) => <option key={k} value={k}>{BASEMAPS[k].label}</option>)}
          </select>
        </label>
      </div>
      {(legend.length > 0 || warn.length > 0) && (
        <aside className="legend map__legend" aria-label="Map legend">
          <div className="legend__title">Layers</div>
          <ul className="legend__layers">
            {legend.map((r) => (
              <li key={r.id}>
                <LegendSwatch legend={r.legend} />
                <span>{r.name}{r.legend.type === "gradient" && <small> {r.legend.min} … {r.legend.max}</small>}</span>
                <ProvenanceBadge kind={r.provenance} />
              </li>
            ))}
          </ul>
          {warn.map((w) => <p key={w} className="map__warn">{w}</p>)}
        </aside>
      )}
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
