// The fork's self-updater: installs new builds from this fork's own GitHub
// releases (ItayXD/actual), not upstream's.
//
// Upstream's desktop app has no installer-updater, only the web app's
// "update ready" hooks (`isUpdateReadyForDownload`, `waitForUpdateReadyForDownload`,
// `applyAppUpdate` on `window.Actual`), which the Electron preload stubs out.
// The fork's preload wires those three to this module, so upstream's own
// "A new version of Actual is available! [Update now]" notification
// (FinancesApp.tsx) drives the install and desktop-client needs no changes.
//
// Flow: check the releases every few hours → download the installer for this
// platform/arch → verify its size and SHA-256 (GitHub's asset `digest`) →
// tell the renderer → on "Update now", install over the running app:
//   - macOS: copy Actual.app out of the DMG next to the installed bundle, quit,
//     and let a detached script swap the bundles and reopen the app.
//   - Windows: run the NSIS installer silently and quit; it relaunches the app.
//
// Builds are unsigned (ad-hoc on macOS), so there is no publisher signature to
// check; the digest proves the file is the one attached to the release.

import { execFile, spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';

import { app, BrowserWindow, ipcMain, net, shell } from 'electron';

import {
  FORK_REPO,
  parseForkVersion,
  pickForkUpdate,
} from './fork-update-version';
import type { ForkUpdate, GitHubRelease } from './fork-update-version';

const execFileAsync = promisify(execFile);

const FIRST_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const FORK_UPDATE_READY_EVENT = 'fork-update-ready';

type Log = (level: 'info' | 'error', message: string) => void;

type ReadyUpdate = { update: ForkUpdate; file: string };

let readyUpdate: ReadyUpdate | null = null;
let isChecking = false;
let log: Log = (level, message) => console[level](message);

// Best-effort cleanup steps whose failure must not abort an install.
function ignoreError() {
  return undefined;
}

function updatesDir() {
  return path.join(app.getPath('userData'), 'fork-updates');
}

async function fetchReleases(): Promise<GitHubRelease[]> {
  const response = await net.fetch(
    `https://api.github.com/repos/${FORK_REPO}/releases?per_page=30`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'actual-fork-updater',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub releases returned ${response.status}`);
  }
  return (await response.json()) as GitHubRelease[];
}

async function download(update: ForkUpdate): Promise<string> {
  const dir = updatesDir();
  // Only one update is ever kept; drop older downloads and partials.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const file = path.join(dir, update.assetName);
  const partial = `${file}.partial`;

  const response = await net.fetch(update.url, {
    headers: { 'User-Agent': 'actual-fork-updater' },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Download of ${update.assetName} returned ${response.status}`,
    );
  }

  const hash = createHash('sha256');
  let size = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    measure,
    fs.createWriteStream(partial),
  );

  if (size !== update.size) {
    await rm(partial, { force: true });
    throw new Error(
      `${update.assetName} is ${size} bytes, the release says ${update.size}`,
    );
  }
  const digest = hash.digest('hex');
  if (update.sha256 && digest !== update.sha256) {
    await rm(partial, { force: true });
    throw new Error(`${update.assetName} failed its SHA-256 check`);
  }
  if (!update.sha256) {
    log('info', `Fork update: ${update.tag} has no digest; checked size only`);
  }

  await rename(partial, file);
  return file;
}

async function checkForUpdate() {
  if (isChecking) {
    return;
  }
  isChecking = true;
  try {
    const update = pickForkUpdate(
      await fetchReleases(),
      app.getVersion(),
      process.platform,
      process.arch,
    );
    if (!update || readyUpdate?.update.version === update.version) {
      return;
    }

    log('info', `Fork update: downloading ${update.tag}`);
    const file = await download(update);
    readyUpdate = { update, file };
    log('info', `Fork update: ${update.tag} is ready to install`);

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(FORK_UPDATE_READY_EVENT, update.version);
    }
  } catch (error) {
    log('error', `Fork update check failed: ${String(error)}`);
  } finally {
    isChecking = false;
  }
}

// Swaps the staged bundle in once the app has quit, then reopens it. Runs
// detached so it outlives the app. The old bundle is only deleted after the
// new one is in place, and is put back if the move fails.
const MAC_INSTALL_SCRIPT = `#!/bin/bash
pid="$1"; staged="$2"; target="$3"
for _ in $(seq 1 600); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
old="\${target%.app}.old-$$.app"
if mv "$target" "$old"; then
  if mv "$staged" "$target"; then
    rm -rf "$old"
  else
    mv "$old" "$target"
  fi
fi
open "$target"
`;

async function installMac({ update, file }: ReadyUpdate): Promise<boolean> {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  const parent = path.dirname(bundle);
  const canReplaceInPlace =
    bundle.endsWith('.app') &&
    !bundle.includes('/AppTranslocation/') &&
    (await access(parent, fs.constants.W_OK).then(
      () => true,
      () => false,
    ));
  if (!canReplaceInPlace) {
    log('info', `Fork update: cannot replace ${bundle}; opening the DMG`);
    await shell.openPath(file);
    return false;
  }

  // Staged beside the installed app so the final swap is a same-volume rename.
  const staged = path.join(parent, `.Actual-update-${update.version}.app`);
  await rm(staged, { recursive: true, force: true });

  const mountPoint = await mkdtemp(path.join(os.tmpdir(), 'actual-update-'));
  await execFileAsync('hdiutil', [
    'attach',
    '-nobrowse',
    '-noautoopen',
    '-readonly',
    '-mountpoint',
    mountPoint,
    file,
  ]);
  try {
    const appName = (await readdir(mountPoint)).find(name =>
      name.endsWith('.app'),
    );
    if (!appName) {
      throw new Error('The update DMG holds no .app');
    }
    await execFileAsync('ditto', [path.join(mountPoint, appName), staged]);
  } finally {
    await execFileAsync('hdiutil', ['detach', mountPoint, '-force']).catch(
      ignoreError,
    );
    await rm(mountPoint, { recursive: true, force: true });
  }
  // Downloaded by the app itself, so normally unquarantined already.
  await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', staged]).catch(
    ignoreError,
  );

  const script = path.join(updatesDir(), 'install.sh');
  await writeFile(script, MAC_INSTALL_SCRIPT, { mode: 0o755 });
  spawn('/bin/bash', [script, String(process.pid), staged, bundle], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  return true;
}

function installWindows({ file }: ReadyUpdate): boolean {
  // The flags electron-updater passes to an electron-builder NSIS installer:
  // silent, treat as an update, and start the app when done.
  spawn(file, ['--updated', '/S', '--force-run'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  return true;
}

async function applyUpdate(): Promise<void> {
  const ready = readyUpdate;
  if (!ready) {
    return;
  }
  log('info', `Fork update: installing ${ready.update.tag}`);
  try {
    const willRestart =
      process.platform === 'darwin'
        ? await installMac(ready)
        : process.platform === 'win32'
          ? installWindows(ready)
          : false;
    if (willRestart) {
      app.quit();
    }
  } catch (error) {
    // Never throw into the renderer: App.tsx awaits this during startup.
    log('error', `Fork update install failed: ${String(error)}`);
    await shell.openPath(ready.file);
  }
}

export function startForkUpdater(options: { enabled: boolean; log: Log }) {
  log = options.log;

  ipcMain.handle('fork-update-status', () =>
    readyUpdate ? readyUpdate.update.version : null,
  );
  ipcMain.handle('fork-update-apply', () => applyUpdate());

  if (
    !options.enabled ||
    process.env.ACTUAL_FORK_UPDATES === 'off' ||
    // A vanilla version string means this isn't a fork build at all.
    !parseForkVersion(app.getVersion())
  ) {
    return;
  }

  setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
}
