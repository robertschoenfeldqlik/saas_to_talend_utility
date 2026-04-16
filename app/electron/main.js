const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { startEngine, stopEngine, isRunning } = require('./java-manager');

let mainWindow = null;
let expressServer = null;

const isDev = !app.isPackaged;
const EXPRESS_PORT = 3000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`http://localhost:${EXPRESS_PORT}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Export Workspace...',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('navigate', '/export');
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Talend Documentation',
          click: () => shell.openExternal('https://help.talend.com/'),
        },
        {
          label: 'About SaaS to Talend',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About SaaS to Talend',
              message: 'SaaS to Talend v1.0.0',
              detail: 'Generate Talend integration jobs from SaaS API specifications.\n\nPowered by Spring Boot engine.',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function startExpressServer() {
  return new Promise((resolve, reject) => {
    try {
      const serverPath = path.join(__dirname, '..', 'server', 'src', 'index.js');
      expressServer = require(serverPath);
      resolve();
    } catch (err) {
      console.error('Failed to start Express server:', err);
      reject(err);
    }
  });
}

app.whenReady().then(async () => {
  buildMenu();

  try {
    // Start Java engine in background
    startEngine().catch((err) => {
      console.warn('Java engine failed to start:', err.message);
      console.warn('The app will work but engine features will be unavailable.');
    });

    // Start Express server (only in production; in dev it runs separately)
    if (!isDev) {
      await startExpressServer();
    }

    createWindow();
  } catch (err) {
    console.error('Application startup failed:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  try {
    await stopEngine();
  } catch (err) {
    console.error('Error stopping Java engine:', err);
  }
});
