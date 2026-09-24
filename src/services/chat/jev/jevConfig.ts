/**
 * Jev（TypeSafe System One）独立配置 — 不进 LLM provider / activeModel。
 * chrome.storage.local key: doma_jev_config
 */

import { isJevReady } from "@/services/chat/jev/jevRequest";

export const JEV_STORAGE_KEY = "doma_jev_config";

export const JEV_DEFAULT_MODEL = "jev-latest";
export const JEV_FALLBACK_MODELS = ["jev-latest", "jev-preview", "jev-1.13.0"] as const;

/** Official TypeSafe API */
export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai";

/** Hosted decide API (keys like jv_live_…) — https://jevtypesafeai.com */
export const JEV_HOSTED_BASE_URL = "https://jevtypesafeai.com";

export type JevConfig = {
  /** Composer switch: when true, screenshot may use Jev decide. */
  enabled: boolean;
  apiKey: string;
  model: string;
  /** API origin without trailing slash */
  baseUrl: string;
  /** Min choice confidence to auto-act; default 0.75 */
  confidenceMin: number;
};

const DEFAULTS: JevConfig = {
  enabled: false,
  apiKey: "",
  model: JEV_DEFAULT_MODEL,
  baseUrl: JEV_DEFAULT_BASE_URL,
  confidenceMin: 0.75,
};

/** Hosted prepaid keys from jevtypesafeai.com */
export function isJevHostedApiKey(apiKey: string): boolean {
  const k = apiKey.trim().toLowerCase();
  return k.startsWith("jv_live_") || k.startsWith("jv_test_");
}

/**
 * Pick API origin from key shape unless caller already set a non-default custom base.
 */
export function resolveJevBaseUrl(apiKey: string, explicitBaseUrl?: string): string {
  const explicit = (explicitBaseUrl || "").trim().replace(/\/+$/, "");
  const custom =
    explicit &&
    explicit !== JEV_DEFAULT_BASE_URL &&
    explicit !== JEV_HOSTED_BASE_URL;
  if (custom) return explicit;
  if (isJevHostedApiKey(apiKey)) return JEV_HOSTED_BASE_URL;
  if (explicit) return explicit;
  return JEV_DEFAULT_BASE_URL;
}

function normalize(raw: Partial<JevConfig> | null | undefined): JevConfig {
  const apiKey = typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "";
  const model =
    typeof raw?.model === "string" && raw.model.trim()
      ? raw.model.trim()
      : JEV_DEFAULT_MODEL;
  const baseUrl = resolveJevBaseUrl(apiKey, raw?.baseUrl);
  const confidenceMin =
    typeof raw?.confidenceMin === "number" &&
    Number.isFinite(raw.confidenceMin) &&
    raw.confidenceMin >= 0 &&
    raw.confidenceMin <= 1
      ? raw.confidenceMin
      : DEFAULTS.confidenceMin;
  // enabled 只存开关；是否可开由 isJevConfigured（edition：Open 要 key / Pro 恒可）
  const enabled = !!raw?.enabled && isJevReady({ apiKey });
  return {
    enabled,
    apiKey,
    model,
    baseUrl,
    confidenceMin,
  };
}

/** Edition-aware：Open 需 API key；Pro 托管，无需用户 key。 */
export function isJevConfigured(cfg: Pick<JevConfig, "apiKey">): boolean {
  return isJevReady(cfg);
}

export async function loadJevConfig(): Promise<JevConfig> {
  try {
    const result = await chrome.storage.local.get(JEV_STORAGE_KEY);
    return normalize(result[JEV_STORAGE_KEY] as Partial<JevConfig> | undefined);
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveJevConfig(partial: Partial<JevConfig>): Promise<JevConfig> {
  const prev = await loadJevConfig();
  const apiKey = partial.apiKey !== undefined ? partial.apiKey : prev.apiKey;
  // When key changes (or base not explicitly passed), re-resolve so jv_live_ → hosted.
  const baseUrl =
    partial.baseUrl !== undefined
      ? partial.baseUrl
      : resolveJevBaseUrl(apiKey || "", undefined);
  const next = normalize({
    ...prev,
    ...partial,
    apiKey,
    baseUrl,
  });
  if (next.enabled && !isJevConfigured(next)) {
    next.enabled = false;
  }
  await chrome.storage.local.set({ [JEV_STORAGE_KEY]: next });
  return next;
}

export async function setJevEnabled(enabled: boolean): Promise<JevConfig> {
  return saveJevConfig({ enabled });
}

/** Composer 开关 UI 快照：避免 inline composer 重挂载时 false→true 闪动画 */
let jevUiSnapshot: { enabled: boolean; configured: boolean } | null = null;

export function getJevUiSnapshot(): { enabled: boolean; configured: boolean } | null {
  return jevUiSnapshot;
}

export function setJevUiSnapshot(next: { enabled: boolean; configured: boolean }): void {
  jevUiSnapshot = {
    enabled: !!next.enabled,
    configured: !!next.configured,
  };
}
