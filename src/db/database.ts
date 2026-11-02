// SQLite via Node's built-in node:sqlite (no native install step). One writer at a time:
// every state change that guards money runs inside BEGIN IMMEDIATE, so concurrent requests serialize.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

// Append-only once deployed. Each entry runs once, tracked by PRAGMA user_version.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE mandates (
    id               TEXT PRIMARY KEY,
    data             TEXT NOT NULL,          -- Mandate JSON without walletTokenRef
    wallet_token_ref TEXT,                   -- Vault payment token id; never sent to the agent
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE approvals (
    id           TEXT PRIMARY KEY,
    mandate_id   TEXT NOT NULL REFERENCES mandates(id),
    offer_id     TEXT NOT NULL,
    merchant_id  TEXT NOT NULL,
    quantity     INTEGER NOT NULL CHECK (quantity >= 1),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    used_at      TEXT
  );

  CREATE TABLE purchases (
    id                 TEXT PRIMARY KEY,
    request_id         TEXT NOT NULL UNIQUE,  -- PayPal-Request-Id
    proposal_id        TEXT NOT NULL,
    mandate_id         TEXT NOT NULL REFERENCES mandates(id),
    offer_id           TEXT NOT NULL,
    merchant_id        TEXT NOT NULL,
    quantity           INTEGER NOT NULL,
    order_amount_minor INTEGER NOT NULL,
    order_currency     TEXT NOT NULL,
    landed_total_minor INTEGER NOT NULL,
    landed_currency    TEXT NOT NULL,
    approval_id        TEXT REFERENCES approvals(id),
    authorized_via     TEXT NOT NULL CHECK (authorized_via IN ('AUTO', 'APPROVAL')),
    status             TEXT NOT NULL CHECK (status IN ('RESERVED', 'SUBMITTED', 'PENDING', 'CAPTURED', 'FAILED')),
    paypal_order_id    TEXT,
    paypal_capture_id  TEXT,
    capture_status     TEXT,
    seller_breakdown   TEXT,                   -- seller_receivable_breakdown JSON (reconciliation)
    error_code         TEXT,
    policy             TEXT NOT NULL,          -- PolicyResult JSON at reservation time
    paypal_response    TEXT,                   -- redacted
    error              TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE ledger_entries (
    id             TEXT PRIMARY KEY,
    mandate_id     TEXT NOT NULL REFERENCES mandates(id),
    purchase_id    TEXT NOT NULL UNIQUE REFERENCES purchases(id),
    reserved_minor INTEGER NOT NULL CHECK (reserved_minor > 0),
    amount_minor   INTEGER NOT NULL CHECK (amount_minor >= 0 AND amount_minor <= reserved_minor),
    currency       TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('PENDING', 'CAPTURED', 'FAILED', 'VOIDED')),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX ledger_by_mandate ON ledger_entries (mandate_id, created_at);

  CREATE TABLE webhook_events (
    id           TEXT PRIMARY KEY,             -- PayPal event id (dedupe)
    event_type   TEXT NOT NULL,
    resource_id  TEXT,
    verified_by  TEXT NOT NULL,
    payload      TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    processed_at TEXT
  );
  `,
  `
  CREATE TABLE proposals (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    mandate_id   TEXT NOT NULL REFERENCES mandates(id),
    offer_id     TEXT NOT NULL,
    intent       TEXT NOT NULL,                -- PurchaseIntent JSON, built server-side (never from LLM numbers)
    display      TEXT NOT NULL,                -- what the approval card shows (masked labels, landed lines)
    policy       TEXT NOT NULL,                -- PolicyResult JSON at proposal time
    status       TEXT NOT NULL CHECK (status IN ('AWAITING_APPROVAL', 'EXECUTING', 'DONE', 'REJECTED', 'DENIED')),
    purchase_id  TEXT REFERENCES purchases(id),
    outcome      TEXT,                         -- BuyOutcome JSON
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX proposals_by_status ON proposals (status, created_at);
  `,
];

export function openDatabase(path: string = process.env.DATABASE_PATH ?? "data/truecart.db"): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Runs `fn` in BEGIN IMMEDIATE (takes the write lock up front). Rolls back on any throw. Not re-entrant. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
