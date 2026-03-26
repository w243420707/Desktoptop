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
    ipcRenderer.invoke('window:setPosition', x, y),
  // NOTE: 模态框打开时设为 true（允许键盘输入），关闭时设为 false（不抢焦点）
  setFocusable: (focusable: boolean) =>
    ipcRenderer.invoke('window:setFocusable', focusable)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI


