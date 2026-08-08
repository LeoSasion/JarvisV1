import {
  AlertRegular,
  CheckmarkCircleRegular,
  ChevronRightRegular,
  InfoRegular,
} from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import { mergeSystemFeedEvents } from "../feedback-model.js";
import { useSystemFeed, useSystemSnapshot } from "../hooks/usePlatformData.js";
import {
  getCompactTelemetrySummary,
  getTelemetryPriorityPresentation,
  getTelemetryRailMode,
} from "../telemetry-rail-model.js";
import { HudPanel } from "./HudPanel.jsx";
import { SparklineCanvas } from "./SparklineCanvas.jsx";

function SegmentBar({ active = 10 }) {
  return (
    <span className="segment-bar" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
        <i key={index} className={index < active ? "is-on" : ""} />
      ))}
    </span>
  );
}

function ResourceRow({ resource, onInspect }) {
  return (
    <button
      type="button"
      className="resource-row"
      onClick={() => onInspect(resource.label)}
      aria-label={`Inspect ${resource.label}: ${resource.value}`}
    >
      <span className="resource-copy">
        <span className="resource-heading">
          <strong>{resource.label}</strong>
          <b>{resource.value}</b>
        </span>
        <small>{resource.meta}</small>
      </span>
      <span className="resource-visual">
        {resource.segments ? <SegmentBar active={resource.segments} /> : <SparklineCanvas points={resource.points} />}
        {resource.secondary ? <small className="resource-secondary">{resource.secondary}</small> : null}
      </span>
      <ChevronRightRegular className="telemetry-row-affordance" aria-hidden="true" />
    </button>
  );
}

function formatFeedTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TelemetryRail({ compact = false, localEvents = [], onInspect, onNotification }) {
  const { processes, resources } = useSystemSnapshot();
  const feed = useSystemFeed();
  const events = useMemo(
    () => mergeSystemFeedEvents(localEvents, feed.items),
    [feed.items, localEvents],
  );
  const [resourcesExpanded, setResourcesExpanded] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const visibleResources = resourcesExpanded ? resources : resources.slice(0, 2);
  const visibleEvents = events.slice(0, 5);
  const unreadCount = Math.min(99, events.filter((item) => item.unread).length);
  const priorityState = getTelemetryPriorityPresentation({
    events,
    feedError: feed.error,
    feedLoading: feed.loading,
  });
  const railMode = getTelemetryRailMode({ compact, priorityKind: priorityState.kind });
  const compactSummary = getCompactTelemetrySummary(resources);
  const PriorityIcon = priorityState.kind === "warning"
    ? AlertRegular
    : priorityState.kind === "connecting"
      ? InfoRegular
      : CheckmarkCircleRegular;

  return (
    <aside className={`telemetry-rail is-${railMode}`} aria-label="System telemetry">
      {railMode === "compact-nominal" ? (
        <button
          type="button"
          className="telemetry-compact-summary"
          onClick={() => onInspect("System Health")}
          aria-label={compactSummary.label}
        >
          <CheckmarkCircleRegular aria-hidden="true" />
          <span><strong>SYSTEM NOMINAL</strong><small>CPU {compactSummary.cpu} · MEMORY {compactSummary.memory}</small></span>
          <ChevronRightRegular aria-hidden="true" />
        </button>
      ) : <>
        <HudPanel title="SYSTEM PRIORITY" className={`priority-panel ${priorityState.className}`}>
        <button type="button" className="telemetry-priority" onClick={() => onInspect("System Health")}>
          <PriorityIcon />
          <span>
            <strong>{priorityState.title}</strong>
            <small>{priorityState.detail}</small>
            <em>{priorityState.meta}</em>
          </span>
          <ChevronRightRegular className="telemetry-row-affordance" aria-hidden="true" />
        </button>
        </HudPanel>

        <HudPanel
        title="SYSTEM RESOURCES"
        className="resources-panel"
        action={resources.length > 2 ? (
          <button type="button" className="telemetry-inline-action" onClick={() => setResourcesExpanded((current) => !current)}>
            {resourcesExpanded ? "SHOW LESS" : `${resources.length - 2} MORE`}
          </button>
        ) : null}
      >
        <div className="resource-list">
          {visibleResources.map((resource) => (
            <ResourceRow key={resource.id} resource={resource} onInspect={onInspect} />
          ))}
        </div>
        </HudPanel>
      </>}

      <HudPanel
        title="SYSTEM ACTIVITY"
        className="activity-panel"
        collapsible
        open={activityOpen}
        onToggle={() => setActivityOpen((current) => !current)}
        action={<span className="telemetry-count">{processes.length}</span>}
      >
        <div className="process-title">ACTIVE PROCESSES</div>
        <div className="process-grid process-grid--header" aria-hidden="true">
          <span>NAME</span><span>CPU</span><span>MEM</span><span>NET</span>
        </div>
        <div className="process-list">
          {processes.map((process) => (
            <button
              key={process.id}
              type="button"
              className="process-grid"
              onClick={() => onInspect(process.name)}
              aria-label={`Inspect ${process.name}: CPU ${process.cpu}, memory ${process.memory}, network ${process.network}`}
            >
              <span className="process-name"><i aria-hidden="true" />{process.name}</span>
              <span>{process.cpu}</span><span>{process.memory}</span><span>{process.network}</span>
            </button>
          ))}
        </div>
      </HudPanel>

      <HudPanel
        title="SYSTEM FEED"
        action={<span className="notification-count">{unreadCount}</span>}
        className="notifications-panel"
        collapsible
        open={feedOpen}
        onToggle={() => setFeedOpen((current) => !current)}
      >
        <div className="notification-list">
          {visibleEvents.length === 0 ? <p className="system-feed-empty">No session events</p> : null}
          {visibleEvents.map((notification) => {
            const Icon = notification.severity === "ok"
              ? CheckmarkCircleRegular
              : notification.severity === "info"
                ? InfoRegular
                : AlertRegular;
            return (
              <button key={notification.id} type="button" className="notification-row" onClick={() => onNotification(notification)}>
                <Icon />
                <span className="notification-copy">
                  <strong>{notification.title}</strong>
                  <small>{notification.detail}</small>
                </span>
                <time dateTime={notification.timestamp ?? undefined}>{formatFeedTime(notification.timestamp)}</time>
                <ChevronRightRegular className="telemetry-row-affordance" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </HudPanel>
      {feed.loading ? <p className="telemetry-loading" role="status">CONNECTING TO EVENT FEED</p> : null}
    </aside>
  );
}
