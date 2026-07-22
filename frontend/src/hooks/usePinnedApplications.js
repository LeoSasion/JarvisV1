import { useSyncExternalStore } from "react";
import {
  getPinnedApplications,
  subscribeToPinnedApplications,
} from "../pinned-applications.js";

export function usePinnedApplicationRefs() {
  return useSyncExternalStore(
    subscribeToPinnedApplications,
    getPinnedApplications,
    getPinnedApplications,
  );
}
