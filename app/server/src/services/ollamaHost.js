/**
 * Ollama URL resolver.
 *
 * When this server runs inside Docker (which is the default deployment),
 * a user-supplied URL like `http://localhost:11434` means the CONTAINER's
 * localhost — not the host machine's. Their actual Ollama is on the host,
 * which is reachable as `host.docker.internal` on Docker Desktop
 * (Mac/Windows) and via the docker bridge gateway on Linux.
 *
 * We auto-rewrite localhost / 127.0.0.1 → host.docker.internal whenever
 * we detect a container environment, so the user can keep typing the
 * natural `http://localhost:11434` and it Just Works.
 *
 * The override env var `OLLAMA_HOST_OVERRIDE` lets ops override (e.g. set
 * to the bridge gateway IP on Linux if host.docker.internal isn't
 * configured — `--add-host=host.docker.internal:host-gateway`).
 */
const fs = require('fs');

let cachedInContainer = null;
function inContainer() {
  if (cachedInContainer !== null) return cachedInContainer;
  // /.dockerenv exists on every Docker container image we ship
  try {
    if (fs.existsSync('/.dockerenv')) {
      cachedInContainer = true;
      return true;
    }
  } catch (_) {}
  // Linux fallback: containers have "docker"/"containerd"/"kubepods" in cgroup
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods/.test(cgroup)) {
      cachedInContainer = true;
      return true;
    }
  } catch (_) {}
  cachedInContainer = false;
  return false;
}

/** Default Ollama URL appropriate for this environment. */
function defaultOllamaUrl() {
  if (inContainer()) {
    const host = process.env.OLLAMA_HOST_OVERRIDE || 'host.docker.internal';
    return `http://${host}:11434`;
  }
  return 'http://localhost:11434';
}

/**
 * Rewrite a user-supplied Ollama base URL so it actually resolves from
 * inside this process.
 *
 *   resolveOllamaUrl()                            -> http://host.docker.internal:11434  (in container)
 *   resolveOllamaUrl('http://localhost:11434')    -> http://host.docker.internal:11434  (in container)
 *   resolveOllamaUrl('http://192.168.1.50:11434') -> unchanged
 *   resolveOllamaUrl('http://localhost:11434')    -> unchanged                          (on host)
 */
function resolveOllamaUrl(userUrl) {
  const raw = (userUrl && userUrl.trim()) || defaultOllamaUrl();
  if (!inContainer()) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0') {
      const host = process.env.OLLAMA_HOST_OVERRIDE || 'host.docker.internal';
      u.hostname = host;
      return u.toString().replace(/\/$/, '');
    }
    return raw;
  } catch (_) {
    return raw;
  }
}

module.exports = { resolveOllamaUrl, defaultOllamaUrl, inContainer };
