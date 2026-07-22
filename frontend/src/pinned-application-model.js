import { getPinnedApplicationKey } from "./pinned-applications.js";

export function getMenuApplicationPinReference(application) {
  if (application?.kind === "installed") {
    return { kind: "installed", applicationId: application.applicationId };
  }
  if (application?.pinnedApplication?.id) {
    return { kind: "builtin", id: application.pinnedApplication.id };
  }
  return null;
}

export function getMenuApplicationPinKey(application) {
  return getPinnedApplicationKey(getMenuApplicationPinReference(application));
}

export function resolvePinnedApplications(references, menuApplications) {
  const applicationByKey = new Map(menuApplications.map((application) => [
    getMenuApplicationPinKey(application),
    application,
  ]));
  return references.flatMap((reference) => {
    const application = applicationByKey.get(getPinnedApplicationKey(reference));
    return application ? [application] : [];
  });
}
