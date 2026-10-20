"""Verify deployment imports outside both application source checkouts."""

import os
from pathlib import Path
import subprocess
import sys
import zipfile


def test_lambdas_import_from_extracted_archives_and_layers(tmp_path, aws):
    root = Path(__file__).resolve().parents[1]
    for name in ("accounts", "strategies", "strategy_artifacts"):
        archive = tmp_path / (name + "-lambda.zip")
        with zipfile.ZipFile(archive, "w") as bundle:
            for path in (root / "aws/lambdas" / name).glob("*.py"):
                bundle.write(path, path.name)
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(tmp_path / "task" / name)
    for name in ("hqg_permissions",):
        layer = (
            root
            / "aws/lambda_layers"
            / name
            / "build"
            / (name.replace("_", "-") + "-layer.zip")
        )
        assert (
            layer.exists()
        ), "Run infra/scripts/build_layers.sh before bundle validation"
        with zipfile.ZipFile(layer) as bundle:
            bundle.extractall(tmp_path / "opt")
    script = """
import importlib.util, sys, socket
from pathlib import Path
sys.path[:0] = [str(Path('task/accounts').resolve()), str(Path('opt/python').resolve())]
def denied(*args, **kwargs):
    raise AssertionError('Deployment imports may not access the network')
socket.socket.connect = denied
import main, admin, packages, validation, hqg_permissions
assert str(Path('task/accounts').resolve()) in validation.__file__
assert 'hqg_algorithms' not in sys.modules
assert str(Path('opt/python').resolve()) in hqg_permissions.__file__
assert isinstance(main.service().strategy_source, packages.StrategySource)
for name in ('strategies', 'strategy_artifacts'):
    spec = importlib.util.spec_from_file_location(name, Path('task') / name / 'main.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert callable(module.handler)
"""
    subprocess.run(
        [sys.executable, "-I", "-c", script],
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": ""},
        check=True,
        capture_output=True,
        text=True,
    )
