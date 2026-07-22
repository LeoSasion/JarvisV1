import { createMockPlatform } from "./mock-platform.js";
import { createWindowsPlatform } from "./windows-platform.js";

const webview = globalThis.window?.chrome?.webview;

export const platform = webview?.postMessage && webview?.addEventListener
  ? createWindowsPlatform(webview)
  : createMockPlatform();

export const isWindowsHost = platform.kind === "windows";
