/**
 * 诊断侧栏空闲后发消息无响应：SW 是否挂起、投递是否超时。
 * 控制台过滤：`[IDLE-DIAG]`
 */
import { getContext } from "@/services/Context";

const PING_OPERATE = "sw/ping";
const PING_TIMEOUT_MS = 5_000;

let lastPanelActivityAt = Date.now();
let lastSuccessfulSwPingAt = 0;

export function notePanelActivity(reason: string): void {
  lastPanelActivityAt = Date.now();
  console.log("[IDLE-DIAG][panel] activity", {
    reason,
    t: lastPanelActivityAt,
  });
}

export function panelIdleMs(): number {
  return Date.now() - lastPanelActivityAt;
}

export type SwPingResult = {
  ok: boolean;
  elapsedMs: number;
  idleMs: number;
  error?: string;
  swAliveAt?: number;
  via?: string;
};

/** 侧栏 → SW 轻量 ping；超时多半是 SW 挂起未及时唤醒 */
export async function pingServiceWorker(reason: string): Promise<SwPingResult> {
  const idleMs = panelIdleMs();
  const t0 = Date.now();
  console.log("[IDLE-DIAG][panel] sw/ping START", {
    reason,
    idleMs,
    lastSuccessfulSwPingAt: lastSuccessfulSwPingAt || null,
    t: t0,
  });

  try {
    const browser = getContext().browser as any;
    const res = await Promise.race([
      new Promise<unknown>((resolve, reject) => {
        try {
          browser.runtime.sendMessage(
            { origin: "sidepanel", operate: PING_OPERATE, reason, t: t0 },
            (response: unknown) => {
              const err = browser.runtime.lastError;
              if (err) {
                reject(new Error(err.message || String(err)));
                return;
              }
              resolve(response);
            },
          );
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`sw/ping timeout ${PING_TIMEOUT_MS}ms (SW suspended?)`)),
          PING_TIMEOUT_MS,
        ),
      ),
    ]);

    const elapsedMs = Date.now() - t0;
    const ok =
      !!res &&
      typeof res === "object" &&
      (res as { ok?: boolean }).ok === true;
    if (ok) lastSuccessfulSwPingAt = Date.now();
    const out: SwPingResult = {
      ok,
      elapsedMs,
      idleMs,
      via: typeof (res as { via?: string })?.via === "string" ? (res as { via: string }).via : undefined,
      swAliveAt:
        typeof (res as { swAliveAt?: number })?.swAliveAt === "number"
          ? (res as { swAliveAt: number }).swAliveAt
          : undefined,
      error: ok ? undefined : `unexpected ping response: ${JSON.stringify(res)}`,
    };
    console.log(
      ok ? "[IDLE-DIAG][panel] sw/ping OK" : "[IDLE-DIAG][panel] sw/ping BAD",
      out,
    );
    if (elapsedMs > 800) {
      console.warn("[IDLE-DIAG][panel] sw/ping SLOW — likely SW cold start after suspend", out);
    }
    return out;
  } catch (e) {
    const elapsedMs = Date.now() - t0;
    const error = e instanceof Error ? e.message : String(e);
    const out: SwPingResult = { ok: false, elapsedMs, idleMs, error };
    console.warn("[IDLE-DIAG][panel] sw/ping FAIL", out);
    return out;
  }
}

export function logIdleDiag(
  where: string,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  console.log(`[IDLE-DIAG][${where}] ${msg}`, {
    idleMs: panelIdleMs(),
    t: Date.now(),
    ...extra,
  });
}
