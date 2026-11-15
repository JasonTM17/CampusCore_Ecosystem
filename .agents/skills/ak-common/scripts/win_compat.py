"""UTF-8 console output for AgentKit Python skill scripts on Windows.

The stream is reconfigured in place, never replaced, so a second import, a test
runner's capture or a caller's redirect keeps its buffer open.
"""

from __future__ import annotations

import sys


def ensure_utf8_stdout() -> None:
    """Switch stdout to UTF-8 on Windows when it uses another encoding."""
    if sys.platform != "win32":
        return
    stream = sys.stdout
    encoding = (getattr(stream, "encoding", None) or "").lower().replace("-", "")
    reconfigure = getattr(stream, "reconfigure", None)
    if encoding != "utf8" and callable(reconfigure):
        try:
            reconfigure(encoding="utf-8")
        except (OSError, ValueError):
            pass
