import { Pool } from "pg";

const globalForPg = globalThis as unknown as {
  repairOpsPool?: Pool;
};

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  if (!globalForPg.repairOpsPool) {
    globalForPg.repairOpsPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }

  return globalForPg.repairOpsPool;
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4) || "0000";
  return `***-***-${last4}`;
}

export function normalizeId(value: string, fallback: string) {
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}
