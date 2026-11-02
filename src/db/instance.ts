// One database handle per server process (survives Next.js dev hot reloads).
import { openDatabase, type Db } from "./database";

const g = globalThis as unknown as { __truecartDb?: Db };

export function getDb(): Db {
  g.__truecartDb ??= openDatabase();
  return g.__truecartDb;
}
