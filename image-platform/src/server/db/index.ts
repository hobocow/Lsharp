import "server-only";
import postgres from "postgres";
import { config } from "../config";

export type Sql = ReturnType<typeof postgres>;
export type Tx = postgres.TransactionSql;

// One pool per process, created on first use (so builds don't need a database).
const g = globalThis as unknown as { __pg?: Sql };

export function db(): Sql {
  if (!g.__pg) {
    g.__pg = postgres(config.databaseUrl, {
      max: 10,
      onnotice: () => {},
      // BIGINT ids (incl. Telegram ids, < 2^53) as JS numbers. NUMERIC stays a string.
      types: {
        int8: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      },
    });
  }
  return g.__pg;
}

export type UserRow = {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  credits: number;
  is_banned: boolean;
};
