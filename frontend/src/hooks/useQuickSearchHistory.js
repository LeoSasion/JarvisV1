import { useSyncExternalStore } from "react";
import {
  getQuickSearchHistory,
  subscribeQuickSearchHistory,
} from "../quick-search-history.js";

export function useQuickSearchHistory() {
  return useSyncExternalStore(
    subscribeQuickSearchHistory,
    getQuickSearchHistory,
    getQuickSearchHistory,
  );
}
