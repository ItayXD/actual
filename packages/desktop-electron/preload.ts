// @ts-strict-ignore
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRenderer } from 'electron';

import type {
  GetBootstrapDataPayload,
  OpenFileDialogPayload,
  SaveFileDialogPayload,
} from './index';

const { version: VERSION, isDev: IS_DEV }: GetBootstrapDataPayload =
  ipcRenderer.sendSync('get-bootstrap-data');

// fork: updates come from this fork's releases (fork-updater.ts) and are
// surfaced through upstream's web "update ready" hooks below.
let isForkUpdateReady = false;
const forkUpdateReady = new Promise<void>(resolve => {
  const markReady = () => {
    isForkUpdateReady = true;
    resolve();
  };
  ipcRenderer.on('fork-update-ready', markReady);
  void ipcRenderer.invoke('fork-update-status').then(version => {
    if (version) markReady();
  });
});

contextBridge.exposeInMainWorld('Actual', {
  IS_DEV,
  ACTUAL_VERSION: VERSION,
  logToTerminal: console.log,
  ipcConnect: (
    func: (payload: {
      on: IpcRenderer['on'];
      emit: (name: string, data: unknown) => void;
    }) => void,
  ) => {
    func({
      on(name, handler) {
        return ipcRenderer.on(name, (_event, value) => handler(value));
      },
      emit(name, data) {
        return ipcRenderer.send('message', { name, args: data });
      },
    });
  },

  startSyncServer: () => ipcRenderer.invoke('start-sync-server'),

  stopSyncServer: () => ipcRenderer.invoke('stop-sync-server'),

  isSyncServerRunning: () => ipcRenderer.invoke('is-sync-server-running'),

  startOAuthServer: () => ipcRenderer.invoke('start-oauth-server'),

  relaunch: () => {
    void ipcRenderer.invoke('relaunch');
  },

  restartElectronServer: () => {
    void ipcRenderer.invoke('restart-server');
  },

  openFileDialog: (opts: OpenFileDialogPayload) => {
    return ipcRenderer.invoke('open-file-dialog', opts);
  },

  saveFile: async (
    contents: SaveFileDialogPayload['fileContents'],
    filename: SaveFileDialogPayload['defaultPath'],
    dialogTitle: SaveFileDialogPayload['title'],
  ) => {
    await ipcRenderer.invoke('save-file-dialog', {
      title: dialogTitle,
      defaultPath: filename,
      fileContents: contents,
    });
  },

  openURLInBrowser: (url: string) => {
    void ipcRenderer.invoke('open-external-url', url);
  },

  openInFileManager: (filepath: string) => {
    void ipcRenderer.invoke('open-in-file-manager', filepath);
  },

  onEventFromMain: (type: string, handler: (...args: unknown[]) => void) => {
    ipcRenderer.on(type, handler);
  },

  isUpdateReadyForDownload: () => isForkUpdateReady,
  waitForUpdateReadyForDownload: () => forkUpdateReady,

  getServerSocket: async () => {
    return null;
  },

  setTheme: (theme: string) => {
    ipcRenderer.send('set-theme', theme);
  },

  moveBudgetDirectory: (
    currentBudgetDirectory: string,
    newDirectory: string,
  ) => {
    return ipcRenderer.invoke(
      'move-budget-directory',
      currentBudgetDirectory,
      newDirectory,
    );
  },

  setDocumentDir: (directory: string) => {
    return ipcRenderer.invoke('set-document-dir', directory);
  },

  reload: async () => {
    throw new Error('Reload not implemented in electron app');
  },

  applyAppUpdate: () => ipcRenderer.invoke('fork-update-apply'),
} satisfies typeof global.Actual);
