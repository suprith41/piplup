import { readFileSync } from "fs";
import { executeDemo, executeGrantedLinks } from "../src/lib/razorpay/executor.ts";

function loadEnvFile(path: string): boolean {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      process.env[key] = value;
    }
    return true;
  } catch {
    return false;
  }
}

if (!loadEnvFile(".env") && !loadEnvFile(".env.local")) {
  console.error("Missing .env or .env.local");
  process.exit(1);
}
loadEnvFile(".env.local");

const all = process.argv.includes("--all");
const result = all ? await executeGrantedLinks() : { rows: await executeDemo({ force: true }) };
const rows = result.rows;
let created = 0;
let reused = 0;
let failed = 0;
for (const row of rows) {
  if (row.outcome === "created") created += 1;
  else if (row.outcome === "reused") reused += 1;
  else if (row.outcome === "failed") failed += 1;
  console.log(`${row.outcome.padEnd(8)} ${row.caseId}  ${row.link?.shortUrl ?? row.error ?? row.reason}`);
}
if (all) {
  const needed = "needed" in result ? result.needed : rows.length;
  console.log(`\nneeded ${needed} · created ${created} · reused ${reused} · failed ${failed}`);
  if ("capped" in result && result.capped) {
    console.log(`stopped at Razorpay test-mode cap: ${result.capped}`);
  }
}
