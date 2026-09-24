/**
 * SoM / Jev 共用的阻断层（弹窗、日历面板）信号。
 * 检测在页内 annotate；expected / instruction 在扩展侧按 goal 推断。
 *
 * 诊断日志：Chrome 扩展 Service Worker 控制台过滤 `[DomA:cal]`
 */

export type SomOverlayKind = "dialog" | "calendar" | "sheet" | "suggest";

export type SomOverlayExpected = true | false | "unknown";

export type BlockingOverlayInfo = {
  present: boolean;
  kind?: SomOverlayKind;
  /** 相对本步 goal：是否像「就在层内完成」 */
  expected?: SomOverlayExpected;
  /** 层内可读文案（错误提示等），供模型改行为 */
  message?: string;
  /** 校验/错误类弹窗：关窗后必须按 message 修正，禁止无视后继续原操作 */
  isError?: boolean;
  /** suggest 层：刚输入/待匹配的针（供 instruction；可选） */
  suggestNeedle?: string;
};

/** 页内 annotate 带回的根层摘要（只打日志，勿塞进 LLM 返回） */
export type CalOverlayRootDebug = {
  kind: SomOverlayKind;
  tag: string;
  role: string;
  cls: string;
  z: number;
  w: number;
  h: number;
  dateCellApprox: number;
};

/** Service Worker / 背景页过滤：`[DomA:cal]`（暂时关闭，需要时恢复 console.log） */
export function logCal(_event: string, _data?: Record<string, unknown>): void {
  /* muted */
}

type SomElBrief = {
  i?: number;
  tx?: string;
  al?: string;
  fl?: string;
  tg?: string;
  ov?: boolean;
  ds?: boolean;
  tp?: string;
};

function elLooksDateCell(e: SomElBrief): boolean {
  const blob = `${e.tx ?? ""} ${e.al ?? ""} ${e.fl ?? ""}`.trim();
  if (!blob) return false;
  // 纯日数字、或含日期感的 aria
  if (/^\d{1,2}$/.test(blob)) return true;
  if (/^\d{1,2}\D/.test(blob) && blob.length <= 16) return true; // 23¥282K 等
  if (/\d{4}[-/.年]\d{1,2}|月\d{1,2}|day|日期|September|October|November|December|January|February|March|April|August/i.test(blob)) {
    return true;
  }
  if (/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(blob)) {
    return true;
  }
  return false;
}

/** 从 SoM elements 抽日历相关摘要，便于对照国航现场 */
export function summarizeCalSom(elements: unknown[], limit = 24): Record<string, unknown> {
  const list = (Array.isArray(elements) ? elements : []) as SomElBrief[];
  const ov = list.filter((e) => e.ov === true);
  const ds = list.filter((e) => e.ds === true);
  const dateLike = list.filter((e) => e.ov === true && elLooksDateCell(e));
  const sample = (arr: SomElBrief[], n: number) =>
    arr.slice(0, n).map((e) => ({
      i: e.i,
      tg: e.tg,
      tx: (e.tx ?? "").slice(0, 24),
      al: (e.al ?? "").slice(0, 40),
      ov: e.ov === true,
      ds: e.ds === true,
    }));
  return {
    total: list.length,
    ovCount: ov.length,
    dsCount: ds.length,
    dateLikeInOverlay: dateLike.length,
    ovSample: sample(ov, limit),
    dsSample: sample(ds, 12),
    dateLikeSample: sample(dateLike, limit),
  };
}

export function logCalOverlaySnapshot(args: {
  where: string;
  goal: string;
  values?: Record<string, string>;
  overlay: BlockingOverlayInfo;
  elements: unknown[];
  roots?: CalOverlayRootDebug[];
  extra?: Record<string, unknown>;
}): void {
  const wantsCal = goalWantsCalendar(args.goal, args.values);
  logCal(args.where, {
    goal: args.goal.slice(0, 120),
    valueKeys: Object.keys(args.values ?? {}),
    wantsCalendar: wantsCal,
    overlay: {
      present: args.overlay.present,
      kind: args.overlay.kind ?? null,
      expected: args.overlay.expected ?? null,
      isError: args.overlay.isError === true,
      message: args.overlay.message ? args.overlay.message.slice(0, 120) : null,
    },
    roots: args.roots ?? null,
    som: summarizeCalSom(args.elements),
    ...(args.extra ?? {}),
  });
}

/** goal/values 是否像需要选日期 / 订票时间 */
export function goalWantsCalendar(goal: string, values?: Record<string, string>): boolean {
  const blob = `${goal} ${JSON.stringify(values ?? {})}`;
  return /日期|日历|选日|date\b|calendar|datepicker|出发日期|返程|train_date|明天|今天|后天|大后天|周[一二三四五六日天]|上午|下午|晚上|\d{1,2}\s*月|\d{4}[-/.年]\d{1,2}|机票|航班|订票|购票|起飞|飞往|登机/i.test(
    blob,
  );
}

/** 文案是否像校验/错误弹窗（未选择、请填写、错误…） */
export function looksErrorOverlayText(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return /错误|失败|无效|不能为空|未选择|请选择|请填写|请输入|必填|不完整|校验|alert|error|invalid|required|must\s+select|please\s+(select|enter|fill)/i.test(
    t,
  );
}

/** 合并页内 annotate 结果 + goal 推断，得到完整 BlockingOverlayInfo */
export function finalizeBlockingOverlay(
  raw: {
    present?: boolean;
    kind?: SomOverlayKind;
    message?: string;
    isError?: boolean;
  } | null | undefined,
  goal: string,
  values?: Record<string, string>,
): BlockingOverlayInfo {
  if (!raw?.present) return { present: false };
  const message = typeof raw.message === "string" ? raw.message.trim().slice(0, 240) : undefined;
  const kind = raw.kind;
  // suggest 层文案是选项列表，勿当成校验错误
  const isError =
    kind !== "suggest" &&
    (raw.isError === true || (!!message && looksErrorOverlayText(message)));
  return {
    present: true,
    kind,
    message: message || undefined,
    isError: isError || undefined,
    expected: inferOverlayExpected(goal, values, kind, { isError, message }),
  };
}

/** goal/values 是否像需要层内交互 */
export function inferOverlayExpected(
  goal: string,
  values: Record<string, string> | undefined,
  kind: SomOverlayKind | undefined,
  opts?: { isError?: boolean; message?: string },
): SomOverlayExpected {
  const blob = `${goal} ${JSON.stringify(values ?? {})}`;
  const wantsCalendar = goalWantsCalendar(goal, values);
  const wantsDialog =
    /确认|同意|弹窗|对话框|modal|dialog|登录|验证码|验证|alert|prompt/i.test(blob);
  const wantsStation = /选站|车站|出发地|到达地|city|station|机场/i.test(blob);
  const looksJunkOnly =
    /cookie|隐私政策|广告|关闭广告|订阅|newsletter/i.test(blob) &&
    !wantsCalendar &&
    !wantsDialog &&
    !wantsStation;

  // 错误/校验弹窗：需要先关，但不是「无关 junk」——expected=false 仍关，instruction 会要求读懂后改行为
  if (opts?.isError || (opts?.message && looksErrorOverlayText(opts.message))) {
    return false;
  }

  // 日历 / 输入建议层：打开后默认就在层内完成，不要判成「先关掉」
  if (kind === "calendar" || kind === "suggest") {
    if (looksJunkOnly) return false;
    return true;
  }

  if (kind === "dialog" && wantsCalendar) return true;
  if (kind === "dialog" && (wantsDialog || wantsStation)) return true;
  if (kind === "sheet" && (wantsDialog || wantsStation || wantsCalendar)) return true;

  if (!wantsCalendar && !wantsDialog && !wantsStation) return false;
  return "unknown";
}

/** 建议项文案与 needle（刚输入/出发地等）的粗匹配分，越高越像该点的选项 */
export function scoreSuggestOptionMatch(needle: string, optionText: string): number {
  const n = (needle || "").trim().toLowerCase();
  const t = (optionText || "").trim().toLowerCase();
  if (!n || !t) return 0;
  if (t === n) return 100;
  if (t.startsWith(n) || n.startsWith(t)) return 80;
  if (t.includes(n) || n.includes(t)) return 60;
  // 去掉空白再比
  const nn = n.replace(/\s+/g, "");
  const tt = t.replace(/\s+/g, "");
  if (tt.includes(nn) || nn.includes(tt)) return 50;
  return 0;
}

/** 层内可点的建议项数量（option / li / menuitem） */
export function countOverlaySuggestOptions(elements: unknown[]): number {
  let n = 0;
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomElBrief & { rl?: string; tg?: string };
    if (e.ov !== true || e.ds === true) continue;
    const rl = typeof e.rl === "string" ? e.rl.toLowerCase() : "";
    const tg = typeof e.tg === "string" ? e.tg.toLowerCase() : "";
    if (rl === "option" || tg === "li" || rl === "menuitem") n++;
  }
  return n;
}

/** 层内像日期格子的数量（用于区分日历 vs 空 suggest） */
export function countOverlayDateCells(elements: unknown[]): number {
  let n = 0;
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomElBrief & { rl?: string };
    if (e.ov !== true || e.ds === true) continue;
    const rl = typeof e.rl === "string" ? e.rl.toLowerCase() : "";
    if (rl === "gridcell" || rl === "option") {
      if (rl === "gridcell") {
        n++;
        continue;
      }
    }
    if (elLooksDateCell(e)) n++;
  }
  return n;
}

/**
 * 已有 overlay、但还没有可点 option：壳可能刚开，listbox 稍后才挂上。
 * 短轮询再 annotate；日历/错误层 / 已是密日期格 不等。
 */
export function overlayMayBecomeSuggest(
  overlay: BlockingOverlayInfo,
  elements: unknown[],
): boolean {
  if (!overlay.present || overlay.isError) return false;
  if (overlay.kind === "calendar") return false;
  // 已是日历格密布：别空等 option（否则会把日期层拖成 suggest 等待）
  if (countOverlayDateCells(elements) >= 8) return false;
  if (countOverlaySuggestOptions(elements) >= 1) return false;
  return true;
}

/** SoM 侧纠正：日期格很多时 kind 不得停在 suggest */
export function coerceOverlayKindFromElements(
  overlay: BlockingOverlayInfo,
  elements: unknown[],
): BlockingOverlayInfo {
  if (!overlay.present) return overlay;
  const dateCells = countOverlayDateCells(elements);
  const opts = countOverlaySuggestOptions(elements);
  if (dateCells >= 8 && opts < 2 && overlay.kind !== "calendar") {
    return { ...overlay, kind: "calendar" };
  }
  return overlay;
}

/** 在 SoM elements 里找最像 needle 的 [overlay] 建议项 index */
export function findBestSuggestOptionIndex(
  elements: unknown[],
  needle: string,
  minScore = 50,
): { index: number; score: number; brief: string } | null {
  const n = (needle || "").trim();
  if (!n) return null;
  let best: { index: number; score: number; brief: string } | null = null;
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as SomElBrief & { rl?: string; tg?: string };
    if (e.ov !== true || e.ds === true) continue;
    const rl = typeof e.rl === "string" ? e.rl.toLowerCase() : "";
    const tg = typeof e.tg === "string" ? e.tg.toLowerCase() : "";
    const blob = `${e.al ?? ""} ${e.tx ?? ""} ${e.fl ?? ""}`.trim();
    if (!blob || blob.length < 2) continue;
    if (/select multiple|multiple airports|换一批|清除|close|关闭/i.test(blob)) continue;
    const isOption = rl === "option" || tg === "li" || rl === "menuitem";
    // 非 option 也可匹配，但降权
    const score =
      scoreSuggestOptionMatch(n, blob) + (isOption ? 10 : 0) + (rl === "option" ? 10 : 0);
    if (score < minScore) continue;
    const i = typeof e.i === "number" ? e.i : Number(e.i);
    if (!Number.isFinite(i) || i < 1) continue;
    if (!best || score > best.score) {
      best = { index: i, score, brief: blob.slice(0, 80) };
    }
  }
  return best;
}

/** LLM SoM：有层时才写 instruction，禁止无条件「必须关闭」 */
export function buildOverlayInstruction(overlay: BlockingOverlayInfo): string | null {
  if (!overlay.present) return null;
  const kind = overlay.kind ?? "dialog";
  const dismissHint =
    `关层优先点层内 [dismiss]（×/关闭/取消/确定）；` +
    `没有层内关闭钮时不要点外面链接/正文（非模态易误跳转），可放弃或试 Escape。`;

  if (overlay.isError && overlay.message) {
    return (
      `当前有错误/校验弹窗：文案「${overlay.message}」。` +
      `请先读懂含义，再点层内 [dismiss]（确定/×）关闭；` +
      `关闭后必须按该错误修正页面（例如补选出发城市），禁止关掉后无视提示继续原操作。` +
      dismissHint
    );
  }
  if (overlay.isError) {
    return (
      `当前有错误/校验弹窗：先读层内提示文案，再点 [dismiss] 关闭，` +
      `随后按提示修正表单，禁止只关窗不改行为。${dismissHint}`
    );
  }

  if (kind === "calendar" && overlay.expected !== false) {
    return (
      `当前有日期选择层（calendar）：请在层内点击目标日期格子（[overlay]）；` +
      `选对日期前不要点 [dismiss] 关闭。${dismissHint}`
    );
  }
  if (kind === "suggest" && overlay.expected !== false) {
    const needle = overlay.suggestNeedle?.trim();
    return (
      `当前有输入建议/自动完成层（suggest，如 listbox+option）：` +
      `请在层内点击与输入最接近的选项（[overlay]，常见 role=option / aria-label 含城市或机场名）` +
      (needle ? `；优先匹配「${needle}」` : "；优先匹配刚输入或 goal/values 中的地名") +
      `。不要点「Select multiple airports」类开关说明，不要点层外链接，选对前不要 [dismiss]。`
    );
  }
  if (overlay.expected === true) {
    return (
      `当前有阻断层（${kind}），且像本步目标所需：只在带 [overlay] 的层内操作；` +
      `完成后如需再关：${dismissHint}`
    );
  }
  if (overlay.expected === false) {
    return (
      `当前有非目标阻断层（${kind}）：${dismissHint}` +
      `关掉后再继续原 goal。`
    );
  }
  return (
    `当前有阻断层（${kind}）：若为本步所需则在 [overlay] 内完成；否则 ${dismissHint}`
  );
}

/** Jev / 工具返回：错误弹窗关掉后应如何提示主模型 */
export function buildErrorOverlayFollowupHint(overlay: BlockingOverlayInfo): string | null {
  if (!overlay.present || !overlay.isError) return null;
  const msg = overlay.message?.trim();
  return (
    `error overlay: ${msg ? `「${msg}」` : "validation/error dialog"}. ` +
    `Dismissed or needs dismiss — do NOT repeat the same query/submit. ` +
    `Re-plan: fix the issue named in the message (e.g. select departure city), then continue.`
  );
}
