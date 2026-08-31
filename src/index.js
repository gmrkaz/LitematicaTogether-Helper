'use strict';

// Install ticket escalation handlers before the Discord client logs in.
require('./escalation').installEscalationHook();
// Apply Discord Enhanced Role Styles as soon as the client becomes ready.
require('./role-styles').installRoleStylesHook();

// Discord HELPER stays in the main process. The Litematica Together relay runs
// separately, so a relay crash or memory spike cannot intentionally terminate
// the Discord gateway process.
require('./bot');

const { fork } = require('child_process');
const path = require('path');

let relay = null;
let restartTimer = null;
let stopping = false;
let crashCount = 0;

function startRelay() {
  if (stopping) return;

  const heapMb = String(process.env.LTT_RELAY_HEAP_MB || '96');
  relay = fork(path.join(__dirname, 'ltt-service.js'), [], {
    stdio: 'inherit',
    env: process.env,
    execArgv: [`--max-old-space-size=${heapMb}`]
  });

  console.log(`[LTT RELAY] started pid=${relay.pid}, heap limit=${heapMb}MB`);

  relay.once('exit', (code, signal) => {
    relay = null;
    if (stopping) return;

    crashCount += 1;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(crashCount - 1, 5)));
    console.error(`[LTT RELAY] exited code=${code ?? 'null'} signal=${signal || 'none'}; restarting in ${delay}ms`);
    restartTimer = setTimeout(startRelay, delay);
  });

  relay.on('error', error => {
    console.error('[LTT RELAY] child process error', error);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (relay && !relay.killed) relay.kill('SIGTERM');
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

startRelay();
