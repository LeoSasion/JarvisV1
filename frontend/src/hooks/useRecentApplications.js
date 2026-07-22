import { useSyncExternalStore } from "react";
import {
  getRecentApplicationIds,
  subscribeToRecentApplications,
} from "../recent-applications.js";

export function useRecentApplicationIds() {
  return useSyncExternalStore(
    subscribeToRecentApplications,
    getRecentApplicationIds,
    getRecentApplicationIds,
  );
}
