/**
 * Pro 侧栏下行：Chrome 用 runtime；Safari 页内壳用 tabs → panelShell → postMessage。
 * Open 构建 alias 到 sendToSidePanel.open.ts。
 */
import { getContext } from "@/services/Context";
import { isSafariBuild } from "@/utils/safariBuild";
import { resolveSafariMcpResponseTabId } from "@/services/chat/safariPanelHostTab";
import {
  sendToSidePanel as sendToSidePanelRuntime,
  type SidePanelOutboundMessage,
  type SendToSidePanelOptions,
} from "./sendToSidePanel.open";

export type { SidePanelOutboundMessage, SendToSidePanelOptions };

function normalizeMessage(message: SidePanelOutboundMessage): SidePanelOutboundMessage {
  return {
    ...message,
    origin: typeof message.origin === "string" ? message.origin : "background",
  };
}

function newRelayRequestId(): string {
  return `spr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Safari：tabs.sendMessage → panelShell 中转；需侧栏回包时由 shell 再 sendResponse */
async function sendToSidePanelViaContentRelay<T = unknown>(
  message: SidePanelOutboundMessage,
  opts?: SendToSidePanelOptions,
): Promise<T | undefined> {
  const browser = getContext().browser as any;
  const payload = normalizeMessage(message);
  const expectResponse = opts?.expectResponse !== false;
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const tabId =
    typeof opts?.tabId === "number"
      ? opts.tabId
      : resolveSafariMcpResponseTabId(
          payload.operate === "mcp/response" ||
            payload.operate === "safariPanel/mcpResponse"
            ? ((payload.jsonrpc as { id?: string | number | null } | undefined)?.id ??
                null)
            : null,
        );

  if (typeof tabId !== "number") {
    console.warn("[sendToSidePanel] Safari relay: no host tabId", {
      operate: payload.operate,
    });
    console.warn("[IDLE-DIAG][sw] sendToSidePanel DROP no hostTabId", {
      operate: payload.operate,
      t: Date.now(),
    });
    return undefined;
  }

  const requestId = newRelayRequestId();
  const t0 = Date.now();
  console.log("[MCP-TRACE][sw] sendToSidePanel → panelShell", {
    operate: payload.operate,
    tabId,
    requestId,
    expectResponse,
  });
  console.log("[IDLE-DIAG][sw] sendToSidePanel START", {
    operate: payload.operate,
    tabId,
    requestId,
    expectResponse,
    t: t0,
  });

  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error(
        `sendToSidePanel Safari relay timeout ${timeoutMs}ms (${payload.operate})`,
      );
      console.warn("[IDLE-DIAG][sw] sendToSidePanel TIMEOUT", {
        operate: payload.operate,
        tabId,
        requestId,
        elapsedMs: Date.now() - t0,
        timeoutMs,
        expectResponse,
      });
      if (expectResponse) reject(err);
      else resolve(undefined);
    }, timeoutMs);

    try {
      browser.tabs.sendMessage(
        tabId,
        {
          origin: "background",
          operate: "safariPanel/sidePanelRelay",
          requestId,
          expectResponse,
          payload,
        },
        (response: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const lastError = browser.runtime.lastError;
          const elapsedMs = Date.now() - t0;
          if (lastError) {
            console.warn("[sendToSidePanel] Safari tabs.sendMessage failed", {
              operate: payload.operate,
              tabId,
              error: lastError.message,
            });
            console.warn("[IDLE-DIAG][sw] sendToSidePanel tabs FAIL", {
              operate: payload.operate,
              tabId,
              error: lastError.message,
              elapsedMs,
            });
            if (expectResponse) {
              reject(new Error(lastError.message || String(lastError)));
            } else {
              resolve(undefined);
            }
            return;
          }
          console.log("[IDLE-DIAG][sw] sendToSidePanel OK", {
            operate: payload.operate,
            tabId,
            requestId,
            elapsedMs,
            expectResponse,
          });
          resolve(response);
        },
      );
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn("[IDLE-DIAG][sw] sendToSidePanel THROW", {
        operate: payload.operate,
        error: e instanceof Error ? e.message : String(e),
        elapsedMs: Date.now() - t0,
      });
      if (expectResponse) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } else {
        resolve(undefined);
      }
    }
  });
}

export async function sendToSidePanel<T = unknown>(
  message: SidePanelOutboundMessage,
  opts?: SendToSidePanelOptions,
): Promise<T | undefined> {
  if (isSafariBuild()) {
    return sendToSidePanelViaContentRelay<T>(message, opts);
  }
  return sendToSidePanelRuntime<T>(message, opts);
}
