import struct

import numpy as np

from terrapulse.rasters.fixtures import make_fixtures
from terrapulse.rasters.geotiff_writer import write_geotiff


def read_tags(path):
    b = path.read_bytes()
    assert b[:4] == b"II*\0"
    (ifd,) = struct.unpack_from("<I", b, 4)
    (n,) = struct.unpack_from("<H", b, ifd)
    tags = {}
    for i in range(n):
        tag, typ, count, val = struct.unpack_from("<HHII", b, ifd + 2 + 12 * i)
        tags[tag] = (typ, count, val)
    return b, tags


def test_roundtrip_values_and_geo(tmp_path):
    data = np.arange(12, dtype="f4").reshape(3, 4)
    p = write_geotiff(tmp_path / "a.tif", data, origin=(500000, 3000000), pixel_size=(10, 10), epsg=32645, nodata=-9999)
    b, tags = read_tags(p)
    assert tags[256][2] == 4 and tags[257][2] == 3
    assert tags[339][2] == 3  # float
    offset = tags[273][2]
    assert np.allclose(np.frombuffer(b, "<f4", 12, offset).reshape(3, 4), data)
    geokeys = struct.unpack_from("<" + "H" * tags[34735][1], b, tags[34735][2])
    assert 3072 in geokeys and 32645 in geokeys
    tie = struct.unpack_from("<6d", b, tags[33922][2])
    assert tie[3:5] == (500000.0, 3000000.0)
    assert b[tags[42113][2]:tags[42113][2] + 7] == b"-9999.0"


def test_fixtures(tmp_path):
    info = make_fixtures(tmp_path, size=64)
    assert (tmp_path / "synthetic_dem_utm45.tif").exists()
    assert info["planted_changes"]["fan_pixels_+6dB"] > 0
    assert "SYNTHETIC" in info["note"]
