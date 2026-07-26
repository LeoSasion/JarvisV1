import {
  Battery6Regular,
  PlugConnectedRegular,
  PowerRegular,
  SearchRegular,
  Speaker2Regular,
  SpeakerOffRegular,
  Wifi4Regular,
} from "@fluentui/react-icons";
import { usePlatformClock, useTrayStatus } from "../hooks/usePlatformData.js";

function TopCluster({ className = "", children, as = "div", ...props }) {
  const Tag = as;
  return (
    <Tag className={`top-cluster ${className}`} {...props}>
      {children}
    </Tag>
  );
}

export function TopStatusBar({ onOpenCommand, onPower }) {
  const clock = usePlatformClock();
  const tray = useTrayStatus();
  const AudioIcon = tray.audio.muted ? SpeakerOffRegular : Speaker2Regular;
  const PowerIcon = tray.power.batteryPresent ? Battery6Regular : PlugConnectedRegular;
  const audioLabel = tray.audio.available
    ? tray.audio.muted ? "MUTED" : `${tray.audio.volumePercent ?? 0}%`
    : "UNAVAILABLE";
  const powerLabel = tray.power.batteryPresent
    ? `${Math.round(tray.power.percentage ?? 0)}%`
    : tray.power.acConnected ? "AC" : "POWER";

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
        className="mic-cluster"
        onClick={onOpenCommand}
        title="Open local quick search"
      >
        <SearchRegular />
        <span>LOCAL SEARCH</span>
      </TopCluster>

      <TopCluster className="secure-cluster" title="No remote agent is connected" role="status">
        <span>AGENT NOT CONNECTED</span>
      </TopCluster>

      <TopCluster as="button" type="button" className="agent-cluster" onClick={onOpenCommand}>
        <img src="/assets/jarvis-top-agent-ready-core-v1.png" alt="" className="agent-status-orb" />
        <span className="status-copy">
          <strong>LOCAL COMMAND</strong>
          <small>Search apps, files and settings</small>
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
        <Wifi4Regular title={tray.network.available ? `Connected · ${tray.network.interfaceName ?? "Windows network"}` : "Network unavailable"} />
        <AudioIcon title={`Audio ${audioLabel}`} />
        <span className="battery-copy"><PowerIcon /> {powerLabel}</span>
        <button type="button" onClick={onPower} aria-label="Power options"><PowerRegular /></button>
      </TopCluster>
    </header>
  );
}
