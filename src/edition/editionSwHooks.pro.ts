/**
 * Pro 版别 SW 钩子：userScripts / RuleTag、视频下载消息、plugin init、广告 activate、视频 sniff。
 * Open 构建 alias 到 editionSwHooks.open.ts。
 */
import { getContext } from '@/services/Context';
import { STUserManager, DOMA_USER_SNAPSHOT_KEY } from '@/services/STUserManager';
import { GMAPIHandler } from '@/services/extension/GMAPIHandler';
import { RuleTagManager } from '@doma/pro/extension/RuleTagHandler';
import { UserscriptHandler } from '@doma/pro/extension/UserscriptHandler';
import { videoDownloader, adBlocker } from '@doma/pro/instances';
import { getHostname } from '@/utils/url';
import type { ServiceWorkerBackgroundContext } from '@/pro/types';
import type { EditionSwMessageHandler } from './editionSwHooksTypes';
import { isSafariBuild } from '@/utils/safariBuild';
import {
  tryHandleSafariPanelSwMessage,
  toggleSafariPanel,
  ensureSafariPanelReady,
  getSafariPanelOpen,
} from '@/services/chat/safariPanelHost';
import { panelReloadLog } from '@/services/chat/swLogBridge';
import {
  configureGlobalSidePanel as configureChromeSidePanel,
  registerNativeSidePanelListeners as registerChromeSidePanelListeners,
  handleBrowserActionClicked as handleChromeActionClicked,
} from '@/edition/chromeSidePanel';

const userscriptHandler = new UserscriptHandler();
const gmApiHandler = new GMAPIHandler();

function backToCurrentTab(tabId: number) {
  if (tabId && tabId > 0) {
    getContext().browser.tabs.update(tabId, { active: true });
  }
}

async function relayDomaAgentAuthorize(request: {
  accountInfo?: unknown;
  device?: unknown;
  type?: unknown;
}): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const isSuccess = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        getContext().browser.runtime.sendMessage(
          {
            origin: 'background',
            operate: 'domaAgentAuthorize',
            accountInfo: request.accountInfo,
            device: request.device,
            type: request.type,
          },
          (res: { success?: boolean } | undefined) => {
            clearTimeout(timer);
            resolve(!!(res && res.success));
          },
        );
      }, 300);
    });
    if (isSuccess) break;
  }
}

function isUserScriptsSupported(): boolean {
  try {
    getContext().browser.userScripts;
    return getContext().browser.userScripts != undefined;
  } catch {
    return false;
  }
}

async function fetchURLContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (response.ok) {
    return response.text();
  }
  return '';
}

async function safeRegisterUserScript(script: unknown[]): Promise<void> {
  const registeredScripts = await getContext().browser.userScripts.getScripts();
  if (registeredScripts && registeredScripts.length > 0) {
    const ids = registeredScripts.map((s: { id: string }) => s.id);
    console.log('unregister scripts============', ids);
    await getContext().browser.userScripts.unregister({ ids });
  }
  console.log('register scripts============', script);
  await getContext().browser.userScripts.register(script);
}

async function registerEditionUserScripts(
  listener: ServiceWorkerBackgroundContext['listener'],
): Promise<void> {
  try {
    RuleTagManager.getInstance().reload();

    if (isUserScriptsSupported()) {
      getContext().browser.userScripts.configureWorld({
        csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        messaging: true,
      });

      const contentJs = await fetchURLContent(
        getContext().browser.runtime.getURL('source/content.js'),
      );
      const snifferJs = await fetchURLContent(
        getContext().browser.runtime.getURL('source/inject/sniffer.app.v3.js'),
      );
      await safeRegisterUserScript([
        {
          allFrames: true,
          id: 'stay_content',
          matches: ['<all_urls>'],
          runAt: 'document_start',
          world: 'USER_SCRIPT',
          js: [
            {
              code: contentJs,
            },
            {
              code: snifferJs,
            },
          ],
        },
      ]);
    }
  } catch (e) {
    console.error('userScripts error', e);
  }

  if (isUserScriptsSupported()) {
    getContext().browser.runtime.onUserScriptMessage.addListener(listener);
  }
}

export const tryHandleEditionSwMessage: EditionSwMessageHandler = (
  request,
  sender,
  sendResponse,
) => {
  if (tryHandleSafariPanelSwMessage(request, sender, sendResponse)) {
    return true;
  }
  const operate = request.operate ?? '';
  const origin = request.origin ?? '';

  if (operate === 'background/v3/switchUser') {
    void (async () => {
      try {
        const snap = request.snapshot;
        if (snap && typeof snap === 'object' && typeof snap.uuid === 'string') {
          await getContext().browser.storage.local.set({
            __doma_around_: snap.proType && snap.proType === 'lifetime' ? 'a' : 'b',
            __doma_user_id_: snap.uuid,
            mobile_doma_user_id_: snap.uuid,
            [DOMA_USER_SNAPSHOT_KEY]: snap,
          });
          await STUserManager.get().applyRemoteSnapshot(snap);
        } else {
          await STUserManager.get().reloadUserFromDisk();
        }
      } catch (e) {
        console.warn('[editionSw] switchUser failed', e);
      }
      try {
        sendResponse({ success: true });
      } catch {
        /* channel may be closed */
      }
    })();
    return true;
  }

  if (operate.startsWith('background/v3/gmapi')) {
    gmApiHandler.run(request, sender, sendResponse, getContext());
    return true;
  }

  if (operate.startsWith('login') && origin === 'content') {
    const tabId = request.tabId ? Number(request.tabId) : 0;
    if (operate === 'login/domaAgentAuthorize') {
      backToCurrentTab(tabId);
      void relayDomaAgentAuthorize(request);
      return true;
    }
    if (operate === 'login/backToDomaAgent') {
      backToCurrentTab(tabId);
      return true;
    }
  }

  if (operate.startsWith('downloader/agent')) {
    console.log('downloader/agent----receive message', request, sender);
    videoDownloader.handleDownloaderAgent?.(request, sender, sendResponse, getContext());
    return true;
  }
  if (operate.startsWith('userscript')) {
    userscriptHandler.handle(request, sender, sendResponse, getContext());
    return true;
  }
  if (operate.startsWith('ruleTag')) {
    RuleTagManager.getInstance().handle(request, sender, sendResponse, getContext());
    return true;
  }
  return false;
};

/** 对齐原 run() 前半段：在 onMessage 之前 — RuleTag reload + userScripts + onUserScriptMessage */
export async function registerEditionEarly(
  ctx: ServiceWorkerBackgroundContext,
): Promise<void> {
  await registerEditionUserScripts(ctx.listener);
}

/** 对齐原 run() 后半段：在 onMessage 之后 — plugin initBackground */
export async function initEditionBackground(
  ctx: ServiceWorkerBackgroundContext,
): Promise<void> {
  await videoDownloader.initBackground(ctx);
  await adBlocker.initBackground(ctx);
}

/** 注入到页面 MAIN world：采集站点 window 上的视频相关状态 */
function toTransferWinData() {
  function pickSerializableObject(
    value: any,
    depth = 0,
    seen = new WeakSet<object>(),
  ): any {
    if (depth > 12 || value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      return value;
    }

    if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
      return undefined;
    }

    if (valueType !== 'object') {
      return undefined;
    }

    if (typeof Node !== 'undefined' && value instanceof Node) {
      return undefined;
    }

    if (typeof Window !== 'undefined' && value instanceof Window) {
      return undefined;
    }

    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const list: any[] = [];
      for (const item of value) {
        const safeItem = pickSerializableObject(item, depth + 1, seen);
        if (safeItem !== undefined) {
          list.push(safeItem);
        }
      }
      return list;
    }

    const result: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      const safeValue = pickSerializableObject(value[key], depth + 1, seen);
      if (safeValue !== undefined) {
        result[key] = safeValue;
      }
    }

    return Object.keys(result).length ? result : undefined;
  }

  (async function () {
    console.log('document.readyState----', document.readyState);
    const hostName = window.location.hostname;
    if (
      !hostName.includes('youtube.com') &&
      !hostName.includes('pornhub.com') &&
      !hostName.includes('baidu.com') &&
      !hostName.includes('weibo.cn') &&
      !hostName.includes('bilibili.com') &&
      !hostName.includes('iqiyi.com') &&
      !hostName.includes('v.qq.com')
    ) {
      return;
    }
    const win = window as any;
    const getBody = () => ({
      ytVideoCaption: win.ytVideoCaption || '',
      iqiyiSubtitleManifest: win.iqiyiSubtitleManifest || '',
      iqiyiVideoCaption: win.iqiyiVideoCaption || '',
      __VINFO_DATA__: pickSerializableObject(win.__VINFO_DATA__) || '',
      webPlay: pickSerializableObject(win.webPlay) || '',
      __lastAccJson: pickSerializableObject(win.__lastAccJson) || '',
      ytplayer: win.ytplayer
        ? {
            bootstrapPlayerResponse: win.ytplayer?.bootstrapPlayerResponse || '',
            bootstrapWebPlayerContextConfig:
              win.ytplayer?.bootstrapWebPlayerContextConfig || '',
          }
        : '',
      ytInitialData: win.ytInitialData || '',
      yt: win.yt ? { config_: win.yt?.config_ || '' } : '',
      VIDEO_SHOW: win.VIDEO_SHOW || '',
      PAGE_DATA: win.PAGE_DATA || '',
      __PRELOADED_STATE__: win.__PRELOADED_STATE__ || '',
      $render_data: win.$render_data || '',
      __INITIAL_STATE__: win.__INITIAL_STATE__ || '',
      __PLAYURL_HYDRATE_DATA__: win.__PLAYURL_HYDRATE_DATA__ || '',
      __playinfo__: win.__playinfo__ || '',
      jsonData: win.jsonData || '',
      stay_faviconUrl: win.stay_faviconUrl || '',
      player: win.player?.config
        ? {
            config: {
              aid: win.player?.config?.aid || '',
              bvid: win.player?.config?.bvid || '',
              cid: win.player?.config?.cid || '',
              poster: win.player?.config?.poster || '',
              readyVideoUrl: win.player?.config?.readyVideoUrl || '',
            },
            store: {
              user: win.win?.store?.user || '',
              state: win.win?.store?.state?.video
                ? { video: win.player?.store?.state?.video || '' }
                : '',
            },
          }
        : '',
    });

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data.operate === 'page_window_value' && event.data.type === 'req') {
        console.log('Received windowValue:', event.data.body);
        window.postMessage({
          operate: 'page_window_value',
          pid: event.data.pid,
          type: 'resp',
          body: getBody(),
        });
      }
    });

    if (document.readyState == 'interactive') {
      console.log(
        'toTransferWinData--sendMessage----',
        new Date().getTime(),
        document.readyState,
        getBody(),
      );
      window.postMessage({
        name: 'transfer/windowValue',
        body: getBody(),
      });
    } else {
      document.addEventListener('readystatechange', () => {
        console.log('content-utils-----readystatechange=', document.readyState);
        if (document.readyState == 'complete') {
          window.postMessage({
            name: 'transfer/windowValue',
            body: getBody(),
          });
        }
      });
    }
  })();
}

async function notSupportUserscript(tabId: number) {
  const tab = await getContext().browser.tabs.get(tabId);
  const url = tab?.url || '';

  if (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('safari://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('safari-web-extension://') ||
    url.startsWith('safari-extension://')
  ) {
    console.log('skip restricted page:', url);
    return true;
  }
  return false;
}

/** Safari：manifest 已 content_scripts 注入 panelShell；此处仅作偶发未注入时的兜底 */
async function injectSafariPanelContentScripts(tabId: number): Promise<void> {
  if (!isSafariBuild()) return;
  if (await notSupportUserscript(tabId)) return;
  try {
    console.log('[doma-safari] scripting fallback inject panelShell', tabId);
    await getContext().browser.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['source/inject/panelShell.js'],
    });
  } catch (err) {
    console.warn('[doma-safari] scripting inject failed', tabId, err);
  }
}

async function scriptingToFetchWindowParams(tabId: number, _favicon: string) {
  console.log('scriptingToFetchWindowParams for agent', tabId);
  if (await notSupportUserscript(tabId)) {
    return;
  }
  await getContext().browser.scripting.executeScript({
    target: {
      tabId: tabId,
      allFrames: false,
    },
    world: 'MAIN',
    func: toTransferWinData,
  });
}

async function scriptingToListeningTimedtext(tabId: number) {
  console.log('scriptingToListeningTimedtext for agent', tabId);
  if (await notSupportUserscript(tabId)) {
    return;
  }
  await getContext().browser.scripting.executeScript({
    target: {
      tabId: tabId,
      allFrames: false,
    },
    world: 'MAIN',
    files: ['source/inject/yt.hook.js'],
  });
}

export async function configureGlobalSidePanel(enabled: boolean): Promise<void> {
  if (isSafariBuild()) return;
  await configureChromeSidePanel(enabled);
}

export function registerNativeSidePanelListeners(opts: {
  onOpened: () => void;
  onClosed: () => void;
}): void {
  if (isSafariBuild()) return;
  registerChromeSidePanelListeners(opts);
}

export function handleBrowserActionClicked(
  tab: { id?: number; windowId?: number },
  state: {
    showSidePanel: boolean;
    setShowSidePanel: (open: boolean) => void;
  },
): void {
  if (isSafariBuild()) {
    void (async () => {
      panelReloadLog("action", "onClicked → handleBrowserActionClicked", {
        tabId: tab?.id,
        windowId: tab?.windowId,
        t: Date.now(),
      });
      let tabId = tab?.id;
      if (tabId == null) {
        try {
          const tabs = await getContext().browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          tabId = tabs?.[0]?.id;
          panelReloadLog("action", "resolved active tab", { tabId });
        } catch (e) {
          panelReloadLog("action", "query tab failed", {
            err: String((e as Error)?.message || e),
          });
        }
      }
      if (tabId == null) {
        panelReloadLog("action", "abort: no tabId");
        return;
      }
      panelReloadLog("action", "toggle start", { tabId });
      try {
        const open = await toggleSafariPanel(tabId);
        state.setShowSidePanel(open);
        panelReloadLog("action", "toggle done", { tabId, open });
      } catch (e) {
        panelReloadLog("action", "toggle failed", {
          tabId,
          err: String((e as Error)?.message || e),
        });
      }
    })();
    return;
  }
  handleChromeActionClicked(tab, state);
}

export async function tryEnsureEditionSidePanel(opts?: {
  maxWaitMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  if (!isSafariBuild()) return false;
  return ensureSafariPanelReady(opts);
}

export function registerEditionTabListeners(): void {
  getContext().browser.tabs.onActivated.addListener(
    async (activeInfo: { tabId: number }) => {
      const tabId = activeInfo.tabId;
      try {
        const tab = await getContext().browser.tabs.get(tabId);
        const url = tab?.url;
        if (typeof url === 'string' && url) {
          const topHost = getHostname(url);
          if (topHost) {
            adBlocker.activateHost?.(tabId, topHost);
          }
        }
      } catch {
        // ignore invalid tab
      }
      try {
        console.log('onActivated find.video.js for agent', tabId);
        await scriptingToFetchWindowParams(tabId, '');
      } catch (err) {
        console.error(`failed to execute script: ${err}`);
      }
      try {
        await injectSafariPanelContentScripts(tabId);
      } catch (err) {
        console.warn('[doma-safari] onActivated inject failed', err);
      }
    },
  );
  getContext().browser.tabs.onUpdated.addListener(
    async (tabId: number, changeInfo: any, tab: any) => {
      console.log('onUpdated for agent', tabId, changeInfo, tab);
      // 宿主页开始加载 / 完成：侧栏 iframe 会随 content 重建；便于对照工具日志
      if (
        isSafariBuild() &&
        (changeInfo.status === 'loading' ||
          changeInfo.status === 'complete' ||
          typeof changeInfo.url === 'string')
      ) {
        let panelOpen: boolean | undefined;
        try {
          panelOpen = getSafariPanelOpen(tabId);
        } catch {
          panelOpen = undefined;
        }
        console.warn('[PANEL-RELOAD][sw] tabs.onUpdated', {
          tabId,
          status: changeInfo.status ?? null,
          urlChanged: typeof changeInfo.url === 'string',
          url: typeof changeInfo.url === 'string' ? changeInfo.url : tab?.url,
          panelOpen,
          t: Date.now(),
        });
        panelReloadLog('sw', 'tabs.onUpdated', {
          tabId,
          status: changeInfo.status ?? null,
          urlChanged: typeof changeInfo.url === 'string',
          url: typeof changeInfo.url === 'string' ? changeInfo.url : tab?.url,
          panelOpen,
        });
      }
      if (changeInfo.status === 'loading') {
        try {
          await scriptingToListeningTimedtext(tabId);
          console.log('find.video.js for agent', tabId);
          await scriptingToFetchWindowParams(tabId, tab.faviconUrl);
        } catch (err) {
          console.error(`failed to execute script: ${err}`);
        }
      }
      // complete 时再注一次：Safari 上 document_idle CS 有时不跑
      if (changeInfo.status === 'complete') {
        try {
          await injectSafariPanelContentScripts(tabId);
        } catch (err) {
          console.warn('[doma-safari] onUpdated inject failed', err);
        }
      }
    },
  );
}


