#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAYERS_ROOT="$REPO_ROOT/aws/lambda_layers"

for layer_dir in "$LAYERS_ROOT"/*; do
  [ -d "$layer_dir" ] || continue
  layer_name="$(basename "$layer_dir")"
  build_dir="$layer_dir/build"
  py_dir="$build_dir/python"
  zip_base="${layer_name//_/-}"
  zip_path="$build_dir/${zip_base}-layer.zip"

  echo "Building layer: $layer_name"

  rm -rf "$build_dir"
  mkdir -p "$py_dir"

  if [[ -f "$layer_dir/requirements.txt" ]]; then
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
  elif [[ -d "$layer_dir/python" ]]; then
    cp -R "$layer_dir/python/." "$py_dir/"
  else
    echo "Skipping layer without requirements.txt or python/: $layer_name"
    continue
  fi
  (cd "$build_dir" && zip -r "${zip_base}-layer.zip" python >/dev/null)

  echo "  -> $zip_path"
done

echo "Done."
