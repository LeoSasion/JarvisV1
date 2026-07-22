import {
  ArrowDownloadRegular,
  CodeRegular,
  DeleteRegular,
  DesktopRegular,
  DocumentRegular,
  FolderRegular,
  HardDriveRegular,
  NotepadRegular,
  SettingsRegular,
  WindowConsoleRegular,
} from "@fluentui/react-icons";
import { useDesktopEntries } from "../hooks/usePlatformData.js";

const iconMap = {
  desktop: DesktopRegular,
  folder: FolderRegular,
  drive: HardDriveRegular,
  download: ArrowDownloadRegular,
  terminal: WindowConsoleRegular,
  recycle: DeleteRegular,
  document: DocumentRegular,
  code: CodeRegular,
  notes: NotepadRegular,
  settings: SettingsRegular,
};

export function DesktopShortcuts({ selectedId, onSelect, onOpen }) {
  const { entries } = useDesktopEntries();

  return (
    <nav className="desktop-shortcuts" aria-label="Desktop shortcuts">
      {entries.map((shortcut) => {
        const Icon = iconMap[shortcut.icon] ?? DocumentRegular;
        const selected = selectedId === shortcut.id;
        return (
          <button
            key={shortcut.id}
            type="button"
            className={`desktop-shortcut ${selected ? "is-selected" : ""}`}
            aria-pressed={selected}
            title={shortcut.label}
            onClick={() => onSelect(shortcut.id)}
            onDoubleClick={() => onOpen(shortcut)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onOpen(shortcut);
              }
            }}
          >
            <span className="shortcut-icon" aria-hidden="true"><Icon /></span>
            <span className="shortcut-label">{shortcut.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
