import {
  AppsListDetailRegular,
  ArrowClockwiseRegular,
  ArrowSortRegular,
  ChevronRightRegular,
  ClipboardPasteRegular,
  CopyRegular,
  CutRegular,
  DeleteRegular,
  FolderAddRegular,
  FolderOpenRegular,
  GridRegular,
  InfoRegular,
  OpenRegular,
  RenameRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";

function MenuItem({
  children,
  checked,
  checkType = "radio",
  disabled = false,
  icon: Icon,
  onClick,
  submenu,
}) {
  return (
    <button
      type="button"
      className="desktop-menu-item"
      role={checked === undefined ? "menuitem" : `menuitem${checkType}`}
      aria-checked={checked === undefined ? undefined : checked}
      aria-haspopup={submenu ? "menu" : undefined}
      aria-expanded={submenu ? submenu.open : undefined}
      data-submenu={submenu?.id}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={submenu?.onOpen}
    >
      <span className={`desktop-menu-item__icon ${checked ? "is-checked" : ""}`} aria-hidden="true">
        {checked === true ? "✓" : Icon ? <Icon /> : null}
      </span>
      <span className="desktop-menu-item__label">{children}</span>
      {submenu ? <ChevronRightRegular className="desktop-menu-item__chevron" aria-hidden="true" /> : null}
    </button>
  );
}

function MenuSeparator() {
  return <div className="desktop-menu-separator" role="separator" />;
}

export function DesktopContextMenu({
  alignToGrid,
  autoArrange,
  iconSize,
  menu,
  menuRef,
  onClose,
  onCopy,
  onCopyPath,
  onCut,
  onDelete,
  onNewFolder,
  onOpen,
  onOpenLocation,
  onOpenSettings,
  onPaste,
  onProperties,
  onRefresh,
  onRename,
  onSetIconSize,
  onSetSortMode,
  onToggleAlignToGrid,
  onToggleAutoArrange,
  shortcut,
  selectionCount,
  sortMode,
  canPaste,
}) {
  const [activeSubmenu, setActiveSubmenu] = useState(null);

  useEffect(() => {
    setActiveSubmenu(null);
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector(".desktop-menu-root > .desktop-menu-item:not(:disabled)")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menu.kind, menu.shortcutId, menu.x, menu.y, menuRef]);

  const focusSubmenu = (id) => {
    setActiveSubmenu(id);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector(`[data-submenu-panel="${id}"] .desktop-menu-item:not(:disabled)`)?.focus();
    });
  };

  const handleKeyDown = (event) => {
    const currentItem = event.target.closest(".desktop-menu-item");
    const currentMenu = event.target.closest('[role="menu"]');
    if (!currentItem || !currentMenu) return;
    const items = [...currentMenu.querySelectorAll(":scope > .desktop-menu-item:not(:disabled)")];
    const currentIndex = items.indexOf(currentItem);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(currentIndex + direction + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight" && currentItem.dataset.submenu) {
      event.preventDefault();
      focusSubmenu(currentItem.dataset.submenu);
      return;
    }
    if (event.key === "ArrowLeft" && currentMenu.dataset.submenuPanel) {
      event.preventDefault();
      const submenuId = currentMenu.dataset.submenuPanel;
      setActiveSubmenu(null);
      menuRef.current?.querySelector(`[data-submenu="${submenuId}"]`)?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const rootClassName = [
    "desktop-context-menu",
    `is-submenu-${menu.submenuSide}`,
    menu.kind === "item" ? "is-item-menu" : "is-desktop-menu",
  ].join(" ");

  return (
    <section
      ref={menuRef}
      className={rootClassName}
      aria-label={menu.kind === "item" ? `${shortcut?.label ?? "Desktop item"} commands` : "Desktop commands"}
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      onKeyDown={handleKeyDown}
    >
      <header>
        <span>{menu.kind === "item" ? "DESKTOP ITEM" : "DESKTOP"}</span>
        <small>{menu.kind === "item"
          ? selectionCount > 1 ? `${selectionCount} ITEMS` : shortcut?.label
          : "WORKSPACE"}</small>
      </header>

      <div className="desktop-menu-root" role="menu">
        {menu.kind === "item" ? (
          <>
            <MenuItem
              icon={OpenRegular}
              disabled={selectionCount !== 1}
              onClick={() => onOpen(shortcut)}
            >
              打开
            </MenuItem>
            <MenuItem
              icon={FolderOpenRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onOpenLocation(shortcut)}
            >
              打开文件所在位置
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={CutRegular} disabled={!shortcut?.path} onClick={onCut}>剪切</MenuItem>
            <MenuItem icon={CopyRegular} disabled={!shortcut?.path} onClick={onCopy}>复制</MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={RenameRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onRename(shortcut)}
            >
              重命名
            </MenuItem>
            <MenuItem icon={DeleteRegular} disabled={!shortcut?.path} onClick={onDelete}>
              删除
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={CopyRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onCopyPath(shortcut)}
            >
              复制路径
            </MenuItem>
            <MenuItem
              icon={InfoRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onProperties(shortcut)}
            >
              属性
            </MenuItem>
          </>
        ) : (
          <>
            <MenuItem icon={FolderAddRegular} onClick={onNewFolder}>新建文件夹</MenuItem>
            <MenuItem icon={ClipboardPasteRegular} disabled={!canPaste} onClick={onPaste}>
              粘贴
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={AppsListDetailRegular}
              submenu={{
                id: "view",
                open: activeSubmenu === "view",
                onOpen: () => setActiveSubmenu("view"),
              }}
              onClick={() => setActiveSubmenu("view")}
            >
              查看
            </MenuItem>
            <MenuItem
              icon={ArrowSortRegular}
              submenu={{
                id: "sort",
                open: activeSubmenu === "sort",
                onOpen: () => setActiveSubmenu("sort"),
              }}
              onClick={() => setActiveSubmenu("sort")}
            >
              排序方式
            </MenuItem>
            <MenuItem icon={ArrowClockwiseRegular} onClick={onRefresh}>刷新</MenuItem>
            <MenuSeparator />
            <MenuItem checked={autoArrange} checkType="checkbox" onClick={onToggleAutoArrange}>
              自动排列图标
            </MenuItem>
            <MenuItem checked={alignToGrid} checkType="checkbox" onClick={onToggleAlignToGrid}>
              将图标与网格对齐
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={SettingsRegular} onClick={onOpenSettings}>JARVIS 设置</MenuItem>

            {activeSubmenu === "view" ? (
              <div
                className="desktop-context-submenu is-view-submenu"
                role="menu"
                aria-label="Icon size"
                data-submenu-panel="view"
              >
                <MenuItem checked={iconSize === "large"} onClick={() => onSetIconSize("large")}>
                  大图标
                </MenuItem>
                <MenuItem checked={iconSize === "medium"} onClick={() => onSetIconSize("medium")}>
                  中等图标
                </MenuItem>
                <MenuItem checked={iconSize === "small"} onClick={() => onSetIconSize("small")}>
                  小图标
                </MenuItem>
              </div>
            ) : null}

            {activeSubmenu === "sort" ? (
              <div
                className="desktop-context-submenu is-sort-submenu"
                role="menu"
                aria-label="Sort desktop icons"
                data-submenu-panel="sort"
              >
                <MenuItem checked={sortMode === "name"} onClick={() => onSetSortMode("name")}>
                  名称
                </MenuItem>
                <MenuItem checked={sortMode === "type"} onClick={() => onSetSortMode("type")}>
                  项目类型
                </MenuItem>
                <MenuItem checked={sortMode === "source"} onClick={() => onSetSortMode("source")}>
                  来源
                </MenuItem>
                {sortMode === "none" ? (
                  <>
                    <MenuSeparator />
                    <div className="desktop-menu-hint">
                      <GridRegular aria-hidden="true" />
                      <span>当前保持系统返回顺序</span>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
