import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  inputText: (text: string, appendEnter?: boolean) => 
    ipcRenderer.invoke('input:text', text, appendEnter),
  executeShortcut: (shortcut: string) => 
    ipcRenderer.invoke('execute:shortcut', shortcut),
  getConfig: () => 
    ipcRenderer.invoke('config:get'),
  setConfig: (config: any) => 
    ipcRenderer.invoke('config:set', config),
  resizeWindow: (width: number, height: number) => 
    ipcRenderer.invoke('window:resize', width, height)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
