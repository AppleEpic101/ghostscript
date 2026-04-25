import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadLocalEnvFiles();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

if (supabaseServiceRoleKey.startsWith("sb_publishable_")) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is using a Supabase publishable key. Replace it with the backend secret/service-role key from your Supabase project settings.",
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function main() {
  const { error: participantDeleteError } = await supabase
    .from("pairing_participants")
    .delete()
    .not("id", "is", null);

  if (participantDeleteError) {
    throw new Error(`Unable to clear pairing participants: ${participantDeleteError.message}`);
  }

  const { error: sessionDeleteError } = await supabase
    .from("pairing_sessions")
    .delete()
    .not("id", "is", null);

  if (sessionDeleteError) {
    throw new Error(`Unable to clear pairing sessions: ${sessionDeleteError.message}`);
  }

  console.log("Cleared pairing API data for fresh deploy.");
}

void main();

function loadLocalEnvFiles() {
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  for (const relativePath of [".env.local", ".env"]) {
    const envPath = resolve(apiDir, relativePath);

    if (!existsSync(envPath)) {
      continue;
    }

    const source = readFileSync(envPath, "utf8");

    for (const line of source.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
      process.env[key] = normalizeEnvValue(rawValue);
    }
  }
}

function normalizeEnvValue(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
