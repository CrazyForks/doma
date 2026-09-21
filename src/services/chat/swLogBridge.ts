/**
 * Safari SW → App：runtime.sendNativeMessage，全量转发 console，不按前缀筛选。
 */
import { getContext } from "@/services/Context";
import { isSafariBuild } from "@/utils/safariBuild";

const SAFARI_NATIVE_APP_ID = "application.id";

let quiet = false;

function browserApi(): any {
  try {
    return getContext().browser as any;
  } catch {
    return (globalThis as any).browser || (globalThis as any).chrome;
  }
}

function rawWarn(...args: unknown[]) {
  const orig = (console as any).warn__orig as undefined | ((...a: unknown[]) => void);
  if (typeof orig === "function") orig(...args);
  else console.warn(...args);
}

export function sendSwLogToNativeApp(line: string): void {
  if (!isSafariBuild() || quiet) return;
  const text = String(line || "").slice(0, 4000);
  if (!text) return;
  const browser = browserApi();
  if (!browser?.runtime?.sendNativeMessage) return;
  try {
    browser.runtime.sendNativeMessage(
      SAFARI_NATIVE_APP_ID,
      { message: text, type: "panel-reload-log", line: text },
      () => {
        const err = browser.runtime.lastError;
        if (err) {
          quiet = true;
          try {
            rawWarn("[sw-native-log] lastError", err.message || err);
          } finally {
            quiet = false;
          }
        }
      },
    );
  } catch (e) {
    quiet = true;
    try {
      rawWarn("[sw-native-log] threw", e);
    } finally {
      quiet = false;
    }
  }
}

export function panelReloadLog(
  where: string,
  msg: string,
  detail?: Record<string, unknown>,
): void {
  let extra = "";
  if (detail && typeof detail === "object") {
    try {
      extra = " " + JSON.stringify(detail);
    } catch {
      extra = " " + String(detail);
    }
  }
  const line = `[PANEL-RELOAD][${where}] ${msg}${extra}`;
  sendSwLogToNativeApp(line);
  rawWarn(line);
}

let bridgeInstalled = false;

/** SW 启动：劫持 console，全部转发到 DomA App（无前缀过滤、无心跳） */
export function installSwNativeLogBridge(): void {
  if (!isSafariBuild() || bridgeInstalled) return;
  bridgeInstalled = true;

  for (const level of ["log", "warn", "error", "info"] as const) {
    const origKey = `${level}__orig`;
    if (!(console as any)[origKey]) {
      (console as any)[origKey] = (console as any)[level].bind(console);
    }
    const orig = (console as any)[origKey] as (...a: unknown[]) => void;
    (console as any)[level] = (...args: unknown[]) => {
      if (!quiet) {
        try {
          const raw = args
            .map((a) => {
              if (typeof a === "string") return a;
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })
            .join(" ");
          if (raw.trim()) {
            sendSwLogToNativeApp(`[${level}] ${raw}`.slice(0, 4000));
          }
        } catch {
          // ignore
        }
      }
      return orig(...args);
    };
  }

  sendSwLogToNativeApp(`[sw] native log bridge on · t=${Date.now()}`);
}
