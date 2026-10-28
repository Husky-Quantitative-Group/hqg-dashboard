import pytest
from validation import validate_package


def test_package_validation_never_executes_source_and_digest_ignores_key_order():
    source = 'raise RuntimeError("must not execute")\nclass Example(Strategy):\n    universe = ["AAPL"]\n'
    package = dict(
        strategy_id="example",
        version=1,
        entrypoint="main.py",
        files={"main.py": source},
    )
    identity, metadata = validate_package(package)
    assert metadata == {"class_name": "Example", "universe": ["AAPL"]}
    assert identity == validate_package(dict(reversed(list(package.items()))))[0]
    assert identity != validate_package({**package, "version": 2})[0]


@pytest.mark.parametrize(
    "files",
    [{"../escape.py": ""}, {"main.py": "x" * 128001}, {"main.py": "invalid syntax!"}],
)
def test_validator_rejects_invalid_packages(files):
    with pytest.raises((ValueError, SyntaxError)):
        validate_package(
            dict(strategy_id="example", version=1, entrypoint="main.py", files=files)
        )
