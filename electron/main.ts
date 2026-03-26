import { app, BrowserWindow, screen, clipboard, ipcMain } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import Store from 'electron-store'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

interface QuickButton {
  id: string
  name: string
  type: 'text' | 'shortcut'
  content: string
  appendEnter?: boolean
}

interface AppConfig {
  buttons: QuickButton[]
  windowPosition?: { x: number; y: number }
}

const configDir = join(app.getPath('appData'), 'desktop-quick-button')
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true })
}

const store = new Store<AppConfig>({
  cwd: configDir,
  name: 'config'
})

const DEFAULT_BUTTONS: QuickButton[] = [
  { id: '1', name: '复制', type: 'shortcut', content: 'Ctrl+C' },
  { id: '2', name: '粘贴', type: 'shortcut', content: 'Ctrl+V' }
]

const WINDOW_WIDTH = 100
const WINDOW_MIN_HEIGHT = 300
const WINDOW_MAX_HEIGHT = 500
const BUTTON_HEIGHT = 32
const BUTTON_GAP = 4
// NOTE: 顶部拖拽手柄高度 18px + 下方间距 4px
const HEADER_HEIGHT = 22
const CONTAINER_PADDING = 12

let mainWindow: BrowserWindow | null = null

function calculateWindowHeight(buttonCount: number): number {
  const height = HEADER_HEIGHT + CONTAINER_PADDING + buttonCount * BUTTON_HEIGHT + (buttonCount - 1) * BUTTON_GAP + CONTAINER_PADDING
  return Math.min(Math.max(height, WINDOW_MIN_HEIGHT), WINDOW_MAX_HEIGHT)
}

function getDefaultPosition(height: number): { x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height: screenHeight } = primaryDisplay.workAreaSize
  return {
    x: width - WINDOW_WIDTH - 20,
    y: screenHeight - height - 20
  }
}

function getSavedPosition(height: number): { x: number; y: number } {
  const savedPosition = store.get('windowPosition')
  if (savedPosition) {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height: screenHeight } = primaryDisplay.workAreaSize
    if (savedPosition.x >= 0 && savedPosition.x <= width - WINDOW_WIDTH &&
        savedPosition.y >= 0 && savedPosition.y <= screenHeight - height) {
      return savedPosition
    }
  }
  return getDefaultPosition(height)
}

function saveWindowPosition(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition()
    store.set('windowPosition', { x, y })
  }
}

function createWindow(): void {
  const buttons = store.get('buttons', DEFAULT_BUTTONS)
  const buttonCount = buttons?.length || 0
  const height = calculateWindowHeight(buttonCount)
  const position = getSavedPosition(height)

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: height,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    maxWidth: WINDOW_WIDTH,
    maxHeight: WINDOW_MAX_HEIGHT,
    x: position.x,
    y: position.y,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    // NOTE: 初始设置为不可聚焦，防止点击按钮时从目标应用抢走焦点
    focusable: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', () => {
    saveWindowPosition()
  })

  mainWindow.on('moved', () => {
    saveWindowPosition()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  saveWindowPosition()
})

// ========== VBScript SendKeys ==========

function convertToSendKeys(shortcut: string): string {
  const parts = shortcut.split('+').map(p => p.trim().toLowerCase())

  let result = ''
  let mainKey = ''

  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') {
      result += '^'
    } else if (part === 'alt') {
      result += '%'
    } else if (part === 'shift') {
      result += '+'
    } else if (part.length === 1) {
      mainKey = part
    } else {
      const specialKeys: Record<string, string> = {
        'enter': '{ENTER}',
        'tab': '{TAB}',
        'escape': '{ESC}',
        'esc': '{ESC}',
        'backspace': '{BACKSPACE}',
        'delete': '{DELETE}',
        'space': ' ',
        'up': '{UP}',
        'down': '{DOWN}',
        'left': '{LEFT}',
        'right': '{RIGHT}',
        'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
        'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
        'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}'
      }
      if (specialKeys[part]) {
        mainKey = specialKeys[part]
      }
    }
  }

  result += mainKey
  return result
}

async function sendKeysWithVBScript(sendKeys: string): Promise<void> {
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.SendKeys "${sendKeys}"
WScript.Sleep 100
`

  const vbsPath = join(tmpdir(), `sendkeys_${Date.now()}.vbs`)

  try {
    writeFileSync(vbsPath, vbsContent)

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('wscript', [vbsPath], {
        windowsHide: true
      })

      proc.on('close', (code) => {
        try { unlinkSync(vbsPath) } catch {}
        if (code === 0) resolve()
        else reject(new Error(`VBScript exited with code ${code}`))
      })

      proc.on('error', (err) => {
        try { unlinkSync(vbsPath) } catch {}
        reject(err)
      })
    })
  } catch (error) {
    try { unlinkSync(vbsPath) } catch {}
    throw error
  }
}

// ========== IPC Handlers ==========

// NOTE: 窗口设置为 focusable: false，点击按钮不会从目标应用抢焦点，
//       VBScript SendKeys 直接发送到仍然保持前台的目标窗口，无需隐藏/显示窗口。

ipcMain.handle('input:text', async (_event, text: string, appendEnter: boolean = false) => {
  try {
    if (!text || typeof text !== 'string') {
      return { success: false, error: '无效的文本内容' }
    }

    const originalClipboard = clipboard.readText()
    clipboard.writeText(text)

    await new Promise(resolve => setTimeout(resolve, 100))

    await sendKeysWithVBScript('^v')

    if (appendEnter) {
      await new Promise(resolve => setTimeout(resolve, 100))
      await sendKeysWithVBScript('{ENTER}')
    }

    await new Promise(resolve => setTimeout(resolve, 200))

    if (originalClipboard !== null && originalClipboard !== undefined) {
      clipboard.writeText(originalClipboard)
    }

    return { success: true }
  } catch (error) {
    console.error('文本输入失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
})

ipcMain.handle('execute:shortcut', async (_event, shortcut: string) => {
  try {
    if (!shortcut || typeof shortcut !== 'string') {
      return { success: false, error: '无效的快捷键' }
    }

    const sendKeys = convertToSendKeys(shortcut)
    await sendKeysWithVBScript(sendKeys)

    return { success: true }
  } catch (error) {
    console.error('快捷键执行失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
})

// NOTE: 模态框打开时设为 focusable=true 以允许键盘输入，关闭时恢复 focusable=false
ipcMain.handle('window:setFocusable', (_event, focusable: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focusable = focusable
    if (focusable) {
      mainWindow.focus()
    }
  }
})

ipcMain.handle('config:get', () => {
  try {
    const buttons = store.get('buttons')
    if (!buttons || !Array.isArray(buttons) || buttons.length === 0) {
      store.set('buttons', DEFAULT_BUTTONS)
      return { buttons: DEFAULT_BUTTONS }
    }
    return { buttons }
  } catch (error) {
    console.error('获取配置失败:', error)
    return { buttons: DEFAULT_BUTTONS }
  }
})

ipcMain.handle('config:set', (_event, config: AppConfig) => {
  try {
    if (config.buttons) {
      store.set('buttons', config.buttons)
    }
    if (mainWindow && !mainWindow.isDestroyed() && config.buttons) {
      const newHeight = calculateWindowHeight(config.buttons.length)
      mainWindow.setSize(WINDOW_WIDTH, newHeight)
      mainWindow.setMinimumSize(WINDOW_WIDTH, newHeight)
      mainWindow.setMaximumSize(WINDOW_WIDTH, newHeight)
    }
    return { success: true }
  } catch (error) {
    console.error('保存配置失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '保存配置失败'
    }
  }
})

ipcMain.handle('window:resize', (_event, width: number, height: number) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSize(width, height)
      mainWindow.setMinimumSize(width, height)
      mainWindow.setMaximumSize(width, height)
    }
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '调整窗口大小失败'
    }
  }
})

ipcMain.handle('window:getPosition', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition()
    return { x, y }
  }
  return { x: 0, y: 0 }
})

ipcMain.handle('window:setPosition', (_event, x: number, y: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setPosition(Math.round(x), Math.round(y))
  }
})
