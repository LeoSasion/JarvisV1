import { useMemo } from "react";
import {
  usePlatformClock,
  usePlatformKind,
  useSystemFeed,
  useSystemSnapshot,
} from "../hooks/usePlatformData.js";
import { getAgentProviderLabel } from "../agent-provider-model.js";

function statusCopy(agentState) {
  if (!agentState?.available) return "OFFLINE";
  if (agentState.status === "running" || agentState.status === "starting") return "ACTIVE";
  if (agentState.status === "error") return "ATTENTION";
  return agentState.connected ? "CONNECTED" : "READY";
}

function Meter({ segments = 0 }) {
  const active = Math.max(0, Math.min(12, Math.round((segments / 18) * 12)));
  return (
    <span className="linked-system-meter" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => <i key={index} className={index < active ? "is-on" : ""} />)}
    </span>
  );
}

export function LinkedSystemRail({ agentState, onInspect, onNotification }) {
  const clock = usePlatformClock();
  const platformKind = usePlatformKind();
  const { processes, resources } = useSystemSnapshot();
  const feed = useSystemFeed();
  const agentLabel = statusCopy(agentState);
  const providerLabel = getAgentProviderLabel(agentState);
  const attentionCount = useMemo(() => feed.items.filter((item) => (
    item.severity === "warning" || item.severity === "error"
  )).length, [feed.items]);

  return (
    <aside className="linked-system-rail" aria-label="Linked workspace system status">
      <header><strong>SYSTEM</strong><i aria-hidden="true" /></header>

      <section>
        <h2>HOST</h2>
        <dl>
          <div><dt>MODE</dt><dd>{platformKind === "native" ? "WINDOWS HOST" : "LOCAL PREVIEW"}</dd></div>
          <div><dt>FRAME</dt><dd>OWN PROCESS</dd></div>
          <div><dt>TIME</dt><dd>{clock.time}</dd></div>
        </dl>
      </section>

      <section>
        <h2>PERFORMANCE</h2>
        <div className="linked-system-resources">
          {resources.slice(0, 5).map((resource) => (
            <button key={resource.id} type="button" onClick={() => onInspect(resource.label)}>
              <span>{resource.label}</span><strong>{resource.value}</strong><Meter segments={resource.segments} />
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>CONNECTIONS</h2>
        <dl>
          <div><dt>AGENT · {providerLabel}</dt><dd className={agentLabel === "OFFLINE" ? "is-muted" : "is-signal"}>{agentLabel}</dd></div>
          <div><dt>COMMAND BUS</dt><dd>{agentState?.available ? "READY" : "STANDBY"}</dd></div>
          <div><dt>DATA ACCESS</dt><dd>CHAT ONLY</dd></div>
        </dl>
      </section>

      <section>
        <h2>NOTIFICATIONS</h2>
        <button
          type="button"
          className="linked-system-notification"
          disabled={feed.items.length === 0}
          onClick={() => feed.items[0] && onNotification(feed.items[0])}
        >
          <span>{feed.items.length ? feed.items[0].title : "NO NEW ALERTS"}</span>
          <small>{attentionCount ? `${attentionCount} NEED ATTENTION` : `${feed.unreadCount} UNREAD`}</small>
        </button>
      </section>

      <section>
        <h2>TASKS</h2>
        <dl>
          <div><dt>ACTIVE GROUPS</dt><dd>{processes.length}</dd></div>
          <div><dt>AGENT RUN</dt><dd>{agentState?.status === "running" ? "1" : "0"}</dd></div>
        </dl>
      </section>
    </aside>
  );
}
