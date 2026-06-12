#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Container entrypoint — supervise Java engine + Express server
#
# Both must be running for the app to work. If either dies, we exit so
# Docker can restart the whole container (failure detected via healthcheck).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

cd /opt/app

# ── 1. Start the Java engine in the background ────────────────────────────
echo "[entrypoint] starting Java engine on :8081 ..."
java ${JAVA_OPTS:--Xmx4g} -jar ./engine.jar \
     --server.port=8081 \
     --spring.main.banner-mode=off \
     > /tmp/engine.log 2>&1 &
ENGINE_PID=$!

# ── 2. Wait until engine is healthy (max ~30s) ────────────────────────────
for i in $(seq 1 60); do
    if curl -sf http://localhost:8081/api/engine/health > /dev/null 2>&1; then
        echo "[entrypoint] Java engine ready (pid=$ENGINE_PID)"
        break
    fi
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
        echo "[entrypoint] Java engine crashed during startup. Log:"
        tail -50 /tmp/engine.log
        exit 1
    fi
    sleep 0.5
done

# ── 3. Start the Express server in the background ─────────────────────────
echo "[entrypoint] starting Express server on :${PORT:-3000} ..."
cd /opt/app/server
node src/index.js > /tmp/server.log 2>&1 &
SERVER_PID=$!

# ── 4. Tail logs to container stdout so `docker logs` shows everything ────
cd /opt/app
tail -f /tmp/engine.log /tmp/server.log &
TAIL_PID=$!

# ── 5. Propagate signals; gracefully shut down children on TERM/INT ──────
GRACE_SECONDS="${SHUTDOWN_GRACE_SECONDS:-20}"

graceful_stop() {
    local sig="${1:-TERM}"
    echo "[entrypoint] received $sig — sending SIGTERM to children (grace ${GRACE_SECONDS}s)"
    # Send SIGTERM so Express + Spring can flush + close DB cleanly
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    kill -TERM "$ENGINE_PID" 2>/dev/null || true

    # Wait up to grace period for children to exit
    local waited=0
    while [ $waited -lt $GRACE_SECONDS ]; do
        local alive=0
        kill -0 "$SERVER_PID" 2>/dev/null && alive=1
        kill -0 "$ENGINE_PID" 2>/dev/null && alive=1
        [ $alive -eq 0 ] && break
        sleep 1
        waited=$((waited+1))
    done

    # Force-kill any survivors
    kill -KILL "$SERVER_PID" 2>/dev/null || true
    kill -KILL "$ENGINE_PID" 2>/dev/null || true
    kill -KILL "$TAIL_PID"   2>/dev/null || true
    echo "[entrypoint] shutdown complete after ${waited}s"
    exit 0
}
trap 'graceful_stop TERM' TERM
trap 'graceful_stop INT'  INT

while true; do
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
        echo "[entrypoint] Java engine died (pid=$ENGINE_PID). Exiting."
        kill $SERVER_PID $TAIL_PID 2>/dev/null || true
        exit 1
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[entrypoint] Express server died (pid=$SERVER_PID). Exiting."
        kill $ENGINE_PID $TAIL_PID 2>/dev/null || true
        exit 1
    fi
    sleep 5
done
