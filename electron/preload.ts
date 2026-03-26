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
    ipcRenderer.invoke('window:resize', width, height),
  getWindowPosition: () =>
    ipcRenderer.invoke('window:getPosition'),
  setWindowPosition: (x: number, y: number) =>
    ipcRenderer.invoke('window:setPosition', x, y)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
