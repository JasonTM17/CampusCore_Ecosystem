"""Regression: script imports must not replace or close sys.stdout."""

import io
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
COMMON_SCRIPTS = Path(__file__).resolve().parents[3] / "ak-common" / "scripts"


def test_reconfigures_non_utf8_stream_in_place():
    sys.path.insert(0, str(COMMON_SCRIPTS))
    import win_compat

    stream = io.TextIOWrapper(io.BytesIO(), encoding="cp1252")
    with patch.object(sys, "platform", "win32"), patch.object(sys, "stdout", stream):
        win_compat.ensure_utf8_stdout()
        assert sys.stdout is stream
    assert stream.encoding.lower().replace("-", "") == "utf8"


def test_two_script_imports_keep_stdout_usable():
    code = (
        "import sys; sys.path.insert(0, {scripts!r}); "
        "before = sys.stdout; import db_migrate, db_performance_check; "
        "import gc; gc.collect(); assert sys.stdout is before; print('ok \u2713')"
    ).format(scripts=str(SCRIPTS))
    result = subprocess.run(
        [sys.executable, "-B", "-c", code], capture_output=True, cwd=str(SCRIPTS)
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    assert result.stdout.decode("utf-8").strip() == "ok \u2713"
