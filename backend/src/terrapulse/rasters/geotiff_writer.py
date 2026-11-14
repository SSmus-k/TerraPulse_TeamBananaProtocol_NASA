"""Minimal, dependency-free GeoTIFF writer (single band, float32, uncompressed).

Enough for exporting TerraPulse products (e.g. per-cell model probabilities)
and for generating test fixtures, without requiring GDAL/rasterio.
"""
from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

SHORT, LONG, ASCII, DOUBLE = 3, 4, 2, 12
_SIZE = {SHORT: 2, LONG: 4, ASCII: 1, DOUBLE: 8}
_FMT = {SHORT: "H", LONG: "I", DOUBLE: "d"}


def write_geotiff(path: str | Path, data: np.ndarray, *, origin: tuple[float, float], pixel_size: tuple[float, float],
                  epsg: int, nodata: float | None = None) -> Path:
    """Write `data` (rows north→south) with top-left corner `origin` (x, y) in CRS `epsg`.

    epsg 4326 (or other geographic codes 4000-4999) is written as a geographic CRS,
    anything else as projected.
    """
    arr = np.ascontiguousarray(np.asarray(data, dtype="<f4"))
    if arr.ndim != 2:
        raise ValueError("expected a 2-D array")
    h, w = arr.shape
    geographic = 4000 <= epsg < 5000
    keys = [1, 1, 0, 3,
            1024, 0, 1, 2 if geographic else 1,    # GTModelTypeGeoKey
            1025, 0, 1, 1,                          # GTRasterTypeGeoKey = PixelIsArea
            2048 if geographic else 3072, 0, 1, epsg]
    tags = [
        (256, LONG, [w]), (257, LONG, [h]), (258, SHORT, [32]), (259, SHORT, [1]), (262, SHORT, [1]),
        (273, LONG, [0]),  # strip offset patched below
        (277, SHORT, [1]), (278, LONG, [h]), (279, LONG, [arr.nbytes]), (284, SHORT, [1]), (339, SHORT, [3]),
        (33550, DOUBLE, [pixel_size[0], pixel_size[1], 0.0]),
        (33922, DOUBLE, [0.0, 0.0, 0.0, origin[0], origin[1], 0.0]),
        (34735, SHORT, keys),
    ]
    if nodata is not None:
        tags.append((42113, ASCII, (repr(float(nodata)) + "\0").encode("ascii")))
    tags.sort(key=lambda t: t[0])

    ifd_offset = 8
    ifd_size = 2 + 12 * len(tags) + 4
    extra_offset = ifd_offset + ifd_size
    extra = bytearray()
    entries = []
    for tag, typ, vals in tags:
        count = len(vals)
        payload = bytes(vals) if typ == ASCII else struct.pack("<" + _FMT[typ] * count, *vals)
        if len(payload) <= 4:
            entries.append([tag, typ, count, payload.ljust(4, b"\0"), None])
        else:
            if len(extra) % 2:
                extra += b"\0"
            entries.append([tag, typ, count, None, extra_offset + len(extra)])
            extra += payload
    data_offset = extra_offset + len(extra)
    data_offset += data_offset % 4 and 4 - data_offset % 4
    for e in entries:
        if e[0] == 273:
            e[3] = struct.pack("<I", data_offset)

    out = bytearray(b"II*\0" + struct.pack("<I", ifd_offset))
    out += struct.pack("<H", len(entries))
    for tag, typ, count, inline, off in entries:
        out += struct.pack("<HHI", tag, typ, count) + (inline if inline is not None else struct.pack("<I", off))
    out += struct.pack("<I", 0)
    out += extra
    out += b"\0" * (data_offset - len(out))
    out += arr.tobytes()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(out))
    return path
