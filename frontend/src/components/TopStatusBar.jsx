import {
  Battery6Regular,
  LockClosedRegular,
  MicOffRegular,
  MicRegular,
  PowerRegular,
  Speaker2Regular,
  Wifi4Regular,
} from "@fluentui/react-icons";
import { usePlatformClock } from "../hooks/usePlatformData.js";
import { WaveformCanvas } from "./WaveformCanvas.jsx";

function TopCluster({ className = "", children, as = "div", ...props }) {
  const Tag = as;
  return (
    <Tag className={`top-cluster ${className}`} {...props}>
      {children}
    </Tag>
  );
}

export function TopStatusBar({ micActive, onToggleMic, onOpenCommand, onPower }) {
  const clock = usePlatformClock();

  return (
    <header className="topbar hud-chassis" aria-label="JARVIS global status">
      <TopCluster className="brand-cluster">
        <img src="/assets/jarvis-top-brand-core-v1.png" alt="" className="brand-orb" />
        <span className="brand-name">JARVIS</span>
        <span className="brand-edition">NIGHT SHELL</span>
      </TopCluster>

      <TopCluster
        as="button"
        type="button"
        className={`mic-cluster ${micActive ? "is-active" : ""}`}
        aria-pressed={micActive}
        onClick={onToggleMic}
        title={micActive ? "Mute microphone" : "Enable microphone"}
      >
        {micActive ? <MicRegular /> : <MicOffRegular />}
        <span>{micActive ? "MIC ACTIVE" : "MIC MUTED"}</span>
        <WaveformCanvas active={micActive} compact />
      </TopCluster>

      <TopCluster className="secure-cluster" title="Secure channel locked" role="status">
        <LockClosedRegular />
        <span>SECURE CHANNEL</span>
      </TopCluster>

      <TopCluster as="button" type="button" className="agent-cluster" onClick={onOpenCommand}>
        <img src="/assets/jarvis-top-agent-ready-core-v1.png" alt="" className="agent-status-orb" />
        <span className="status-copy">
          <strong>JARVIS: READY</strong>
          <small>No active task</small>
        </span>
      </TopCluster>

      <TopCluster as="button" type="button" className="stop-cluster" disabled title="No active task">
        <span className="stop-token" aria-hidden="true">7</span>
        <span>STOP AGENT</span>
      </TopCluster>

      <TopCluster className="date-cluster">
        <span>{clock.longDate}</span>
      </TopCluster>

      <TopCluster className="system-cluster">
        <time dateTime={clock.dateTime}>{clock.time}</time>
        <Wifi4Regular title="Wi-Fi connected" />
        <Speaker2Regular title="Volume 64%" />
        <span className="battery-copy"><Battery6Regular /> 100%</span>
        <button type="button" onClick={onPower} aria-label="Power options"><PowerRegular /></button>
      </TopCluster>
    </header>
  );
}
