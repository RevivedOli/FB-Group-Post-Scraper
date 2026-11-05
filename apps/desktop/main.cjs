const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3001);
const HOST = '127.0.0.1';
const APP_URL = `http://${HOST}:${PORT}`;

let mainWindow;
let apiProcess;
let stopping = false;

function serverRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  return path.join(__dirname, '../..');
}

function apiEntryPath() {
  return path.join(serverRoot(), 'apps/api/dist/index.js');
}

function webDistPath() {
  return path.join(serverRoot(), 'apps/web/dist');
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${APP_URL}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitForHealth(timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await checkHealth()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startApiProcess() {
  const root = serverRoot();
  const entry = apiEntryPath();
  const webDist = webDistPath();

  if (!fs.existsSync(entry)) {
    throw new Error(`API build missing at ${entry}. Run npm run build first.`);
  }
  if (!fs.existsSync(webDist)) {
    throw new Error(`Web build missing at ${webDist}. Run npm run build first.`);
  }

  apiProcess = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      WEB_DIST: webDist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  apiProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[api] ${chunk}`);
  });
  apiProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(`[api] ${chunk}`);
  });
  apiProcess.on('exit', (code, signal) => {
    apiProcess = undefined;
    if (!stopping && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Local Group Monitor',
        `The local server stopped unexpectedly (${signal || code}).`,
      );
    }
  });
}

async function ensureApi() {
  if (await checkHealth()) {
    return;
  }
  startApiProcess();
  const ok = await waitForHealth();
  if (!ok) {
    throw new Error('Timed out waiting for the local server to start.');
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.icns');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Local Group Monitor',
    // Packaged builds use the .app bundle icon; this helps unpackaged `npm run desktop`.
    icon: !app.isPackaged && fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(APP_URL);
}

async function boot() {
  try {
    await ensureApi();
    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Local Group Monitor failed to start', message);
    app.quit();
  }
}

function stopApi() {
  stopping = true;
  if (!apiProcess || apiProcess.killed) return;
  apiProcess.kill('SIGTERM');
  setTimeout(() => {
    if (apiProcess && !apiProcess.killed) {
      apiProcess.kill('SIGKILL');
    }
  }, 1500).unref?.();
}

app.whenReady().then(() => {
  void boot();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void boot();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopApi();
});
