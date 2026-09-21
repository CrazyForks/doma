/**
 * Safari 页内壳：MCP / sendToSidePanel 用的宿主 tab 记忆。
 * 独立小模块，避免 safariPanelHost ↔ sendToSidePanel 循环依赖。
 */

let lastMcpHostTabId: number | undefined;
const mcpRequestTabById = new Map<string | number, number>();
const openByTabId = new Map<number, boolean>();

export function noteSafariPanelHostTab(tabId: number): void {
  if (typeof tabId === "number" && Number.isFinite(tabId)) {
    lastMcpHostTabId = tabId;
  }
}

export function rememberSafariMcpRequestTab(
  requestId: string | number | null | undefined,
  tabId: number | undefined,
): void {
  if (typeof tabId !== "number" || !Number.isFinite(tabId)) return;
  lastMcpHostTabId = tabId;
  if (requestId != null) {
    mcpRequestTabById.set(requestId, tabId);
  }
}

/** 解析 MCP 响应应发往的宿主 tab；优先 request id 绑定，否则开着的面板 / 最近 tab */
export function resolveSafariMcpResponseTabId(
  responseId: string | number | null | undefined,
): number | undefined {
  if (responseId != null && mcpRequestTabById.has(responseId)) {
    const tabId = mcpRequestTabById.get(responseId);
    mcpRequestTabById.delete(responseId);
    return tabId;
  }
  for (const [tabId, open] of openByTabId) {
    if (open) return tabId;
  }
  return lastMcpHostTabId;
}

export function setSafariPanelOpenFlag(tabId: number, open: boolean): void {
  openByTabId.set(tabId, open);
}

export function getSafariPanelOpenFlag(tabId: number): boolean {
  return openByTabId.get(tabId) === true;
}

export function safariPanelOpenFlags(): Map<number, boolean> {
  return openByTabId;
}
