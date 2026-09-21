/**
 * SW → 侧栏消息（Open / Chrome Pro：runtime.sendMessage）。
 * Safari 页内壳见 sendToSidePanel.pro.ts。
 */
import { getContext } from "@/services/Context";

export type SidePanelOutboundMessage = Record<string, unknown> & {
  operate: string;
  origin?: string;
};

export type SendToSidePanelOptions = {
  /** 默认 true：等待侧栏回包；false 为火即忘 */
  expectResponse?: boolean;
  timeoutMs?: number;
  /** Safari 宿主 tab；Open 忽略 */
  tabId?: number;
};

function normalizeMessage(message: SidePanelOutboundMessage): SidePanelOutboundMessage {
  return {
    ...message,
    origin: typeof message.origin === "string" ? message.origin : "background",
  };
}

/** Open / 非 Safari：runtime 广播给扩展页侧栏 */
export async function sendToSidePanel<T = unknown>(
  message: SidePanelOutboundMessage,
  opts?: SendToSidePanelOptions,
): Promise<T | undefined> {
  const browser = getContext().browser as any;
  const payload = normalizeMessage(message);
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const expectResponse = opts?.expectResponse !== false;

  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (expectResponse) {
        reject(new Error(`sendToSidePanel timeout ${timeoutMs}ms (${payload.operate})`));
      } else {
        resolve(undefined);
      }
    }, timeoutMs);

    try {
      browser.runtime.sendMessage(payload, (response: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = browser.runtime.lastError;
        if (err) {
          if (expectResponse) {
            reject(new Error(err.message || String(err)));
          } else {
            resolve(undefined);
          }
          return;
        }
        resolve(response);
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (expectResponse) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } else {
        resolve(undefined);
      }
    }
  });
}
