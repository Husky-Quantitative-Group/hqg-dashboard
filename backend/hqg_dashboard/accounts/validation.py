"""Strategy package validation. Never executes uploaded code."""

# TODO: Move the engine/dashboard copies into hqg-algorithms in a later change.

import ast
import hashlib
import json
import re
from pathlib import PurePosixPath

MAX_PACKAGE_BYTES = 128_000
MAX_UNIVERSE_SIZE = 200


def digest(value):
    return "sha256:" + hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def validate_files(files):
    if not isinstance(files, dict) or not 1 <= len(files) <= 32:
        raise ValueError("A strategy package requires 1-32 files")
    for path, content in files.items():
        if (
            not isinstance(path, str)
            or not re.fullmatch(r"[A-Za-z0-9_./-]+", path)
            or PurePosixPath(path).is_absolute()
            or any(part in ("", ".", "..") for part in path.split("/"))
            or not isinstance(content, str)
        ):
            raise ValueError("Invalid strategy file path or content")
    if sum(len(content.encode()) for content in files.values()) > MAX_PACKAGE_BYTES:
        raise ValueError("Strategy package exceeds 128 KB")


def validate_package(package):
    if set(package) != {"strategy_id", "version", "entrypoint", "files"}:
        raise ValueError("Invalid strategy package")
    if (
        not isinstance(package["strategy_id"], str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", package["strategy_id"])
        or type(package["version"]) is not int
        or package["version"] < 1
    ):
        raise ValueError("Invalid strategy identity")
    files, entrypoint = package["files"], package["entrypoint"]
    validate_files(files)
    if (
        not isinstance(entrypoint, str)
        or entrypoint not in files
        or not entrypoint.endswith(".py")
    ):
        raise ValueError("A saved Python entrypoint is required")
    trees = {
        path: ast.parse(code) for path, code in files.items() if path.endswith(".py")
    }
    classes = [
        node
        for node in trees[entrypoint].body
        if isinstance(node, ast.ClassDef)
        and any(
            isinstance(base, ast.Name)
            and base.id == "Strategy"
            or isinstance(base, ast.Attribute)
            and base.attr == "Strategy"
            for base in node.bases
        )
    ]
    if len(classes) != 1:
        raise ValueError("Entrypoint must define exactly one Strategy subclass")
    universe = next(
        (
            ast.literal_eval(node.value)
            for node in classes[0].body
            if isinstance(node, (ast.Assign, ast.AnnAssign))
            and any(
                isinstance(target, ast.Name) and target.id == "universe"
                for target in (
                    node.targets if isinstance(node, ast.Assign) else [node.target]
                )
            )
        ),
        None,
    )
    if (
        not isinstance(universe, list)
        or not 1 <= len(universe) <= MAX_UNIVERSE_SIZE
        or any(
            not isinstance(symbol, str)
            or not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", symbol)
            for symbol in universe
        )
        or len(universe) != len(set(universe))
    ):
        raise ValueError(
            "Strategies require 1-200 unique uppercase stock ticker symbols"
        )
    return {
        "strategy_id": package["strategy_id"],
        "version": package["version"],
        "source_digest": digest(package),
    }, {
        "class_name": classes[0].name,
        "universe": universe,
    }
