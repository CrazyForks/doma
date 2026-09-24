/**
 * Minimal Jev HTTP client (list models + decide).
 * Decide URL / auth headers：edition 模块 jevRequest（Open BYOK / Pro DomA 托管）。
 */

import {
  JEV_FALLBACK_MODELS,
  type JevConfig,
  loadJevConfig,
} from "./jevConfig";
import { buildJevDecideFetch } from "@/services/chat/jev/jevRequest";

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
};

export type JevNoulAnswer = {
  type: "noul";
  noul: number;
};

export type JevScoreAnswer = {
  type: "score";
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer | JevScoreAnswer;

export type JevDecideRequest = {
  model?: string;
  state: unknown;
  questions: Record<
    string,
    {
      type: "choice" | "score" | "noul";
      instructions: string;
      criteria?: Record<string, string | null> | string[];
    }
  >;
};

export type JevDecideResponse = {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: Record<string, unknown>;
};

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function modelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.includes("jevtypesafeai.com")) {
    return `${base}/api/v1/models`;
  }
  return `${base}/v1/models`;
}

function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const list =
    (Array.isArray(obj.data) && obj.data) ||
    (Array.isArray(obj.models) && obj.models) ||
    (Array.isArray(obj) && obj) ||
    [];
  const ids: string[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      ids.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const m = item as Record<string, unknown>;
      const id =
        (typeof m.id === "string" && m.id) ||
        (typeof m.name === "string" && m.name) ||
        (typeof m.model === "string" && m.model) ||
        "";
      if (id.trim()) ids.push(id.trim());
    }
  }
  return [...new Set(ids)];
}

export async function listJevModels(opts?: {
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const cfg = await loadJevConfig();
  const apiKey = (opts?.apiKey ?? cfg.apiKey).trim();
  const baseUrl = (opts?.baseUrl ?? cfg.baseUrl).trim();
  if (!apiKey) {
    return [...JEV_FALLBACK_MODELS];
  }
  try {
    const res = await fetch(modelsUrl(baseUrl), {
      method: "GET",
      headers: authHeaders(apiKey),
      signal: opts?.signal,
    });
    if (!res.ok) {
      console.warn("[jev] listModels HTTP", res.status);
      return [...JEV_FALLBACK_MODELS];
    }
    const json = await res.json();
    const ids = parseModelIds(json);
    if (ids.length === 0) return [...JEV_FALLBACK_MODELS];
    // Ensure common pins are always choosable.
    for (const pin of JEV_FALLBACK_MODELS) {
      if (!ids.includes(pin)) ids.push(pin);
    }
    return ids;
  } catch (e) {
    console.warn("[jev] listModels failed", e);
    return [...JEV_FALLBACK_MODELS];
  }
}

export async function jevDecide(
  request: JevDecideRequest,
  opts?: { config?: JevConfig; signal?: AbortSignal },
): Promise<JevDecideResponse> {
  const cfg = opts?.config ?? (await loadJevConfig());
  const plan = await buildJevDecideFetch(cfg);
  const url = plan.url;
  const body = {
    model: request.model || cfg.model || "jev-latest",
    state: request.state,
    questions: request.questions,
  };
  const questionKeys = Object.keys(body.questions);
  const criteriaSizes: Record<string, number> = {};
  for (const [k, q] of Object.entries(body.questions)) {
    const c = q.criteria;
    criteriaSizes[k] = Array.isArray(c)
      ? c.length
      : c && typeof c === "object"
        ? Object.keys(c).length
        : 0;
  }
  const t0 = Date.now();
  console.log("[jev] decide:request", {
    url,
    model: body.model,
    questionKeys,
    criteriaSizes,
    authHint: plan.logHint,
    baseUrl: cfg.baseUrl,
  });
  // Full payload for debugging (what Jev actually sees).
  console.log("[jev] decide:payload", JSON.parse(JSON.stringify(body)));
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: plan.headers,
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (e) {
    console.warn("[jev] decide:network-error", {
      url,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[jev] decide:http-error", {
      url,
      status: res.status,
      ms: Date.now() - t0,
      body: text.slice(0, 300),
    });
    throw new Error(`Jev decide HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as JevDecideResponse;
  if (!json || typeof json !== "object" || !json.answers) {
    console.warn("[jev] decide:bad-response", { ms: Date.now() - t0, json });
    throw new Error("Jev decide: invalid response");
  }
  const answerSummary: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(json.answers)) {
    if (!a || typeof a !== "object") {
      answerSummary[k] = a;
      continue;
    }
    if (a.type === "choice") {
      const probs = a.probabilities ?? {};
      const ranked = Object.entries(probs)
        .map(([id, p]) => ({ id, p: Number(p) || 0 }))
        .sort((x, y) => y.p - x.p);
      answerSummary[k] = {
        type: "choice",
        choice: a.choice,
        confidence: a.confidence,
        top: ranked.slice(0, 5),
        probabilities: probs,
      };
    } else if (a.type === "noul") {
      answerSummary[k] = { type: "noul", noul: a.noul };
    } else if (a.type === "score") {
      answerSummary[k] = {
        type: "score",
        score: a.score,
        confidence: a.confidence,
        probabilities: a.probabilities,
      };
    } else {
      answerSummary[k] = { type: (a as { type?: string }).type };
    }
  }
  console.log("[jev] decide:ok", {
    url,
    ms: Date.now() - t0,
    model: json.model,
    answers: answerSummary,
    usage: json.usage ?? null,
  });
  return json;
}
