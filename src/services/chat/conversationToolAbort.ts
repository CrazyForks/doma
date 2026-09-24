/**
 * SW-side AbortSignal registry keyed by conversationId.
 * Side panel Stop cannot share AbortController with the service worker;
 * it sends chat/abortTools / chat/resetToolAbort instead.
 */

const controllers = new Map<string, AbortController>();
/** Stop arrived before the tool called beginToolAbort — next begin aborts immediately. */
const pendingAbort = new Set<string>();

export function resetToolAbort(conversationId: string): void {
  const cid = String(conversationId || "").trim();
  if (!cid) return;
  pendingAbort.delete(cid);
  const c = controllers.get(cid);
  if (c) {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
    controllers.delete(cid);
  }
}

export function abortToolsForConversation(conversationId: string): void {
  const cid = String(conversationId || "").trim();
  if (!cid) return;
  pendingAbort.add(cid);
  const c = controllers.get(cid);
  if (c) {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
    controllers.delete(cid);
  }
  console.log("[tool-abort] abort", { conversationId: cid });
}

export function beginToolAbort(conversationId: string): AbortSignal {
  const cid = String(conversationId || "").trim();
  if (!cid) {
    return new AbortController().signal;
  }
  // Replace any prior controller for this cid (orphan tool).
  const prev = controllers.get(cid);
  if (prev) {
    try {
      prev.abort();
    } catch {
      /* ignore */
    }
    controllers.delete(cid);
  }
  const ac = new AbortController();
  if (pendingAbort.has(cid)) {
    pendingAbort.delete(cid);
    ac.abort();
  }
  controllers.set(cid, ac);
  return ac.signal;
}

export function endToolAbort(conversationId: string): void {
  const cid = String(conversationId || "").trim();
  if (!cid) return;
  controllers.delete(cid);
}

export function isToolAbortError(e: unknown): boolean {
  return (
    (e as { name?: string })?.name === "AbortError" ||
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError")
  );
}

/** delay that rejects with AbortError when signal aborts */
export function delayMsAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
