-- The DynamoDB tables and S3 buckets of the AWS deployment, as PostgreSQL tables.

CREATE TABLE users (
    netid            text PRIMARY KEY,
    full_name        text,
    uconn_email      text,
    discord_username text,
    linkedin_url     text,
    github_url       text,
    roles            text[] NOT NULL DEFAULT '{}',
    is_banned        boolean NOT NULL DEFAULT false,
    notes            text,
    joined_at        timestamptz,
    created_at       timestamptz,
    updated_at       timestamptz
);

CREATE TABLE user_access_applications (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    netid            text NOT NULL,
    created_at       timestamptz NOT NULL,
    full_name        text NOT NULL,
    uconn_email      text NOT NULL,
    discord_username text,
    linkedin_url     text,
    github_url       text,
    status           text NOT NULL,
    decided_at       timestamptz,
    decided_by       text,
    decision_notes   text
);

CREATE INDEX user_access_applications_latest_idx
    ON user_access_applications (netid, created_at DESC);

CREATE TABLE strategies (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    description     text,
    owner           text,
    owner_display   text,
    entrypoint      text NOT NULL DEFAULT 'main.py',
    current_version integer NOT NULL DEFAULT 0,
    tags            text[],
    metrics         jsonb,
    created_at      timestamptz,
    updated_at      timestamptz
);

-- Strategy ids are decimal strings ("1", "2", ...) drawn from this sequence.
CREATE SEQUENCE strategy_id_seq;

-- latest_version is the strategy version that last changed the file.
CREATE TABLE strategy_artifacts (
    strategy_id    text NOT NULL REFERENCES strategies (id) ON DELETE CASCADE,
    artifact_id    text NOT NULL,
    latest_version integer NOT NULL,
    PRIMARY KEY (strategy_id, artifact_id)
);

-- Every saved version of every file. Versions are never modified.
CREATE TABLE strategy_artifact_versions (
    strategy_id text NOT NULL,
    artifact_id text NOT NULL,
    version     integer NOT NULL,
    content     bytea NOT NULL,
    created_at  timestamptz NOT NULL,
    PRIMARY KEY (strategy_id, artifact_id, version),
    FOREIGN KEY (strategy_id, artifact_id)
        REFERENCES strategy_artifacts (strategy_id, artifact_id) ON DELETE CASCADE
);

-- Principals are 'USER#<netid>' or 'ROLE#<role>'. Write access implies read access.
CREATE TABLE strategy_permissions (
    strategy_id text NOT NULL REFERENCES strategies (id) ON DELETE CASCADE,
    access      text NOT NULL CHECK (access IN ('read', 'write')),
    principal   text NOT NULL,
    PRIMARY KEY (strategy_id, access, principal)
);

CREATE INDEX strategy_permissions_principal_idx ON strategy_permissions (principal);

CREATE TABLE backtest_runs (
    strategy_id      text NOT NULL REFERENCES strategies (id) ON DELETE CASCADE,
    -- ULIDs: byte order is creation order.
    run_id           text COLLATE "C" NOT NULL,
    name             text,
    time_created     timestamptz NOT NULL,
    created_by       text,
    -- Stored exactly as the client sent it (normally the integer strategy version).
    strategy_version jsonb,
    backtest_params  jsonb NOT NULL,
    metrics          jsonb,
    net_pnl          double precision,
    sharpe           double precision,
    win_rate         double precision,
    max_drawdown     double precision,
    trades_count     double precision,
    PRIMARY KEY (strategy_id, run_id)
);

-- Gzipped backtest results that browsers upload and download through short-lived
-- signed URLs. Keys keep the S3 layout: strategies/<id>/runs/<run_id>/run.json.gz
CREATE TABLE backtest_payloads (
    key         text PRIMARY KEY,
    content     bytea NOT NULL,
    uploaded_at timestamptz NOT NULL
);

-- Engine account control. The 'state' record holds the account document and its
-- optimistic-concurrency generation; every other record is written once.
CREATE TABLE engine_account_records (
    account_id text NOT NULL,
    record     text NOT NULL,
    -- JSON text rather than jsonb, so documents round-trip unchanged.
    body       text NOT NULL,
    generation bigint,
    PRIMARY KEY (account_id, record)
);

-- RS256 keys for session cookies and signed storage URLs. The newest key signs;
-- all retained keys are published at /.well-known/jwks.json.
CREATE TABLE jwt_signing_keys (
    kid         text PRIMARY KEY,
    private_key text NOT NULL,
    public_jwk  jsonb NOT NULL,
    created_at  timestamptz NOT NULL
);
