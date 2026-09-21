/** Build-time Safari flag (VITE_STAY_EXTENSION_BROWSER_NAME=safari). */
export function isSafariBuild(): boolean {
  return import.meta.env.VITE_STAY_EXTENSION_BROWSER_NAME === "safari";
}
