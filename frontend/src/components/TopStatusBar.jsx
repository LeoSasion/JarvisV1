import {
  Battery6Regular,
  PlugConnectedRegular,
  PowerRegular,
  SearchRegular,
  Speaker2Regular,
  SpeakerOffRegular,
  StopRegular,
  Wifi4Regular,
} from "@fluentui/react-icons";
import { getCommandBusPresentation } from "../agent-provider-model.js";
import { usePlatformClock, useTrayStatus } from "../hooks/usePlatformData.js";
import { JarvisMark } from "./VectorMarks.jsx";

function TopCluster({ className = "", children, as = "div", ...props }) {
  const Tag = as;
  return (
    <Tag className={`top-cluster ${className}`} {...props}>
      {children}
    </Tag>
  );
}

export function TopStatusBar({
  onOpenCommand,
  onAbortAgent,
  agentState,
  onPower,
}) {
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
  const agentStatus = agentState?.status ?? "unavailable";
  const agentRunning = agentStatus === "running" || agentStatus === "starting";
  const { localCommandLabel, agentProviderStatus } = getCommandBusPresentation(agentState);

  return (
    <header className="topbar hud-chassis" aria-label="JARVIS global status">
      <div className="topbar__zone topbar__identity">
        <TopCluster className="brand-cluster">
          <JarvisMark className="brand-orb" />
          <span className="brand-name">JARVIS</span>
          <span className="brand-edition">LOCAL VISUAL FRAME</span>
        </TopCluster>
        <TopCluster
          as="button"
          type="button"
          className="mic-cluster"
          onClick={onOpenCommand}
          title="Open local quick search"
          aria-label="Open local quick search (Control Space)"
          aria-keyshortcuts="Control+Space"
        >
          <SearchRegular />
          <span>LOCAL SEARCH</span>
          <kbd>CTRL SPACE</kbd>
        </TopCluster>
      </div>

      <div className={`topbar__zone topbar__command-bus is-${agentStatus}`}>
        <TopCluster className={`secure-cluster is-${agentStatus}`} title={`${localCommandLabel} · ${agentProviderStatus}`} role="status">
          <span>COMMAND BUS · {agentProviderStatus}</span>
          <strong>{localCommandLabel}</strong>
        </TopCluster>
        {agentRunning ? (
          <TopCluster
            as="button"
            type="button"
            className="stop-cluster"
            onClick={() => { void onAbortAgent().catch(() => {}); }}
            title="Stop active Agent response"
          >
            <span className="stop-token" aria-hidden="true"><StopRegular /></span>
            <span>STOP</span>
          </TopCluster>
        ) : null}
      </div>

      <div className="topbar__zone topbar__system">
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
      </div>
    </header>
  );
}
