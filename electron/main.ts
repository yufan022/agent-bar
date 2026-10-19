import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { details, diff, status, sync } from "../lib/bridge/sync.ts";
import { parseSyncKinds, parseToolId } from "../lib/bridge/tool.ts";
import type { BridgeSyncRequest } from "../lib/ipc-types.ts";
import { collectMonitor } from "../lib/monitor/collect.ts";
import { fetchAllAgents } from "../lib/quota/fetch.ts";
import { formatTooltip, type AgentsQuotaResponse } from "../lib/quota/model.ts";

const POLL_MS = 300_000;
// Keep the popover open for local inspection. Unset for normal menu-bar behavior.
const showOnStart = process.env.AGENT_BAR_SHOW === "1";
const DEV_URL = process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:1420";
const POPOVER_WIDTH = 920;
const POPOVER_HEIGHT = 740;
const dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let window: BrowserWindow | null = null;
let cache: AgentsQuotaResponse | null = null;
let isQuitting = false;
let pollTimer: NodeJS.Timeout | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showPopover();
  });
  app.on("before-quit", () => {
    isQuitting = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
  void app.whenReady().then(() => {
    start().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`failed to start agent-bar: ${message}`);
      app.exit(1);
    });
  });
}

async function start(): Promise<void> {
  if (process.platform === "darwin") {
    app.setActivationPolicy("accessory");
    app.dock?.hide();
  }
  window = createWindow();
  tray = createTray();
  registerIpc();
  const starter = setTimeout(() => {
    void refreshAndEmit();
    pollTimer = setInterval(() => {
      void refreshAndEmit();
    }, POLL_MS);
  }, 1000);
  starter.unref?.();
}

function popoverSize(display: Electron.Display): { width: number; height: number } {
  const margin = 16;
  return {
    width: Math.min(POPOVER_WIDTH, display.workArea.width - margin),
    height: Math.min(POPOVER_HEIGHT, display.workArea.height - margin),
  };
}

function createWindow(): BrowserWindow {
  const initial = popoverSize(screen.getPrimaryDisplay());
  const popup = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    show: showOnStart,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popup.on("blur", () => {
    if (showOnStart || pointerOnTray() || isQuitting) {
      return;
    }
    popup.hide();
  });
  popup.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      popup.hide();
    }
  });
  popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popup.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged ? url.startsWith("file:") : url.startsWith(DEV_URL);
    if (!allowed) {
      event.preventDefault();
    }
  });
  const loaded = app.isPackaged
    ? popup.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"))
    : popup.loadURL(DEV_URL);
  loaded.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`failed to load agent-bar window: ${message}`);
  });
  return popup;
}

function loadMenuBarIcon(): Electron.NativeImage {
  const iconPath = path.join(app.getAppPath(), "assets/icons/32x32.png");
  if (!fs.existsSync(iconPath)) {
    return nativeImage.createEmpty();
  }
  // The file is a 32px bitmap. Treat it as @2x so the menu bar draws a 16pt
  // status icon instead of a 32pt one that fills the bar.
  const image = nativeImage.createFromBuffer(fs.readFileSync(iconPath), {
    scaleFactor: 2,
  });
  image.setTemplateImage(true);
  return image;
}

function createTray(): Tray {
  const icon = new Tray(loadMenuBarIcon());
  icon.setToolTip("agent-bar");
  const menu = Menu.buildFromTemplate([
    {
      label: "Refresh",
      click: () => {
        void refreshAndEmit();
      },
    },
    {
      label: "Monitor…",
      click: () => {
        openMonitor();
      },
    },
    {
      label: "Settings…",
      click: () => {
        openSettings();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  icon.on("click", () => {
    togglePopover();
  });
  icon.on("right-click", () => {
    icon.popUpContextMenu(menu);
  });
  return icon;
}

function registerIpc(): void {
  ipcMain.handle("quota:get", async () => {
    if (cache) {
      return cache;
    }
    cache = await loadQuota();
    return cache;
  });
  ipcMain.handle("quota:refresh", async () => {
    const response = await loadQuota();
    cache = response;
    updateTray(response);
    return response;
  });
  ipcMain.handle("bridge:status", (_event, tool: string | null) => {
    const parsed = tool ? parseToolId(tool) : null;
    return status(parsed);
  });
  ipcMain.handle("bridge:details", (_event, tool: string) => details(parseToolId(tool)));
  ipcMain.handle("bridge:diff", (_event, from: string, to: string) =>
    diff(parseToolId(from), parseToolId(to)),
  );
  ipcMain.handle("bridge:sync", (_event, request: BridgeSyncRequest) => {
    const report = sync({
      from: parseToolId(request.from),
      to: request.to.map((item) => parseToolId(item)),
      kinds: parseSyncKinds(request.only ?? []),
      dryRun: Boolean(request.dryRun),
      prune: Boolean(request.prune),
      force: Boolean(request.force),
    });
    return { ok: report.errors.length === 0, report };
  });
  ipcMain.handle("monitor:sample", () => collectMonitor());
  ipcMain.handle("autostart:is-enabled", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("autostart:enable", () => {
    app.setLoginItemSettings({ openAtLogin: true });
  });
  ipcMain.handle("autostart:disable", () => {
    app.setLoginItemSettings({ openAtLogin: false });
  });
}

async function refreshAndEmit(): Promise<void> {
  try {
    const response = await loadQuota();
    cache = response;
    updateTray(response);
    if (window && !window.isDestroyed()) {
      window.webContents.send("quota-updated", response);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`quota refresh failed: ${message}`);
  }
}

async function loadQuota(): Promise<AgentsQuotaResponse> {
  const agents = await fetchAllAgents();
  return { agents, refreshedAt: new Date().toISOString() };
}

function updateTray(response: AgentsQuotaResponse): void {
  tray?.setToolTip(formatTooltip(response));
}

function togglePopover(): void {
  if (!window) {
    return;
  }
  if (window.isVisible()) {
    window.hide();
    return;
  }
  showPopover();
}

function showPopover(): void {
  if (!window || !tray) {
    return;
  }
  const bounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const { width, height } = popoverSize(display);
  const [currentWidth, currentHeight] = window.getSize();
  if (currentWidth !== width || currentHeight !== height) {
    window.setSize(width, height, false);
  }
  let x = Math.round(bounds.x + bounds.width / 2 - width / 2);
  let y = Math.round(bounds.y + bounds.height + 6);
  if (bounds.y > display.workArea.y + display.workArea.height / 2) {
    y = Math.round(bounds.y - height - 6);
  }
  const area = display.workArea;
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  window.setPosition(x, y, false);
  window.show();
  window.focus();
}

function openSettings(): void {
  showPopover();
  window?.webContents.send("open-settings");
}

function openMonitor(): void {
  showPopover();
  window?.webContents.send("open-monitor");
}

function pointerOnTray(): boolean {
  if (!tray) {
    return false;
  }
  const cursor = screen.getCursorScreenPoint();
  const bounds = tray.getBounds();
  return (
    cursor.x >= bounds.x &&
    cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y &&
    cursor.y < bounds.y + bounds.height
  );
}
