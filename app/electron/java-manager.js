const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const EventEmitter = require('events');

const emitter = new EventEmitter();
let javaProcess = null;
let running = false;

const ENGINE_PORT = 8081;
const HEALTH_URL = `http://localhost:${ENGINE_PORT}/api/engine/health`;
const MAX_RETRIES = 30;
const RETRY_INTERVAL = 500;

function findJarPath() {
  const { app } = require('electron');
  const isDev = !app.isPackaged;

  if (isDev) {
    return path.join(__dirname, '..', '..', 'engine', 'target', 'saas-to-talend-engine.jar');
  }
  // Production: look in extraResources
  return path.join(process.resourcesPath, 'engine', 'saas-to-talend-engine.jar');
}

function findJava() {
  try {
    execSync('java -version', { stdio: 'pipe' });
    return 'java';
  } catch {
    // Fall back to bundled JRE paths
    const bundledPaths = [
      path.join(process.resourcesPath || '', 'jre', 'bin', 'java'),
      path.join(process.resourcesPath || '', 'jre', 'bin', 'java.exe'),
    ];
    for (const p of bundledPaths) {
      try {
        execSync(`"${p}" -version`, { stdio: 'pipe' });
        return p;
      } catch {
        continue;
      }
    }
    throw new Error('Java not found. Install Java 17+ or bundle a JRE.');
  }
}

function healthCheck() {
  return new Promise((resolve) => {
    http.get(HEALTH_URL, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => {
      resolve(false);
    });
  });
}

async function waitForReady() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const ok = await healthCheck();
    if (ok) {
      running = true;
      emitter.emit('ready');
      return true;
    }
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
  }
  throw new Error(`Java engine did not become ready after ${MAX_RETRIES} retries`);
}

async function startEngine() {
  if (running && javaProcess) {
    return;
  }

  const javaPath = findJava();
  const jarPath = findJarPath();

  console.log(`Starting Java engine: ${javaPath} -jar ${jarPath}`);

  javaProcess = spawn(javaPath, [
    '-jar', jarPath,
    `--server.port=${ENGINE_PORT}`,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  javaProcess.stdout.on('data', (data) => {
    console.log(`[Engine] ${data.toString().trim()}`);
  });

  javaProcess.stderr.on('data', (data) => {
    console.error(`[Engine:err] ${data.toString().trim()}`);
  });

  javaProcess.on('error', (err) => {
    running = false;
    emitter.emit('error', err);
    console.error('Java engine process error:', err);
  });

  javaProcess.on('exit', (code) => {
    running = false;
    javaProcess = null;
    emitter.emit('stopped', code);
    console.log(`Java engine exited with code ${code}`);
  });

  await waitForReady();
}

async function stopEngine() {
  if (javaProcess) {
    console.log('Stopping Java engine...');
    javaProcess.kill('SIGTERM');

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (javaProcess) {
          javaProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      if (javaProcess) {
        javaProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    running = false;
    javaProcess = null;
  }
}

function isRunning() {
  return running;
}

function getPort() {
  return ENGINE_PORT;
}

module.exports = {
  startEngine,
  stopEngine,
  isRunning,
  getPort,
  on: emitter.on.bind(emitter),
  off: emitter.off.bind(emitter),
};
