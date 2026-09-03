// ProspectPro Desktop — a lightweight native shell around the hosted ProspectPro app.
// One license per download/install: the app is tied to the single login the rep enters
// on first launch (server-side seat limits on the "Desktop" plan enforce 1 seat/1 territory).
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Same domain the web app is hosted on — change here if the production URL ever changes.
const APP_URL = process.env.PROSPECTPRO_URL || 'https://prospectpro-1d8c.onrender.com/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'ProspectPro',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f2338',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setMenuBarVisibility(false);
  win.loadURL(APP_URL);

  // Open any external links (e.g. Terms/Privacy, mailto:, CRM affiliate links) in the
  // system default browser instead of inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
