from visioncount.zones.zone_assigner import ZoneAssigner
from visioncount.zones.zone_model import ZoneRecord


def test_assign_inside():
    z = ZoneRecord(
        id=1,
        site_id="s",
        camera_id="c",
        name="A",
        zone_type="t",
        grid_version=1,
        polygon_norm=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
    )
    a = ZoneAssigner([z], 100, 100)
    assert a.assign(50.0, 50.0) == [1]
    assert a.assign(0.0, 0.0) == [1]


def test_assign_outside():
    z = ZoneRecord(
        id=2,
        site_id="s",
        camera_id="c",
        name="B",
        zone_type="t",
        grid_version=1,
        polygon_norm=[(0.0, 0.0), (0.2, 0.0), (0.2, 0.2), (0.0, 0.2)],
    )
    a = ZoneAssigner([z], 1000, 1000)
    assert a.assign(500.0, 500.0) == []
