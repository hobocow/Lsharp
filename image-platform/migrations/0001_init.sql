-- Users: Telegram ID is the account identifier.
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL UNIQUE,
  username      TEXT,
  first_name    TEXT,
  credits       INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  is_banned     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Browser sessions. Only a SHA-256 hash of the cookie value is stored.
CREATE TABLE sessions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  user_agent    TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- One-time login links sent by the bot. Single use, short lived, hashed.
CREATE TABLE login_tokens (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);
CREATE INDEX login_tokens_user_idx ON login_tokens(user_id);

-- Append-only credit ledger. `ref` is unique so the same event can never be applied twice.
CREATE TABLE credit_ledger (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  kind          TEXT NOT NULL,          -- purchase | spend | refund | grant | adjust
  ref           TEXT NOT NULL UNIQUE,   -- e.g. payment:12, gen:34, refund:gen:34
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger(user_id, id DESC);

-- Solana Pay payment requests.
CREATE TABLE payments (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  pack_id       TEXT NOT NULL,
  credits       INTEGER NOT NULL CHECK (credits > 0),
  usd_cents     INTEGER NOT NULL,
  token         TEXT NOT NULL,          -- SOL | USDC | USDT
  amount        NUMERIC(30, 9) NOT NULL,-- amount in token units (e.g. 5.000000 USDC)
  amount_base   NUMERIC(40, 0) NOT NULL,-- amount in base units (lamports / 1e-6)
  recipient     TEXT NOT NULL,
  reference     TEXT NOT NULL UNIQUE,   -- Solana Pay reference public key
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed
  signature     TEXT UNIQUE,            -- tx signature; unique => no double crediting
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  confirmed_at  TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ
);
CREATE INDEX payments_user_idx ON payments(user_id, id DESC);

-- Image generations.
CREATE TABLE generations (
  id            BIGSERIAL PRIMARY KEY,
  public_id     TEXT NOT NULL UNIQUE,   -- random, used in URLs
  user_id       BIGINT NOT NULL REFERENCES users(id),
  prompt        TEXT NOT NULL,
  input_key     TEXT NOT NULL,          -- storage key of the uploaded image
  output_key    TEXT,                   -- storage key of the result
  status        TEXT NOT NULL DEFAULT 'processing', -- processing | succeeded | failed
  error_code    TEXT,
  cost          INTEGER NOT NULL,
  provider_ref  TEXT,                   -- provider request id (server-side only)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX generations_user_idx ON generations(user_id, id DESC);
CREATE INDEX generations_processing_idx ON generations(status) WHERE status = 'processing';
