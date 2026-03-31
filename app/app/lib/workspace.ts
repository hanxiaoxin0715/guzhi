import fs from "fs";
import path from "path";
import { getBaseOutputDir } from "./paths";

function getWorkspaceDir(): string {
  return path.join(getBaseOutputDir(), "workspace");
}

export async function getWorkspaceConfig(): Promise<Record<string, any>> {
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) return {};

  const config: Record<string, any> = {};

  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    if (!f.isFile()) continue;
    if (!f.name.endsWith(".json")) continue;
    const key = f.name.slice(0, -".json".length);
    try {
      const fp = path.join(dir, f.name);
      const raw = fs.readFileSync(fp, "utf-8");
      try {
        config[key] = JSON.parse(raw);
      } catch {
        config[key] = raw;
      }
    } catch {}
  }

  return config;
}
