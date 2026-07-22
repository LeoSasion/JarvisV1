import {
  ChatRegular,
  CheckmarkCircleRegular,
  TargetRegular,
  WrenchRegular,
} from "@fluentui/react-icons";
import { notifications } from "../data.js";
import { useSystemSnapshot } from "../hooks/usePlatformData.js";
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

const notificationIcons = {
  mission: TargetRegular,
  maintenance: WrenchRegular,
  comms: ChatRegular,
};

export function TelemetryRail({ micActive, onInspect, onNotification }) {
  const { processes, resources } = useSystemSnapshot();

  return (
    <aside className="telemetry-rail" aria-label="System telemetry">
      <HudPanel title="JARVIS CORE" className="core-status-panel">
        <div className="core-status">
          <img src="/assets/jarvis-right-core-status-v1.png" alt="" />
          <div className="core-status__copy">
            <span>CORE STATUS</span>
            <strong>READY</strong>
            <small>STANDBY</small>
            <div className="core-wave"><WaveformCanvas active={micActive} compact /></div>
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

      <HudPanel title="NOTIFICATIONS" action={<span className="notification-count">3</span>} className="notifications-panel">
        <div className="notification-list">
          {notifications.map((notification) => {
            const Icon = notificationIcons[notification.kind];
            return (
              <button key={notification.id} type="button" className="notification-row" onClick={() => onNotification(notification)}>
                <Icon />
                <span className="notification-copy">
                  <strong>{notification.title}</strong>
                  <small>{notification.detail}</small>
                </span>
                <time>{notification.time}</time>
              </button>
            );
          })}
        </div>
      </HudPanel>

      <HudPanel title="SYSTEM HEALTH" className="health-panel" onClick={() => onInspect("System Health") }>
        <div className="health-status">
          <CheckmarkCircleRegular />
          <span>
            <strong>ALL SYSTEMS NOMINAL</strong>
            <small>No actions required</small>
          </span>
        </div>
      </HudPanel>
    </aside>
  );
}
