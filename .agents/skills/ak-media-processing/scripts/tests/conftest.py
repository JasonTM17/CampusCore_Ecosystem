"""Run every media-processing test from a temporary working directory.

Several tests pass relative output paths that the resizer creates on disk;
isolating the working directory keeps those folders out of the checkout.
"""

import pytest


@pytest.fixture(autouse=True)
def isolated_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    yield tmp_path
