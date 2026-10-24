"""Conservative car graph from explicit Mazo road connectivity, never visual crossings."""

import uuid
from shapely.geometry import LineString
from .canonical import NAMESPACE
from .core import encoded


def node_id(source_id):
    return str(
        uuid.uuid5(NAMESPACE, encoded(["overture", "connector", source_id]).decode())
    )


def compile_graph(records):
    nodes = {}
    edges = []
    excluded = []
    classes = {
        "motorway": 90,
        "trunk": 70,
        "primary": 50,
        "secondary": 40,
        "tertiary": 35,
        "residential": 25,
        "service": 15,
        "unclassified": 25,
        "living_street": 10,
    }
    for r in records:
        if r["featureType"] != "road" or r["status"] != "active":
            continue
        p = r["properties"]
        g = r["geometry"]
        routing = p.get("routing") or {}
        if (
            g["type"] != "LineString"
            or p.get("subtype", "road") != "road"
            or p.get("class", "unclassified") not in classes
        ):
            excluded.append(
                {"id": r["id"], "reason": "unsupported geometry or car road class"}
            )
            continue
        # Complex temporal/vehicle rules and turn sequences require a stateful router.
        if (
            p.get("prohibited_transitions")
            or routing.get("access") in ("no", "unknown")
            or any(
                flag in ("is_under_construction", "is_private")
                for rule in p.get("road_flags") or []
                for flag in rule.get("values", [])
            )
        ):
            excluded.append(
                {
                    "id": r["id"],
                    "reason": "turn restriction, access denial or construction",
                }
            )
            continue
        refs = p.get("connectors") or []
        if routing.get("connectors"):
            refs = (
                [
                    {"connector_id": key, "at": i / (len(routing["connectors"]) - 1)}
                    for i, key in enumerate(routing["connectors"])
                ]
                if len(routing["connectors"]) == 2
                else []
            )
        if len(refs) < 2:
            excluded.append(
                {"id": r["id"], "reason": "missing explicit endpoint connectivity"}
            )
            continue
        flags = {"forward": True, "backward": True}
        unsupported = False
        for rule in p.get("access_restrictions") or []:
            when = rule.get("when") or {}
            if rule.get("between") or any(
                when.get(k) for k in ["during", "using", "recognized", "vehicle"]
            ):
                unsupported = True
                break
            modes = when.get("mode")
            if modes and not set(modes) & {"motor_vehicle", "motorcar", "vehicle"}:
                continue
            headings = (
                [when["heading"]] if when.get("heading") else ["forward", "backward"]
            )
            for heading in headings:
                flags[heading] = rule["access_type"] == "allowed"
        if unsupported:
            excluded.append(
                {"id": r["id"], "reason": "scoped access restriction not implemented"}
            )
            continue
        if routing.get("oneway") in (True, "yes"):
            flags["backward"] = False
        if routing.get("oneway") == "-1":
            flags["forward"] = False
        speed = float(
            routing.get("speedKph") or classes[p.get("class", "unclassified")]
        )
        if not 1 <= speed <= 130:
            raise ValueError("invalid routing speed")
        line = LineString(g["coordinates"])
        refs = sorted(refs, key=lambda c: c["at"])
        if refs[0]["at"] != 0 or refs[-1]["at"] != 1:
            excluded.append({"id": r["id"], "reason": "missing endpoint connectors"})
            continue
        for ref in refs:
            if not 0 <= ref["at"] <= 1:
                raise ValueError("invalid connector linear reference")
            key = (
                ref["connector_id"]
                if routing.get("connectors") or ref.get("namespace") == "mazo"
                else node_id(ref["connector_id"])
            )
            point = list(line.interpolate(ref["at"], normalized=True).coords[0])
            if (
                key in nodes
                and max(abs(a - b) for a, b in zip(nodes[key], point)) > 0.00005
            ):
                raise ValueError("connected road coordinates disagree: " + key)
            nodes[key] = point
        # Keep original vertices between explicit connector positions for route geometry.
        from shapely.ops import substring

        for a, b in zip(refs, refs[1:]):
            ak = (
                a["connector_id"]
                if routing.get("connectors") or a.get("namespace") == "mazo"
                else node_id(a["connector_id"])
            )
            bk = (
                b["connector_id"]
                if routing.get("connectors") or b.get("namespace") == "mazo"
                else node_id(b["connector_id"])
            )
            coords = [
                list(c)
                for c in substring(line, a["at"], b["at"], normalized=True).coords
            ]
            if ak == bk or len(coords) < 2:
                continue
            edge = {
                "road": r["id"],
                "from": ak,
                "to": bk,
                "geometry": coords,
                "speedKph": speed,
            }
            if flags["forward"]:
                edges.append(edge)
            if flags["backward"]:
                edges.append(
                    edge | {"from": bk, "to": ak, "geometry": list(reversed(coords))}
                )
    return {
        "schemaVersion": 1,
        "mode": "car",
        "coverage": "incomplete source sample; not district-wide or navigation-grade",
        "nodes": nodes,
        "edges": edges,
        "excluded": excluded,
        "timeModel": "class-based estimated speed, not measured traffic",
    }
