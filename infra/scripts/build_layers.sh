#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAYERS_ROOT="$REPO_ROOT/aws/lambda_layers"

for layer_dir in "$LAYERS_ROOT"/*; do
  [ -d "$layer_dir" ] || continue
  [ -f "$layer_dir/requirements.txt" ] || continue

  layer_name="$(basename "$layer_dir")"
  build_dir="$layer_dir/build"
  py_dir="$build_dir/python"
  zip_path="$build_dir/${layer_name}-layer.zip"

  echo "Building layer: $layer_name"

  rm -rf "$build_dir"
  mkdir -p "$py_dir"

  if [[ "$layer_name" == "cryptography" ]]; then
    python3 -m pip install \
      --platform manylinux2014_x86_64 \
      --implementation cp \
      --python-version 312 \
      --only-binary=:all: \
      -r "$layer_dir/requirements.txt" \
      -t "$py_dir"
  else
    python3 -m pip install -r "$layer_dir/requirements.txt" -t "$py_dir"
  fi
  (cd "$build_dir" && zip -r "${layer_name}-layer.zip" python >/dev/null)

  echo "  -> $zip_path"
done

echo "Done."
