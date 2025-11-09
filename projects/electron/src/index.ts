import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null;

const size = { minWidth: 1024, minHeight: 600 };

const createWindow = (): void => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    height: size.minHeight,
    width: size.minWidth,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    title: 'OrbitOPL Toolbox',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'OrbitOPL Toolbox',
        submenu: [
          {
            label: 'Quit',
            accelerator: 'CmdOrCtrl+Q',
            click: () => {
              app.quit();
            },
          },
        ],
      },
    ]),
  );

  const startURL = app.isPackaged
    ? `file://${path.join(__dirname, 'orbitopl-toolbox', 'index.html')}`
    : `http://localhost:4200`;

  mainWindow.loadURL(startURL);
};

app.on('ready', () => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
