import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as khalisSchema from "../schema/khalis";
import * as factureSchema from "../schema/facture";
import * as usersSchema from "../schema/users";

export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool, {
    schema: { ...khalisSchema, ...factureSchema, ...usersSchema },
  });
}

export type Database = ReturnType<typeof createDb>;
