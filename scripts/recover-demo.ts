import { readFileSync } from "fs";
import { executeDemo } from "../src/lib/razorpay/executor.ts";

function loadLocalEnv(): void {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    console.error("Missing .env.local");
    process.exit(1);
  }
}

loadLocalEnv();

const rows = await executeDemo();
for (const row of rows) {
  console.log(`${row.outcome.padEnd(8)} ${row.caseId}  ${row.link?.shortUrl ?? row.error ?? row.reason}`);
}
