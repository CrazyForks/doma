/**
 * SoM short-key elements → Jev choice criteria / decide payloads.
 */

import type { JevDecideRequest } from "./jevClient";
import { logCal, summarizeCalSom } from "../somOverlay";

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
  if (e.ds === true) s += " [dismiss]";
  else if (e.ov === true) s += " [overlay]";
  return s;
}

export function somElementsToCriteria(
  elements: unknown[],
  opts?: {
    max?: number;
    values?: Record<string, string>;
    /** unexpected overlay: only [dismiss] (+ none) */
    overlayMode?: "dismiss_only" | "overlay_prefer" | "normal";
    /** 日历选日：先从候选里拿掉关闭钮 */
    excludeDismiss?: boolean;
    /** 日期已选中：候选里拿掉日期格，逼选关层/确认钮 */
    excludeDateCells?: boolean;
    /**
     * 关弹窗场景：层内无候选时禁止扩到整页（非模态下点外面易点到链接跳转）。
     * dismiss_only 回退时默认 true。
     */
    allowPageFallback?: boolean;
    /**
     * suggest/calendar 等必须点层内项时：有候选则不提供 none（宁可选错，不能假完成）。
     * 层内 0 候选时仍会带 none 作为逃生口。默认 true。
     */
    allowNone?: boolean;
  },
): Record<string, string> {
  const max = opts?.max ?? 120;
  const values = opts?.values ?? {};
  const overlayMode = opts?.overlayMode ?? "normal";
  const excludeDismiss = !!opts?.excludeDismiss;
  const excludeDateCells = !!opts?.excludeDateCells;
  const allowPageFallback = opts?.allowPageFallback !== false;
  const allowNone = opts?.allowNone !== false;
  const skipIds = radioCheckboxSkipIds(elements, values);
  const criteria: Record<string, string> = {};
  let n = 0;
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomEl;
    const i = typeof e.i === "number" ? e.i : Number(e.i);
    if (!Number.isFinite(i) || i < 1) continue;
    if (skipIds.has(i)) continue;
    if (excludeDismiss && e.ds === true) continue;
    if (excludeDateCells && looksCalendarDateCell(e)) continue;
    if (overlayMode === "dismiss_only" && e.ds !== true) continue;
    if (overlayMode === "overlay_prefer" && e.ov !== true && e.ds !== true) continue;
    criteria[String(i)] = briefSomElement(e);
    n++;
    if (n >= max) break;
  }
  // unexpected 但没扫到 dismiss：先扩到层内控件，仍禁止整页链接
  if (overlayMode === "dismiss_only" && n === 0) {
    return somElementsToCriteria(elements, {
      max,
      values,
      overlayMode: "overlay_prefer",
      excludeDismiss,
      excludeDateCells,
      allowPageFallback: false,
      allowNone,
    });
  }
  if (overlayMode === "overlay_prefer" && n === 0) {
    if (!allowPageFallback) {
      criteria.none =
        "No in-overlay dismiss/control found — do not click outside links; abstain or use Escape if appropriate";
      return criteria;
    }
    return somElementsToCriteria(elements, {
      max,
      values,
      overlayMode: "normal",
      excludeDismiss: false,
      excludeDateCells: false,
      allowNone,
    });
  }
  // 日历排除 dismiss 后若空了，允许带 dismiss 再试一层
  if (excludeDismiss && n === 0) {
    return somElementsToCriteria(elements, {
      max,
      values,
      overlayMode,
      excludeDismiss: false,
      excludeDateCells,
      allowPageFallback,
      allowNone,
    });
  }
  // 排除日期格后若空了：放回日期格，避免完全无候选
  if (excludeDateCells && n === 0) {
    return somElementsToCriteria(elements, {
      max,
      values,
      overlayMode,
      excludeDismiss: false,
      excludeDateCells: false,
      allowPageFallback,
      allowNone,
    });
  }
  // 有层内候选且禁止 none：逼 Jev 点一项（选错可纠；none 假完成无法推进）
  if (allowNone || n === 0) {
    criteria.none = "No suitable element / ambiguous / do not act / goal already done";
  }
  return criteria;
}

/** 层内像日历日格（非 dismiss）：选日完成后应从候选剔除 */
function looksCalendarDateCell(e: SomEl): boolean {
  if (e.ds === true) return false;
  if (e.ov !== true) return false;
  const blob = `${e.tx ?? ""} ${e.al ?? ""} ${e.fl ?? ""}`.trim();
  if (!blob) return false;
  if (/departure date|return date|已选|选中/i.test(blob)) return true;
  if (/^\d{1,2}(\$\S+)?$/.test(blob.replace(/\s+/g, ""))) return true;
  if (
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(blob) &&
    /\b\d{1,2}\b/.test(blob)
  ) {
    return true;
  }
  if (/^\d{1,2}$/.test(blob) || (/^\d{1,2}\D/.test(blob) && blob.length <= 24)) return true;
  return false;
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
  /** 阻断层信号（与 SoM 共用） */
  blockingOverlay?: {
    present: boolean;
    kind?: string;
    expected?: true | false | "unknown";
    message?: string;
    isError?: boolean;
    suggestNeedle?: string;
  };
  /** 上一步刚 type 的文本，用于 suggest 层选 option */
  lastTyped?: string;
  /** 本 loop 已成功点中日历日格；层若还在则改找关层/确认，禁止再点日期 */
  calendarDatePicked?: boolean;
}): JevDecideRequest {
  const values = input.values ?? {};
  const valueKeys = Object.keys(values);
  const lastActions = (input.lastActions ?? []).slice(-8);
  const ov = input.blockingOverlay;
  const kind = ov?.kind;
  const calendarDatePicked = !!input.calendarDatePicked;
  const calendarNeedsClose =
    calendarDatePicked && !!ov?.present && kind === "calendar" && ov.expected !== false;
  const suggestNeedle =
    (ov?.suggestNeedle || input.lastTyped || Object.values(values)[0] || "").trim();
  // 日历 / 建议层：选日/选建议优先于关窗；日期已选中且层还在 → 允许关层确认钮
  const overlayMode =
    calendarNeedsClose
      ? "overlay_prefer"
      : ov?.present && (kind === "calendar" || kind === "suggest")
        ? "overlay_prefer"
        : ov?.present && ov.expected === false
          ? "dismiss_only"
          : ov?.present && ov.expected === true
            ? "overlay_prefer"
            : ov?.present
              ? "overlay_prefer"
              : "normal";
  const excludeDismiss = !!(
    ov?.present &&
    (kind === "calendar" || kind === "suggest") &&
    ov.expected !== false &&
    !calendarNeedsClose
  );
  const excludeDateCells = calendarNeedsClose;
  // suggest/calendar：有层内项时不提供 none；选日后找关层时同样强制点一层内控件
  const mustPickOverlay = !!(
    ov?.present &&
    (kind === "calendar" || kind === "suggest") &&
    ov.expected !== false
  );
  const criteria = somElementsToCriteria(input.elements, {
    values,
    overlayMode,
    excludeDismiss,
    excludeDateCells,
    allowNone: !mustPickOverlay,
  });

  // 诊断：Service Worker 控制台过滤 `[DomA:cal]`
  {
    const critIds = Object.keys(criteria).filter((k) => k !== "none");
    const dateish = critIds.filter((id) => {
      const b = criteria[id] ?? "";
      return /\[overlay\]/.test(b) && !/\[dismiss\]/.test(b) && /\b\d{1,2}\b/.test(b);
    });
    const dismissish = critIds.filter((id) => /\[dismiss\]/.test(criteria[id] ?? ""));
    logCal("jev:criteria", {
      step: input.stepIndex ?? 1,
      goal: input.goal.slice(0, 120),
      calendarDatePicked,
      calendarNeedsClose,
      overlay: ov?.present
        ? {
            kind: ov.kind ?? null,
            expected: ov.expected ?? null,
            isError: ov.isError === true,
            message: ov.message?.slice(0, 80) ?? null,
          }
        : { present: false },
      overlayMode,
      excludeDismiss,
      excludeDateCells,
      allowNone: !mustPickOverlay,
      hasNone: Object.prototype.hasOwnProperty.call(criteria, "none"),
      criteriaCount: critIds.length,
      dismissInCriteria: dismissish.slice(0, 12),
      dateishInCriteria: dateish.slice(0, 24),
      criteriaHead: critIds.slice(0, 30).map((id) => `${id}:${(criteria[id] ?? "").slice(0, 80)}`),
      som: summarizeCalSom(input.elements, 16),
    });
  }

  if (valueKeys.length > 0) {
    for (const [id, brief] of Object.entries(criteria)) {
      if (id === "none") continue;
      if (/\b\[empty\]\b/.test(brief) && /\b(input|textarea)\b/i.test(brief)) {
        criteria[id] = `${brief} ← fill from state.values if this field matches`;
      }
    }
  }

  let overlayInstr = "";
  if (ov?.present && ov.isError) {
    overlayInstr =
      ` BLOCKING OVERLAY (ERROR/VALIDATION): Message: "${(ov.message ?? "").slice(0, 160)}". ` +
      `Pick in-overlay [dismiss] (确定/×/关闭) to close it NOW. ` +
      `After this click the loop will hand back to the main agent to fix the issue — ` +
      `do not try to complete the original submit in this step. Never click outside links. `;
  } else if (calendarNeedsClose) {
    overlayInstr =
      ` BLOCKING OVERLAY (calendar, date already selected): Do NOT click any date cell again. ` +
      `Pick an in-overlay control that confirms or closes the panel — prefer [dismiss] ` +
      `(Done/完成/确定/Apply/OK/×/关闭 as labeled on the page). ` +
      `Never click outside-page links to dismiss. `;
  } else if (ov?.present && kind === "calendar" && ov.expected !== false) {
    overlayInstr =
      ` BLOCKING OVERLAY (calendar): You MUST pick one date cell ([overlay]) closest to the goal ` +
      `(e.g. tomorrow / the stated day). Abstain/none is not available — guessing a nearby day is better than doing nothing. ` +
      `Do NOT pick [dismiss] until a date is chosen. Never click outside-page links to dismiss. `;
  } else if (ov?.present && kind === "suggest" && ov.expected !== false) {
    overlayInstr =
      ` BLOCKING OVERLAY (suggest/autocomplete listbox): You MUST pick one in-overlay option ` +
      `(li / role=option) closest to ${suggestNeedle ? `"${suggestNeedle.slice(0, 40)}"` : "the typed/goal place name"}. ` +
      `Abstain/none is not available — a near match beats doing nothing. ` +
      `Do NOT pick "Select multiple airports" or similar toggles. Do NOT dismiss until an option is chosen. `;
  } else if (ov?.present && ov.expected === false) {
    overlayInstr =
      ` BLOCKING OVERLAY (unexpected ${kind ?? "dialog"}): Close it FIRST by picking an in-overlay [dismiss] ` +
      `(×/关闭/取消/确定 inside the panel). Do NOT click random page links or content under/around the panel ` +
      `(non-modal popovers: outside clicks often navigate away). Only if no in-overlay dismiss exists, ` +
      `abstain (none) or use Escape — do not hunt links outside. `;
  } else if (ov?.present && ov.expected === true) {
    overlayInstr =
      ` BLOCKING OVERLAY (expected ${kind ?? "dialog"}): interact only with [overlay]/[dismiss] controls inside it. ` +
      `Never dismiss by clicking outside page links. `;
  } else if (ov?.present) {
    overlayInstr =
      ` BLOCKING OVERLAY (${kind ?? "dialog"}): if needed for the goal use [overlay]; otherwise pick in-overlay [dismiss] first. ` +
      `Do not click outside links to close. Do not act as if the overlay is absent. `;
  }

  const mustPickHint = calendarNeedsClose
    ? `A calendar date is already selected but the panel is still open: pick an in-overlay [dismiss]/confirm control — none/abstain is not offered.`
    : mustPickOverlay
      ? `A blocking suggest/calendar overlay is open: pick the best matching [overlay] index — none/abstain is not offered.`
      : `Use none when the goal is done or stuck.`;

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
      ...(calendarDatePicked ? { calendar_date_picked: true } : {}),
      ...(ov?.present
        ? {
            blocking_overlay: {
              present: true,
              kind: ov.kind ?? "dialog",
              expected: ov.expected ?? "unknown",
              ...(ov.isError ? { is_error: true } : {}),
              ...(ov.message ? { message: ov.message.slice(0, 200) } : {}),
              ...(calendarNeedsClose ? { date_picked_needs_close: true } : {}),
            },
          }
        : {}),
    },
    questions: {
      next: {
        type: "choice",
        instructions:
          `Pick the single next SoM index to interact with to advance the goal. ` +
          overlayInstr +
          `Order: prefer the topmost unfinished text field ([empty]) first when no blocking overlay forces dismiss. ` +
          `Fill empty inputs/textareas from state.values; click radios/checkboxes/buttons only when needed. ` +
          `For radio groups: if one option is already [on] and matches state.values (or no other value is required), do NOT click other [off] options — that causes useless flipping. ` +
          `Do not jump to Submit while required fields are still [empty]. ` +
          `Skip [filled]/[on] unless correcting. ` +
          mustPickHint,
        criteria,
      },
    },
  };
}

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

/** Pick which remaining values entry to type into this element.
 * - 0 keys → null
 * - 1 key → that entry (no matching needed)
 * - 多 key → 返回 null，由调用方走 Jev `which_value`（方案 A），勿再靠 key↔标签硬撞
 */
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
  // Multi-value: local key↔label heuristic is unreliable (e.g. origin vs "Where from?").
  // Caller should use buildJevValueDecideRequest + jevDecide.
  void elements;
  void index;
  return null;
}

/** 方案 A：type 且多个 values 时，让 Jev 从候选里选要填的那一条（按 goal + 控件 brief）。 */
export function buildJevValueDecideRequest(input: {
  goal: string;
  url?: string;
  title?: string;
  /** SoM index already chosen for typing */
  index: number;
  elementBrief: string;
  values: Record<string, string>;
  stepIndex?: number;
  maxSteps?: number;
}): JevDecideRequest {
  const values = input.values ?? {};
  const criteria: Record<string, string> = {};
  for (const [key, text] of Object.entries(values)) {
    const t = String(text ?? "").trim();
    if (!t) continue;
    criteria[key] = `Type "${t.slice(0, 80)}" into the field (value key=${key})`;
  }
  criteria.none =
    "No suitable value / field does not need typing / ambiguous — do not type";

  return {
    state: {
      purpose: "act_pick_value",
      goal: input.goal,
      url: input.url,
      title: input.title,
      step: input.stepIndex ?? 1,
      max_steps: input.maxSteps ?? JEV_ACT_LOOP_MAX_STEPS,
      target_index: input.index,
      target_element: input.elementBrief.slice(0, 200),
      values,
    },
    questions: {
      which_value: {
        type: "choice",
        instructions:
          `You already chose SoM index ${input.index} to type into: ${input.elementBrief.slice(0, 160)}. ` +
          `Pick which state.values entry to type into that field to advance the goal. ` +
          `Match by meaning (e.g. origin/from/出发 → Hangzhou; destination/to/到达 → London), ` +
          `not by key spelling. Use none if typing is wrong for this field.`,
        criteria,
      },
    },
  };
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
