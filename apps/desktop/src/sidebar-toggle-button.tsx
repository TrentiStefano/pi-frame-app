import { SidebarToggleIcon } from "./icons";
import { useTranslation } from "react-i18next";

interface SidebarToggleButtonProps {
  readonly collapsed: boolean;
  readonly shortcutLabel: string;
  readonly onToggle: () => void;
}

export function SidebarToggleButton({ collapsed, shortcutLabel, onToggle }: SidebarToggleButtonProps) {
  const { t } = useTranslation();
  return (
    <div className="shortcut-tooltip-wrap sidebar-toggle">
      <button
        aria-label={t("shell.toggleSidebar")}
        aria-pressed={!collapsed}
        className="icon-button sidebar-toggle__button"
        data-testid="sidebar-toggle"
        type="button"
        onClick={onToggle}
      >
        <SidebarToggleIcon />
      </button>
      <span className="shortcut-tooltip sidebar-toggle__tooltip" role="tooltip">
        <span>{t("shell.toggleSidebar")}</span>
        <kbd>{shortcutLabel}</kbd>
      </span>
    </div>
  );
}
