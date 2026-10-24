import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from geodata.routing import compile_graph


def road(key, coords, ids, **properties):
    return {
        "id": key,
        "featureType": "road",
        "status": "active",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "class": "residential",
            "connectors": [
                {"connector_id": ids[0], "at": 0},
                {"connector_id": ids[1], "at": 1},
            ],
            **properties,
        },
    }


class RoutingCompiler(unittest.TestCase):
    def test_explicit_connectivity_and_oneway(self):
        a = road(
            "a",
            [[79.9, 6.9], [79.91, 6.9]],
            ["one", "two"],
            access_restrictions=[
                {"access_type": "denied", "when": {"heading": "backward"}}
            ],
        )
        b = road("b", [[79.91, 6.9], [79.92, 6.9]], ["two", "three"])
        g = compile_graph([a, b])
        self.assertEqual(len(g["nodes"]), 3)
        self.assertEqual(len(g["edges"]), 3)

    def test_visual_crossings_do_not_create_nodes(self):
        a = road("a", [[79.9, 6.9], [79.92, 6.92]], ["one", "two"])
        b = road("b", [[79.92, 6.9], [79.9, 6.92]], ["three", "four"])
        g = compile_graph([a, b])
        self.assertEqual(len(g["nodes"]), 4)

    def test_unsupported_restrictions_are_explicitly_excluded(self):
        a = road(
            "a",
            [[79.9, 6.9], [79.91, 6.9]],
            ["one", "two"],
            prohibited_transitions=[{"sequence": []}],
        )
        g = compile_graph([a])
        self.assertEqual(len(g["edges"]), 0)
        self.assertEqual(len(g["excluded"]), 1)
