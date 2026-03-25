declare global {
  interface Window {
    electronAPI: {
      inputText: (text: string) => Promise<{ success: boolean; error?: string }>
      executeShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>
      getConfig: () => Promise<{ buttons: any[] }>
      setConfig: (config: any) => Promise<{ success: boolean; error?: string }>
    }
  }
}

export {}
