import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { applicationMenuIds, type ApplicationMenuId, type PiDesktopApi } from "./ipc";

interface WindowsTitlebarMenuProps {
  readonly api: PiDesktopApi;
  readonly sidebarToggle: ReactNode;
}

const menuItems: ReadonlyArray<{ readonly id: ApplicationMenuId; readonly labelKey: string }> = [
  { id: applicationMenuIds.file, labelKey: "native.fileMenu" },
  { id: applicationMenuIds.edit, labelKey: "native.editMenu" },
  { id: applicationMenuIds.view, labelKey: "native.viewMenu" },
  { id: applicationMenuIds.window, labelKey: "native.windowMenu" },
];

export function WindowsTitlebarMenu({ api, sidebarToggle }: WindowsTitlebarMenuProps) {
  const { t } = useTranslation();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (api.platform !== "win32") {
    return null;
  }

  const openMenu = (menuId: ApplicationMenuId, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    void api.showApplicationMenu({ menuId, x: rect.left, y: rect.bottom });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % menuItems.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + menuItems.length) % menuItems.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = menuItems.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }
    event.preventDefault();
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <nav aria-label={t("shell.applicationMenu")} className="windows-titlebar-menu">
      <div role="menubar">
        {menuItems.map((item, index) => (
          <button
            aria-haspopup="menu"
            className="windows-titlebar-menu__button"
            key={item.id}
            ref={(button) => {
              buttonRefs.current[index] = button;
            }}
            role="menuitem"
            type="button"
            onClick={(event) => openMenu(item.id, event.currentTarget)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      {sidebarToggle ? <div className="windows-titlebar-menu__utility">{sidebarToggle}</div> : null}
    </nav>
  );
}
