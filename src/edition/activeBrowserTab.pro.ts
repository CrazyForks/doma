/**
 * Pro + Safari：页内 iframe 侧栏禁止 tabs.query / windows.*；宿主 tab 由 panelShell + whoami 注入。
 * Chrome/Edge Pro 仍走 windows/tabs。
 */
import { getContext } from "@/services/Context";
import { isSafariBuild } from "@/utils/safariBuild";
import {
  getSafariHostTab,
  listenSafariHostTab,
  type SafariHostTab,
} from "@/services/chat/safariHostTab";

export type BrowserTabLite = {
  id?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
};

export type MentionTabItem = {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active?: boolean;
  windowId?: number;
};

function hostToLite(host: SafariHostTab | null): BrowserTabLite | undefined {
  if (!host?.tabId) return undefined;
  return {
    id: host.tabId,
    title: host.title,
    url: host.url,
    favIconUrl: host.favIconUrl,
  };
}

export function isSafariSidePanelShell(): boolean {
  return isSafariBuild();
}

/** Safari 页内壳：收起/关闭（iframe→父页 postMessage，不依赖 hostTabId）；Chrome Pro 无操作 */
export async function requestCloseSidePanelShell(): Promise<boolean> {
  if (!isSafariBuild()) return false;
  try {
    // 直接通知页内 shell/handle，避免 iframe 侧缺 tabId 时 SW close 失败、状态卡在 open
    window.parent?.postMessage(
      {
        source: "doma-sidepanel",
        operate: "safariPanel/setOpen",
        open: false,
      },
      "*",
    );
  } catch (e) {
    console.warn("[activeBrowserTab] postMessage close failed", e);
  }
  // 再让 content 带 sender.tab 同步 SW Map（best-effort）
  try {
    await getContext().browser.runtime.sendMessage({
      origin: "sidepanel",
      operate: "safariPanel/close",
      ...(typeof getSafariHostTab()?.tabId === "number"
        ? { tabId: getSafariHostTab()!.tabId }
        : {}),
    });
  } catch {
    // postMessage 已足够收起；SW 同步失败不阻塞
  }
  return true;
}

export function initActiveBrowserTabTracking(
  onUpdate?: (tab: BrowserTabLite) => void,
): () => void {
  if (!isSafariBuild()) return () => {};
  return listenSafariHostTab((tab) => {
    const lite = hostToLite(tab);
    if (lite) onUpdate?.(lite);
  });
}

export function getActiveBrowserTabSync(): BrowserTabLite | undefined {
  if (!isSafariBuild()) return undefined;
  return hostToLite(getSafariHostTab());
}

export async function resolveActiveBrowserTab(): Promise<BrowserTabLite | undefined> {
  if (isSafariBuild()) {
    return hostToLite(getSafariHostTab());
  }
  try {
    const w = await getContext().browser.windows.getLastFocused({ populate: true });
    return w.tabs?.find((t: { active?: boolean }) => t.active) as BrowserTabLite | undefined;
  } catch {
    return undefined;
  }
}

export function getCurrentTab(
  callback: (url: string | null, tabId: number | null) => void,
  currentWindow: boolean = true,
): void {
  if (isSafariBuild()) {
    const host = getSafariHostTab();
    callback(host?.url ?? null, host?.tabId ?? null);
    return;
  }
  const query: { active: boolean; currentWindow?: boolean } = { active: true };
  if (currentWindow) query.currentWindow = currentWindow;
  getContext().browser.tabs.query(query, (tabs: Array<{ url?: string; id?: number }>) => {
    callback(tabs.length ? tabs[0].url ?? null : null, tabs.length ? tabs[0].id ?? null : null);
  });
}

export async function listMentionTabs(): Promise<MentionTabItem[]> {
  if (isSafariBuild()) {
    const host = getSafariHostTab();
    if (host?.tabId == null) return [];
    return [
      {
        tabId: host.tabId,
        title: host.title || "",
        url: host.url || "",
        favIconUrl: host.favIconUrl,
        active: true,
        windowId: undefined,
      },
    ];
  }
  const tabs = (await getContext().browser.tabs.query({ currentWindow: true })) as Array<{
    id?: number;
    title?: string;
    url?: string;
    favIconUrl?: string;
    active?: boolean;
    windowId?: number;
    index?: number;
  }>;
  return tabs
    .filter((tab) => typeof tab.id === "number")
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((tab) => ({
      tabId: tab.id as number,
      title: typeof tab.title === "string" ? tab.title : "",
      url: typeof tab.url === "string" ? tab.url : "",
      favIconUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : undefined,
      active: tab.active === true,
      windowId: typeof tab.windowId === "number" ? tab.windowId : undefined,
    }));
}

export function subscribeActiveTabChanges(onChange: () => void): () => void {
  if (isSafariBuild()) {
    // 勿挂 tabs.onActivated / onUpdated（iframe 内会打挂 WebContent）
    void onChange();
    return listenSafariHostTab(() => onChange());
  }
  const browser = getContext().browser;
  const onActivated = () => onChange();
  const onUpdated = () => onChange();
  browser.tabs.onActivated.addListener(onActivated);
  browser.tabs.onUpdated.addListener(onUpdated);
  return () => {
    try {
      browser.tabs.onActivated.removeListener(onActivated);
    } catch {
      /* ignore */
    }
    try {
      browser.tabs.onUpdated.removeListener(onUpdated);
    } catch {
      /* ignore */
    }
  };
}
