"""Tests for generate-from-template.py partial style overrides regression."""

import importlib
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

gft = importlib.import_module("generate-from-template")


def test_partial_arrow_colors_override_preserves_other_flow_defaults():
    data = {
        "template_type": "architecture",
        "style": 1,
        "nodes": [
            {"id": "n1", "kind": "rect", "x": 100, "y": 100, "width": 120, "height": 60, "label": "A"},
            {"id": "n2", "kind": "rect", "x": 300, "y": 100, "width": 120, "height": 60, "label": "B"},
        ],
        "arrows": [
            {"source": "n1", "target": "n2", "flow": "control", "label": "control-flow"},
            {"source": "n1", "target": "n2", "flow": "data", "label": "data-flow"},
            {"source": "n1", "target": "n2", "flow": "read", "label": "read-flow"},
        ],
        "style_overrides": {
            "arrow_colors": {
                "control": "#ff0099",
            }
        },
    }

    svg = gft.build_svg("architecture", data)
    assert svg is not None
    assert "<svg" in svg
    assert "</svg>" in svg
    assert "#ff0099" in svg

    # Default data arrow color for style 1 is #f97316
    assert "#f97316" in svg
    # Default read arrow color for style 1 is #2563eb
    assert "#2563eb" in svg

    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")


def test_repro_fuzz_fixture_with_partial_override():
    data = {
        "template_type": "architecture",
        "style": 1,
        "nodes": [
            {"id": "n1", "kind": "terminal", "x": 60, "y": 160, "width": 220, "height": 90, "label": "Ingest"},
            {"id": "n2", "kind": "document", "x": 340, "y": 150, "width": 200, "height": 90, "label": "Store"},
            {"id": "n3", "kind": "bot", "x": 620, "y": 150, "width": 160, "height": 100, "label": "Agent"},
        ],
        "arrows": [
            {"source": "n1", "target": "n2", "flow": "data", "label": "send"},
            {"source": "n2", "target": "n3", "flow": "read", "label": "load"},
            {"source": "n3", "target": "n1", "flow": "control", "label": "call"},
        ],
        "style_overrides": {
            "arrow_colors": {
                "control": "url(https://example.invalid/a1.png)",
            }
        },
    }
    svg = gft.build_svg("architecture", data)
    assert "url(https://example.invalid/a1.png)" in svg
    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")


def test_malformed_style_overrides_raises_clear_error():
    for invalid in ["oops", 42, ["#f00"], True]:
        data = {
            "template_type": "architecture",
            "style": 1,
            "style_overrides": invalid,
        }
        with pytest.raises(ValueError, match=r"^style_overrides must be a JSON object$"):
            gft.build_svg("architecture", data)


def test_malformed_arrow_colors_override_raises_clear_error():
    for invalid in ["red", ["#f00"], 42]:
        data = {
            "template_type": "architecture",
            "style": 1,
            "style_overrides": {
                "arrow_colors": invalid,
            },
        }
        with pytest.raises(
            ValueError,
            match=r'^style_overrides\.arrow_colors must be a JSON object mapping names to values, for example \{"control": "#2563eb"\}',
        ):
            gft.build_svg("architecture", data)


def test_cli_malformed_style_overrides_reports_clear_error(tmp_path):
    import json
    import subprocess

    script_path = SCRIPTS_DIR / "generate-from-template.py"
    out_file = tmp_path / "out.svg"

    cases = [
        ("oops", "Error: style_overrides must be a JSON object"),
        ({"arrow_colors": "red"}, 'Error: style_overrides.arrow_colors must be a JSON object mapping names to values, for example {"control": "#2563eb"}'),
        ({"arrow_colors": ["#f00"]}, 'Error: style_overrides.arrow_colors must be a JSON object mapping names to values, for example {"control": "#2563eb"}'),
        ({"arrow_colors": 42}, 'Error: style_overrides.arrow_colors must be a JSON object mapping names to values, for example {"control": "#2563eb"}'),
    ]

    for style_overrides_val, expected_err in cases:
        data = {
            "template_type": "architecture",
            "style": 1,
            "style_overrides": style_overrides_val,
        }
        res = subprocess.run(
            [sys.executable, "-B", str(script_path), "architecture", str(out_file)],
            input=json.dumps(data),
            text=True,
            capture_output=True,
        )
        assert res.returncode == 1
        assert res.stdout.strip() == expected_err


def test_empty_style_overrides_stay_no_ops():
    base = {"template_type": "architecture", "style": 1}
    expected = gft.build_svg("architecture", dict(base))
    for empty in [None, False, 0, "", [], {}]:
        data = dict(base, style_overrides=empty)
        assert gft.build_svg("architecture", data) == expected, repr(empty)
