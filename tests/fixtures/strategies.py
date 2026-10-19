"""Test-only strategy/artifact fixtures for offline integration tests."""

import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from src.control.packages import validate_files

TEMPLATE = """from hqg_algorithms import Strategy, TargetWeights


class Balanced(Strategy):
    universe = ["AAPL", "MSFT"]

    def on_data(self, data, portfolio):
        return TargetWeights({"AAPL": 0.4, "MSFT": 0.4})
"""


class Strategies:
    def __init__(self, path):
        self.path = path
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS strategies (id TEXT PRIMARY KEY, body TEXT)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS strategy_versions (id TEXT, version INTEGER, body TEXT, PRIMARY KEY(id, version))"
            )
            if not db.execute("SELECT 1 FROM strategies WHERE id='1'").fetchone():
                self._save(
                    db,
                    {
                        "id": "1",
                        "name": "Balanced template",
                        "owner": "operator",
                        "entrypoint": "main.py",
                        "current_version": 1,
                        "project_id": "local",
                        "project_name": "Local strategies",
                        "tags": [],
                        "description": "Editable template for Alpaca execution",
                    },
                    {"main.py": TEMPLATE, "README.md": "# Balanced template"},
                )

    def _save(self, db, metadata, files):
        metadata["updated_at"] = datetime.now(timezone.utc).isoformat()
        db.execute(
            "INSERT OR REPLACE INTO strategies VALUES (?, ?)",
            (metadata["id"], json.dumps(metadata)),
        )
        db.execute(
            "INSERT INTO strategy_versions VALUES (?, ?, ?)",
            (
                metadata["id"],
                metadata["current_version"],
                json.dumps(
                    {
                        "strategy_id": metadata["id"],
                        "version": metadata["current_version"],
                        "entrypoint": metadata["entrypoint"],
                        "files": files,
                    }
                ),
            ),
        )

    def list(self):
        with sqlite3.connect(self.path) as db:
            return [
                json.loads(row[0])
                for row in db.execute("SELECT body FROM strategies ORDER BY id")
            ]

    def get(self, strategy_id):
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT body FROM strategies WHERE id=?", (strategy_id,)
            ).fetchone()
        if not row:
            raise HTTPException(404, "Strategy not found")
        return json.loads(row[0])

    def package(self, strategy_id, version):
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT body FROM strategy_versions WHERE id=? AND version=?",
                (strategy_id, version),
            ).fetchone()
        if not row:
            raise ValueError("Saved strategy version not found")
        return json.loads(row[0])

    def can_write(self, metadata, actor):
        return actor in (metadata["owner"], "operator")

    def create(self, body, actor):
        source = self.get(str(body["source_strategy_id"]))
        name = body["name"].strip()
        if not name or len(name) > 60:
            raise ValueError("Strategy name must contain 1–60 characters")
        files = self.package(source["id"], source["current_version"])["files"]
        files["README.md"] = body.get("readme_content", "")
        validate_files(files)
        metadata = {
            **source,
            "id": str(uuid4()),
            "name": name,
            "owner": actor,
            "description": body.get("description", ""),
            "tags": body.get("tags", []),
            "current_version": 1,
        }
        with sqlite3.connect(self.path) as db:
            self._save(db, metadata, files)
        return metadata

    def upload(self, strategy_id, body, actor):
        with sqlite3.connect(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            metadata = json.loads(
                db.execute(
                    "SELECT body FROM strategies WHERE id=?", (strategy_id,)
                ).fetchone()[0]
            )
            if not self.can_write(metadata, actor):
                raise HTTPException(403, "Strategy write permission required")
            files = self.package(strategy_id, metadata["current_version"])["files"]
            incoming = body["files"]
            if not isinstance(incoming, list) or not incoming:
                raise ValueError("files must be a non-empty list")
            for item in incoming:
                files[item["artifactId"]] = item["content"]
            validate_files(files)
            metadata["current_version"] += 1
            self._save(db, metadata, files)
        return {
            "ok": True,
            "version": metadata["current_version"],
            "artifacts": list(files),
        }
