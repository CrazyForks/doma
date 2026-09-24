/**
 * Agent text-only 回收：模型口头要操作却未发 tool_call 时，最多强制补一轮。
 * - Jev 关：中英词表判断是否像「预告操作」
 * - Jev 开：单独 decide（与 screenshot SoM 无关）判 force|done
 */

import {
  isJevConfigured,
  loadJevConfig,
} from "../jev/jevConfig";
import { jevDecide, type JevChoiceAnswer } from "../jev/jevClient";
import { JEV_ACT_MIN_P_TARGET } from "../jev/jevSomAdapter";
import { isAskModeRound } from "./askModeToolPolicy";
import type { ConversationMessage } from "./llmTypes";

/** 每个 conversation 本 user 回合是否已做过 text-only 回收 */
const recoveredThisUserTurn = new Map<string, boolean>();

export function clearTextOnlyToolRecovery(conversationId: string): void {
  recoveredThisUserTurn.delete(conversationId);
}

export function markTextOnlyToolRecoveryUsed(conversationId: string): void {
  recoveredThisUserTurn.set(conversationId, true);
}

export function hasTextOnlyToolRecoveryUsed(conversationId: string): boolean {
  return recoveredThisUserTurn.get(conversationId) === true;
}

/** 像终局 / 等用户，不要强制 tool */
const LOOKS_DONE_RE =
  /已完成|做完了|完成了|任务结束|需要你|请你|麻烦你|登录|验证码|验证|无法继续|请切换|ask\s*模式|done\.?\s*$|completed|finished|please (log\s*in|sign\s*in)|need you to|waiting for you/i;

/** 像预告下一步操作（中英），应强制 tool */
const LOOKS_STALL_RE =
  /截图|先看|看一下|看看页面|获取页面|让我|我来|我需要|下一步|正在|先获取|先确认|继续操作|screenshot|take a (look|screenshot)|let me |i('ll| will) |next step|check (the )?page|going to |need to (see|check|look|capture)/i;

export function assistantTextLooksLikeStall(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (LOOKS_DONE_RE.test(t) && !LOOKS_STALL_RE.test(t)) return false;
  if (LOOKS_DONE_RE.test(t) && LOOKS_STALL_RE.test(t)) {
    // 两头都像：偏终局（含「需要你登录」等）
    if (/需要你|请你|登录|验证码|please (log|sign)|need you to/i.test(t)) {
      return false;
    }
  }
  return LOOKS_STALL_RE.test(t);
}

export function buildToolRecoveryNudgeMessage(): string {
  return (
    `<interactionBlock>\n<doma/>\n</interactionBlock>` +
    "Previous assistant reply had no tool call. " +
    "If the task still needs a page action, you MUST call a tool now. " +
    "If the task is already done, reply with one short final answer only.\n" +
    "上一轮未调用工具。若仍需操作页面，必须立即发起 tool call；若已完成，仅用一句话结论结束。"
  );
}

async function jevShouldForceTool(
  assistantText: string,
  signal?: AbortSignal,
): Promise<boolean | null> {
  const cfg = await loadJevConfig();
  if (!cfg.enabled || !isJevConfigured(cfg)) return null;
  try {
    const decided = await jevDecide(
      {
        model: cfg.model,
        state: {
          purpose: "tool_gate",
          assistant_text: assistantText.slice(0, 600),
        },
        questions: {
          gate: {
            type: "choice",
            instructions:
              "The main LLM replied with text only (no tool call). " +
              "Pick force if it is announcing/planning a page action (screenshot, click, type, continue) and should have called a tool. " +
              "Pick done if it is a final answer, asking the user, or waiting for login/captcha. " +
              "Pick none if unclear.",
            criteria: {
              force:
                "Still needs page action; force a tool call this turn",
              done: "Finished or waiting on user; do not force tools",
              none: "Unclear",
            },
          },
        },
      },
      { config: cfg, signal },
    );
    const ans = decided.answers?.gate as JevChoiceAnswer | undefined;
    if (!ans || ans.type !== "choice") return null;
    const choice = String(ans.choice ?? "");
    const pTarget =
      choice && choice !== "none"
        ? Number(ans.probabilities?.[choice]) || 0
        : Number(ans.probabilities?.none) || 0;
    const minP = JEV_ACT_MIN_P_TARGET;
    console.log("[tool-recovery] jev-gate", {
      choice,
      pTarget,
      minP,
      confidence: ans.confidence,
    });
    if (choice === "force" && pTarget >= minP) return true;
    if (choice === "done" && pTarget >= minP) return false;
    return null;
  } catch (e) {
    console.warn("[tool-recovery] jev-gate failed", e);
    return null;
  }
}

/**
 * 是否应对本轮 text-only 做 tool_choice=required 回收。
 */
export async function shouldForceToolRecovery(input: {
  conversationId: string;
  history: ConversationMessage[];
  assistantText: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const text = input.assistantText.trim();
  if (!text) return false;
  if (hasTextOnlyToolRecoveryUsed(input.conversationId)) return false;
  if (isAskModeRound(input.history)) return false;

  const cfg = await loadJevConfig();
  const jevOn = !!cfg.enabled && isJevConfigured(cfg);

  if (jevOn) {
    const jev = await jevShouldForceTool(text, input.signal);
    if (jev === true) return true;
    if (jev === false) return false;
    // Jev 不确定 / 失败 → 回退词表
  }

  const stall = assistantTextLooksLikeStall(text);
  console.log("[tool-recovery] lang-gate", { stall, jevOn, textLen: text.length });
  return stall;
}
