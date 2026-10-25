import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export type Db = PrismaClient;

/** Creates a Prisma client backed by node-postgres. Use one per process. */
export function createDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  // Sessions run in UTC. The pg adapter sends Date parameters as UTC wall-clock
  // text; in any other session time zone they would be stored shifted, and the
  // queue's comparisons against SQL now() (leases, retry backoff) would be wrong.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, options: "-c TimeZone=UTC" }) });
}
