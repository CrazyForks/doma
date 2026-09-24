/**
 * Open：用户 BYOK → TypeSafe / hosted decide。
 */
import type { JevConfig } from "./jevConfig";

export type JevDecideFetchPlan = {
  url: string;
  headers: Record<string, string>;
  /** Log-safe hint (key prefix / hosted marker) */
  logHint: string;
};

/** Open：必须自备 API key 才可开 Jev。 */
export function isJevReady(cfg: Pick<JevConfig, "apiKey">): boolean {
  return !!(cfg.apiKey && cfg.apiKey.trim());
}

/** Open：Composer 需要 setup（key + model）。 */
export function jevNeedsUserSetup(): boolean {
  return true;
}

function decideUrl(baseUrl: string): string {
  const base = (baseUrl || "").replace(/\/+$/, "") || "https://api.typesafe.ai";
  if (base.includes("jevtypesafeai.com")) {
    return `${base}/api/v1/decide`;
  }
  return `${base}/v1/systemone`;
}

function keyHint(apiKey: string): string {
  const k = apiKey.trim();
  if (k.length <= 12) return `${k.slice(0, 4)}…(len=${k.length})`;
  return `${k.slice(0, 10)}…(len=${k.length})`;
}

export async function buildJevDecideFetch(
  cfg: JevConfig,
): Promise<JevDecideFetchPlan> {
  const apiKey = cfg.apiKey.trim();
  if (!apiKey) throw new Error("Jev API key missing");
  return {
    url: decideUrl(cfg.baseUrl),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    logHint: keyHint(apiKey),
  };
}
