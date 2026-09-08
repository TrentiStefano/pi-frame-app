import { expect, test } from "@playwright/test";
import { applicationMenuIds } from "../../src/ipc";
import { launchDesktop, makeUserDataDir, makeWorkspace, waitForWorkspaceByPath } from "../helpers/electron-app";

test("integrates the Windows title bar with the application shell", async () => {
  test.skip(process.platform !== "win32", "Windows shell geometry only applies on Windows");

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("windows-shell-workspace");
  const run = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await run.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    const nativeMenus = await run.electronApp.evaluate(({ Menu }, menuIds) =>
      menuIds.map((menuId) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
        return { id: item?.id, label: item?.label, itemCount: item?.submenu?.items.length ?? 0 };
      }), Object.values(applicationMenuIds));

    const geometry = await window.evaluate(() => {
      const main = document.querySelector<HTMLElement>(".main");
      const newThread = document.querySelector<HTMLElement>(".sidebar__new");
      const topbar = document.querySelector<HTMLElement>(".topbar");
      const titlebarMenu = document.querySelector<HTMLElement>(".windows-titlebar-menu");
      const titlebarMenuButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".windows-titlebar-menu__button"),
      );
      if (!main || !newThread || !topbar || !titlebarMenu) {
        return null;
      }

      const mainRect = main.getBoundingClientRect();
      const newThreadRect = newThread.getBoundingClientRect();
      const topbarRect = topbar.getBoundingClientRect();
      const titlebarMenuRect = titlebarMenu.getBoundingClientRect();
      const mainStyle = getComputedStyle(main);
      const topbarStyle = getComputedStyle(topbar);
      return {
        platform: document.documentElement.dataset.platform,
        mainInsetTop: mainRect.top,
        mainInsetRight: window.innerWidth - mainRect.right,
        mainRadius: Number.parseFloat(mainStyle.borderTopLeftRadius),
        newThreadTop: newThreadRect.top,
        topbarBackground: topbarStyle.backgroundColor,
        mainBackground: mainStyle.backgroundColor,
        topbarTop: topbarRect.top,
        topbarBorderBottomWidth: Number.parseFloat(topbarStyle.borderBottomWidth),
        topbarFits: topbar.scrollWidth <= topbar.clientWidth,
        menuTop: titlebarMenuRect.top,
        menuBottom: titlebarMenuRect.bottom,
        menuRight: titlebarMenuRect.right,
        menuLabels: titlebarMenuButtons.map((button) => button.textContent?.trim()),
        menuButtonsFit: titlebarMenuButtons.every((button) => button.scrollWidth <= button.clientWidth),
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry?.platform).toBe("win32");
    expect(geometry?.mainInsetTop).toBe(46);
    expect(geometry?.mainInsetRight).toBe(0);
    expect(geometry?.mainRadius).toBe(0);
    expect(geometry?.newThreadTop).toBeGreaterThanOrEqual(36);
    expect(geometry?.newThreadTop).toBeLessThan(68);
    expect(geometry?.topbarBackground).toBe(geometry?.mainBackground);
    expect(geometry?.topbarTop).toBeGreaterThanOrEqual(46);
    expect(geometry?.topbarBorderBottomWidth).toBe(0);
    expect(geometry?.topbarFits).toBe(true);
    expect(geometry?.menuTop).toBe(0);
    expect(geometry?.menuBottom).toBe(46);
    expect(geometry?.menuRight).toBeLessThan(360);
    expect(geometry?.menuLabels).toEqual(nativeMenus.map((menu) => menu.label));
    expect(geometry?.menuButtonsFit).toBe(true);
    expect(nativeMenus.map((menu) => menu.id)).toEqual(Object.values(applicationMenuIds));
    expect(nativeMenus.every((menu) => menu.itemCount > 0)).toBe(true);
  } finally {
    await run.close();
  }
});
