import { useSyncExternalStore } from "react";
import {
  getReducedMotionServerSnapshot,
  getReducedMotionSnapshot,
  subscribeReducedMotion,
} from "../motion-preference.js";

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}
