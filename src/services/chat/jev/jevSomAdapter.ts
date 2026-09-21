/**
 * SoM short-key elements → Jev choice criteria / decide payloads.
 */

import type { JevDecideRequest } from "./jevClient";

export type JevScreenshotPurpose = "act" | "verify";
export type JevScreenshotAction = "click" | "type";

/** Default max decide→act iterations inside one browser_screenshot(act) when Jev is on. */
export const JEV_ACT_LOOP_MAX_STEPS = 12;

/**
 * Act-loop gate on probabilities[choice] (jev-browser minTarget≈0.3).
 * Not the separate `confidence` field.
 */
export const JEV_ACT_MIN_P_TARGET = 0.35;

type SomEl = Record<string, unknown>;

function isFillableTag(tg: string, tp: string): boolean {
  if (tg === "textarea" || tg === "select") return true;
  if (tg === "input") {
    const t = (tp || "text").toLowerCase();
    return !["button", "submit", "reset", "image", "checkbox", "radio", "file", "hidden"].includes(
      t,
    );
  }
  return false;
}

export function briefSomElement(e: SomEl): string {
  const tg = typeof e.tg === "string" ? e.tg : "el";
  const tp = typeof e.tp === "string" ? e.tp : "";
  const tag = tp ? `${tg}:${tp}` : tg;
  const name =
    (typeof e.fl === "string" && e.fl) ||
    (typeof e.al === "string" && e.al) ||
    (typeof e.tx === "string" && e.tx) ||
    (typeof e.ph === "string" && e.ph) ||
    (typeof e.tt === "string" && e.tt) ||
    (typeof e.id === "string" && e.id) ||
    "";
  let s = `${tag} "${String(name).slice(0, 50)}"`;
  if (typeof e.sec === "string" && e.sec) s += ` in "${String(e.sec).slice(0, 40)}"`;
  if (typeof e.nm === "string" && e.nm && (tp === "radio" || tp === "checkbox")) {
    s += ` name=${String(e.nm).slice(0, 40)}`;
  }
  if (typeof e.st === "string" && e.st) s += ` (${e.st})`;
  if (typeof e.sd === "string" && e.sd) s += ` side=${e.sd}`;
  const vl = typeof e.vl === "string" ? e.vl.trim() : "";
  if (vl) s += ` value="${vl.slice(0, 40)}"`;
  // Filled/empty hint so loop Jev can pick the next empty field.
  if (isFillableTag(tg, tp)) {
    s += vl ? " [filled]" : " [empty]";
  } else if (tp === "checkbox" || tp === "radio" || /checked/i.test(String(e.st ?? ""))) {
    const checked =
      /checked|on|true|selected/i.test(String(e.st ?? "")) ||
      vl === "on" ||
      vl === "true" ||
      e.st === "checked";
    s += checked ? " [on]" : " [off]";
  }
  // Jev-only spatial hint: SoM keeps rc=[l,t,w,h] until stripElementRects for the LLM path.
  const rc = e.rc;
  if (Array.isArray(rc) && rc.length >= 4) {
    const l = Math.round(Number(rc[0]) || 0);
    const t = Math.round(Number(rc[1]) || 0);
    const w = Math.round(Number(rc[2]) || 0);
    const h = Math.round(Number(rc[3]) || 0);
    if (w > 0 && h > 0) s += ` box=${w}x${h}@${l},${t}`;
  }
  if (e.cp === true) s += " [captcha]";
  return s;
}

export function somElementsToCriteria(
  elements: unknown[],
  opts?: { max?: number; values?: Record<string, string> },
): Record<string, string> {
  const max = opts?.max ?? 120;
  const values = opts?.values ?? {};
  const skipIds = radioCheckboxSkipIds(elements, values);
  const criteria: Record<string, string> = {};
  let n = 0;
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomEl;
    const i = typeof e.i === "number" ? e.i : Number(e.i);
    if (!Number.isFinite(i) || i < 1) continue;
    if (skipIds.has(i)) continue; // hide satisfied radio/checkbox peers (stops Small↔Medium flip)
    criteria[String(i)] = briefSomElement(e);
    n++;
    if (n >= max) break;
  }
  criteria.none = "No suitable element / ambiguous / do not act / goal already done";
  return criteria;
}

function somIsChecked(e: SomEl): boolean {
  const vl = typeof e.vl === "string" ? e.vl.trim() : "";
  const st = typeof e.st === "string" ? e.st : "";
  return (
    /checked|on|true|selected/i.test(st) ||
    vl === "on" ||
    vl === "true" ||
    st === "checked"
  );
}

function radioGroupKey(e: SomEl): string {
  const tp = typeof e.tp === "string" ? e.tp.toLowerCase() : "";
  const nm = typeof e.nm === "string" ? e.nm.trim() : "";
  const sec = typeof e.sec === "string" ? e.sec.trim() : "";
  // Prefer HTML name (true radio group); fall back to section label.
  if (tp === "radio" && nm) return `radio:nm:${nm}`;
  if (tp === "radio") return `radio:sec:${sec || "_"}`;
  if (tp === "checkbox" && nm) return `checkbox:nm:${nm}`;
  return `checkbox:i:${typeof e.i === "number" ? e.i : e.i}`;
}

/**
 * Radios/checkboxes that should not be offered: peers in a group that is already
 * correctly selected (or any [off] peer when some option is [on] and values don't require a switch).
 */
export function radioCheckboxSkipIds(
  elements: unknown[],
  values: Record<string, string>,
): Set<number> {
  const skip = new Set<number>();
  const groups = new Map<string, SomEl[]>();
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomEl;
    const tp = typeof e.tp === "string" ? e.tp.toLowerCase() : "";
    if (tp !== "radio" && tp !== "checkbox") continue;
    // Only radio groups flip mutually; checkboxes can multi-select — still skip [on] repeats.
    const key = radioGroupKey(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const valueNeedle = Object.values(values).map((v) => v.trim().toLowerCase()).filter(Boolean);

  for (const [gkey, members] of groups) {
    if (gkey.startsWith("checkbox:")) {
      // Don't re-click already [on] checkboxes.
      for (const e of members) {
        const i = typeof e.i === "number" ? e.i : Number(e.i);
        if (somIsChecked(e) && Number.isFinite(i)) skip.add(i);
      }
      continue;
    }

    // radio (grouped by nm, or sec fallback)
    const onMembers = members.filter(somIsChecked);
    if (onMembers.length === 0) continue;

    const desired = members.find((e) => {
      const vl = typeof e.vl === "string" ? e.vl.trim().toLowerCase() : "";
      const label =
        typeof e.fl === "string"
          ? e.fl.toLowerCase()
          : typeof e.tx === "string"
            ? e.tx.toLowerCase()
            : "";
      return valueNeedle.some(
        (v) => v === vl || (label && (label.includes(v) || v.includes(label))),
      );
    });

    if (desired) {
      const desiredOn = somIsChecked(desired);
      if (desiredOn) {
        for (const e of members) {
          const i = typeof e.i === "number" ? e.i : Number(e.i);
          if (Number.isFinite(i)) skip.add(i);
        }
      } else {
        const want = typeof desired.i === "number" ? desired.i : Number(desired.i);
        for (const e of members) {
          const i = typeof e.i === "number" ? e.i : Number(e.i);
          if (Number.isFinite(i) && i !== want) skip.add(i);
        }
      }
      continue;
    }

    // No matching values: keep current selection — do not offer other [off] radios.
    for (const e of members) {
      if (somIsChecked(e)) continue;
      const i = typeof e.i === "number" ? e.i : Number(e.i);
      if (Number.isFinite(i)) skip.add(i);
    }
  }
  return skip;
}

export function findSomBrief(elements: unknown[], index: number): string | undefined {
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomEl;
    const i = typeof e.i === "number" ? e.i : Number(e.i);
    if (i === index) return briefSomElement(e);
  }
  return undefined;
}

/** Heuristic: goal likely needs typed strings (not click-only). */
export function goalLooksLikeFill(goal: string): boolean {
  return /填|输入|填写|写上|填入|fill\b|type\b|enter\b|input\b|表单|form\b/i.test(
    goal,
  );
}

/** Normalize LLM-provided fill candidates into a flat string map for Jev. */
export function normalizeActValues(input: {
  text?: string;
  values?: unknown;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = input.values;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = String(k).trim();
      if (!key) continue;
      if (typeof v === "string" && v !== "") out[key] = v;
      else if (v != null && typeof v !== "object") out[key] = String(v);
    }
  } else if (Array.isArray(raw)) {
    raw.forEach((v, i) => {
      if (typeof v === "string" && v !== "") out[`v${i + 1}`] = v;
    });
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text && !Object.values(out).includes(text)) {
    out.text = text;
  }
  return out;
}

/**
 * Act decide: one question only — pick next SoM index (or none).
 * Local code infers click vs type from element tag; matches text from state.values.
 */
export function buildJevActDecideRequest(input: {
  goal: string;
  url?: string;
  title?: string;
  elements: unknown[];
  /** Optional hint from LLM (unused for decide; kept for API compat). */
  preferredAction?: JevScreenshotAction;
  values?: Record<string, string>;
  /** Prior successful steps in this screenshot loop. */
  lastActions?: string[];
  stepIndex?: number;
  maxSteps?: number;
}): JevDecideRequest {
  const values = input.values ?? {};
  const valueKeys = Object.keys(values);
  const lastActions = (input.lastActions ?? []).slice(-8);
  const criteria = somElementsToCriteria(input.elements, { values });

  if (valueKeys.length > 0) {
    for (const [id, brief] of Object.entries(criteria)) {
      if (id === "none") continue;
      if (/\b\[empty\]\b/.test(brief) && /\b(input|textarea)\b/i.test(brief)) {
        criteria[id] = `${brief} ← fill from state.values if this field matches`;
      }
    }
  }

  return {
    state: {
      purpose: "act",
      goal: input.goal,
      url: input.url,
      title: input.title,
      step: input.stepIndex ?? 1,
      max_steps: input.maxSteps ?? JEV_ACT_LOOP_MAX_STEPS,
      ...(valueKeys.length ? { values } : {}),
      ...(lastActions.length ? { last_actions: lastActions } : {}),
    },
    questions: {
      next: {
        type: "choice",
        instructions:
          `Pick the single next SoM index to interact with to advance the goal. ` +
          `Order: prefer the topmost unfinished text field ([empty]) first. ` +
          `Fill empty inputs/textareas from state.values; click radios/checkboxes/buttons only when needed. ` +
          `For radio groups: if one option is already [on] and matches state.values (or no other value is required), do NOT click other [off] options — that causes useless flipping. ` +
          `Do not jump to Submit while required fields are still [empty]. ` +
          `Skip [filled]/[on] unless correcting. Use none when the goal is done or stuck.`,
        criteria,
      },
    },
  };
}

function normMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

/** Infer click vs type from SoM short-key element. */
export function inferActFromSomElement(
  elements: unknown[],
  index: number,
): JevScreenshotAction | null {
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomEl;
    const i = typeof e.i === "number" ? e.i : Number(e.i);
    if (i !== index) continue;
    const tg = typeof e.tg === "string" ? e.tg.toLowerCase() : "el";
    const tp = typeof e.tp === "string" ? e.tp.toLowerCase() : "";
    if (tg === "textarea") return "type";
    if (tg === "select") return "click";
    if (tg === "input") {
      if (["checkbox", "radio", "button", "submit", "reset", "image", "file"].includes(tp)) {
        return "click";
      }
      return "type";
    }
    if (tg === "button" || tg === "a") return "click";
    return "click";
  }
  return null;
}

/** Pick which remaining values entry to type into this element (label/key heuristic). */
export function pickValueForSomElement(
  elements: unknown[],
  index: number,
  remainingValues: Record<string, string>,
): { key: string; text: string } | null {
  const keys = Object.keys(remainingValues);
  if (keys.length === 0) return null;
  if (keys.length === 1) {
    const key = keys[0]!;
    return { key, text: remainingValues[key]! };
  }

  let el: SomEl | null = null;
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomEl;
    const i = typeof e.i === "number" ? e.i : Number(e.i);
    if (i === index) {
      el = e;
      break;
    }
  }
  if (!el) return null;

  const hay = normMatch(
    [
      typeof el.fl === "string" ? el.fl : "",
      typeof el.al === "string" ? el.al : "",
      typeof el.ph === "string" ? el.ph : "",
      typeof el.id === "string" ? el.id : "",
      typeof el.tx === "string" ? el.tx : "",
    ].join(" "),
  );

  let best: { key: string; score: number } | null = null;
  for (const key of keys) {
    const kn = normMatch(key);
    let score = 0;
    if (kn && hay.includes(kn)) score += 10;
    const stripped = kn.replace(/^(cust|user|form)/, "");
    if (stripped && hay.includes(stripped)) score += 6;
    if (/name|姓名|客户/.test(hay) && /name|姓名/.test(kn)) score += 8;
    if (/tel|phone|电话|手机/.test(hay) && /tel|phone|电话|手机/.test(kn)) score += 8;
    if (/email|邮|mail/.test(hay) && /email|mail|邮/.test(kn)) score += 8;
    if (/time|时间|delivery/.test(hay) && /time|delivery|时间/.test(kn)) score += 8;
    if (
      /instruct|备注|说明|comment|message/.test(hay) &&
      /instruct|comment|备注|msg|message/.test(kn)
    ) {
      score += 8;
    }
    // Also match value against radio/checkbox option text via remaining click path — N/A here.
    if (score > (best?.score ?? 0)) best = { key, score };
  }
  if (best && best.score >= 6) {
    return { key: best.key, text: remainingValues[best.key]! };
  }
  return null;
}

export function buildJevVerifyDecideRequest(input: {
  goal: string;
  url?: string;
  title?: string;
  elements: unknown[];
  lastChange?: unknown;
  lastAction?: string;
  visibleText?: string;
  dialogs?: string[];
}): JevDecideRequest {
  // Status options live in criteria; element briefs only in state summary (avoid huge duplicate).
  const briefs = somElementsToCriteria(input.elements, { max: 15 });
  delete briefs.none;
  const visible = input.visibleText?.trim();
  const dialogs = (input.dialogs ?? []).map((d) => d.trim()).filter(Boolean).slice(0, 6);
  return {
    state: {
      purpose: "verify",
      goal: input.goal,
      url: input.url,
      title: input.title,
      last_action: input.lastAction,
      last_change: input.lastChange,
      ...(dialogs.length ? { dialogs } : {}),
      ...(visible ? { visible_text: visible } : {}),
      elements_sample: briefs,
    },
    questions: {
      status: {
        type: "choice",
        instructions:
          "Given the page state (and last_change if any), what is the status of the goal?",
        criteria: {
          done: "goal achieved",
          error: "error message, blocked, or failed",
          stuck: "no useful progress toward the goal",
          uncertain: "cannot tell from text state; need vision / human",
        },
      },
    },
  };
}

export type ParsedScreenshotIntent =
  | {
      ok: true;
      purpose: JevScreenshotPurpose;
      goal: string;
      /** Optional hint only; Jev chooses action when enabled. */
      action?: JevScreenshotAction;
      text?: string;
      values: Record<string, string>;
    }
  | { ok: false; error: string; hint: string };

export function parseScreenshotIntent(args: Record<string, unknown>): ParsedScreenshotIntent {
  const purposeRaw = typeof args.purpose === "string" ? args.purpose.trim().toLowerCase() : "";
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (purposeRaw !== "act" && purposeRaw !== "verify") {
    return {
      ok: false,
      error: "purpose required",
      hint: 'browser_screenshot requires purpose: "act" | "verify", and goal (short outcome).',
    };
  }
  if (!goal) {
    return {
      ok: false,
      error: "goal required",
      hint: "browser_screenshot requires goal: a short observable outcome for this step.",
    };
  }
  if (purposeRaw === "verify") {
    return { ok: true, purpose: "verify", goal, values: {} };
  }

  // action / text optional — when Jev is on it picks click|type; text/values are fill candidates.
  const actionRaw = typeof args.action === "string" ? args.action.trim().toLowerCase() : "";
  const action: JevScreenshotAction | undefined =
    actionRaw === "click" || actionRaw === "type" ? actionRaw : undefined;
  const text = typeof args.text === "string" ? args.text : undefined;
  const values = normalizeActValues({ text, values: args.values });

  return {
    ok: true,
    purpose: "act",
    goal,
    ...(action ? { action } : {}),
    ...(text !== undefined ? { text } : {}),
    values,
  };
}
