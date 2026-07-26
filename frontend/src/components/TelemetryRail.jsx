import {
  AlertRegular,
  CheckmarkCircleRegular,
  InfoRegular,
} from "@fluentui/react-icons";
import { useSystemFeed, useSystemSnapshot } from "../hooks/usePlatformData.js";
import { HudPanel } from "./HudPanel.jsx";
import { SparklineCanvas } from "./SparklineCanvas.jsx";
import { WaveformCanvas } from "./WaveformCanvas.jsx";

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
    <button type="button" className="resource-row" onClick={() => onInspect(resource.label)}>
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
    </button>
  );
}

function formatFeedTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TelemetryRail({ onInspect, onNotification }) {
  const { processes, resources } = useSystemSnapshot();
  const feed = useSystemFeed();
  const visibleEvents = feed.items.slice(0, 3);
  const hasWarning = feed.items.some((item) => item.severity === "warning" || item.severity === "error");

  return (
    <aside className="telemetry-rail" aria-label="System telemetry">
      <HudPanel title="JARVIS CORE" className="core-status-panel">
        <div className="core-status">
          <img src="/assets/jarvis-right-core-status-v1.png" alt="" />
          <div className="core-status__copy">
            <span>CORE STATUS</span>
            <strong>LOCAL</strong>
            <small>AGENT NOT CONNECTED</small>
            <div className="core-wave"><WaveformCanvas active={false} compact /></div>
          </div>
        </div>
      </HudPanel>

      <HudPanel title="SYSTEM RESOURCES" className="resources-panel">
        <div className="resource-list">
          {resources.map((resource) => (
            <ResourceRow key={resource.id} resource={resource} onInspect={onInspect} />
          ))}
        </div>
      </HudPanel>

      <HudPanel title="SYSTEM ACTIVITY" className="activity-panel">
        <div className="process-title">ACTIVE PROCESSES</div>
        <div className="process-grid process-grid--header" aria-hidden="true">
          <span>NAME</span><span>CPU</span><span>MEM</span><span>NET</span>
        </div>
        <div className="process-list">
          {processes.map((process) => (
            <button key={process.id} type="button" className="process-grid" onClick={() => onInspect(process.name)}>
              <span className="process-name"><i aria-hidden="true" />{process.name}</span>
              <span>{process.cpu}</span><span>{process.memory}</span><span>{process.network}</span>
            </button>
          ))}
        </div>
      </HudPanel>

      <HudPanel title="JARVIS SYSTEM FEED" action={<span className="notification-count">{feed.unreadCount}</span>} className="notifications-panel">
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
              </button>
            );
          })}
        </div>
      </HudPanel>

      <HudPanel title="SYSTEM HEALTH" className="health-panel" onClick={() => onInspect("System Health") }>
        <div className="health-status">
          {hasWarning ? <AlertRegular /> : <CheckmarkCircleRegular />}
          <span>
            <strong>{hasWarning ? "ATTENTION RECORDED" : "NO CRITICAL EVENTS"}</strong>
            <small>{feed.loading ? "Connecting to event feed" : `${feed.items.length} session events`}</small>
          </span>
        </div>
      </HudPanel>
    </aside>
  );
}
