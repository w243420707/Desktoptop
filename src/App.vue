<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, nextTick } from 'vue'

interface QuickButton {
  id: string
  name: string
  type: 'text' | 'shortcut'
  content: string
  appendEnter?: boolean
}

const buttons = ref<QuickButton[]>([])
const isElectron = ref(false)
const showAddModal = ref(false)
const editingButton = ref<QuickButton | null>(null)
const newButton = ref<QuickButton>({ id: '', name: '', type: 'text', content: '', appendEnter: false })
const contextMenuVisible = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const selectedButtonId = ref<string | null>(null)
const isRecordingShortcut = ref(false)
const savedWindowHeight = ref(0)

const loadConfig = async () => {
  if (!isElectron.value) return
  try {
    const config = await (window as any).electronAPI.getConfig()
    if (config && config.buttons && config.buttons.length > 0) {
      buttons.value = config.buttons
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

const saveConfig = async () => {
  if (!isElectron.value) return
  try {
    // NOTE: 必须将 Vue Proxy 转为纯对象，否则 Electron IPC 序列化可能丢失数据
    const rawButtons = JSON.parse(JSON.stringify(buttons.value))
    await (window as any).electronAPI.setConfig({ buttons: rawButtons })
  } catch (error) {
    console.error('保存配置失败:', error)
  }
}

watch(buttons, () => saveConfig(), { deep: true })

onMounted(async () => {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    isElectron.value = true
    await loadConfig()
  }
  document.addEventListener('click', hideContextMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', hideContextMenu)
  document.removeEventListener('keydown', handleShortcutKeydown)
})

// NOTE: 拖拽判定阈值（像素），超过此距离视为拖拽而非点击
const DRAG_THRESHOLD = 5
const isDragging = ref(false)
const dragStartScreen = ref({ x: 0, y: 0 })
const windowStartPos = ref({ x: 0, y: 0 })

const handleMouseDown = async (e: MouseEvent, button: QuickButton) => {
  if (e.button !== 0) return
  if (contextMenuVisible.value) {
    hideContextMenu()
    return
  }
  if (!isElectron.value) return

  dragStartScreen.value = { x: e.screenX, y: e.screenY }
  const pos = await (window as any).electronAPI.getWindowPosition()
  windowStartPos.value = { x: pos.x, y: pos.y }
  isDragging.value = false

  const onMouseMove = (ev: MouseEvent) => {
    const dx = ev.screenX - dragStartScreen.value.x
    const dy = ev.screenY - dragStartScreen.value.y
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      isDragging.value = true
      ;(window as any).electronAPI.setWindowPosition(
        windowStartPos.value.x + dx,
        windowStartPos.value.y + dy
      )
    }
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    if (!isDragging.value) {
      handleButtonClick(button)
    }
    isDragging.value = false
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

const handleButtonClick = async (button: QuickButton) => {
  if (!isElectron.value) return

  if (button.type === 'text' && button.content) {
    await (window as any).electronAPI.inputText(button.content, button.appendEnter)
  } else if (button.type === 'shortcut' && button.content) {
    await (window as any).electronAPI.executeShortcut(button.content)
  }
}

const showContextMenu = (e: MouseEvent, buttonId: string) => {
  e.preventDefault()
  e.stopPropagation()
  selectedButtonId.value = buttonId
  contextMenuPosition.value = { x: e.clientX, y: e.clientY }
  contextMenuVisible.value = true
}

const hideContextMenu = () => {
  contextMenuVisible.value = false
  selectedButtonId.value = null
}

const deleteButton = () => {
  if (selectedButtonId.value) {
    buttons.value = buttons.value.filter(b => b.id !== selectedButtonId.value)
  }
  hideContextMenu()
}

const editButton = async () => {
  const btn = buttons.value.find(b => b.id === selectedButtonId.value)
  if (btn) {
    editingButton.value = btn
    newButton.value = { ...btn, appendEnter: btn.appendEnter || false }
    await openModal()
  }
  hideContextMenu()
}

const openAddModal = async () => {
  editingButton.value = null
  newButton.value = { id: '', name: '', type: 'text', content: '', appendEnter: false }
  await openModal()
}

const openModal = async () => {
  if (isElectron.value) {
    // NOTE: 模态框需要键盘输入，临时允许窗口获取焦点
    await (window as any).electronAPI.setFocusable(true)
    const config = await (window as any).electronAPI.getConfig()
    const buttonCount = config?.buttons?.length || 0
    savedWindowHeight.value = buttonCount
    await (window as any).electronAPI.resizeWindow(240, 320)
  }
  showAddModal.value = true
}

const closeModal = async () => {
  showAddModal.value = false
  editingButton.value = null
  stopRecordingShortcut()
  if (isElectron.value && savedWindowHeight.value > 0) {
    const config = await (window as any).electronAPI.getConfig()
    const buttonCount = config?.buttons?.length || 0
    const BUTTON_HEIGHT = 32
    const BUTTON_GAP = 4
    const HEADER_HEIGHT = 0
    const CONTAINER_PADDING = 12
    const height = HEADER_HEIGHT + CONTAINER_PADDING + buttonCount * BUTTON_HEIGHT + (buttonCount - 1) * BUTTON_GAP + CONTAINER_PADDING
    await (window as any).electronAPI.resizeWindow(100, Math.max(300, height))
    // NOTE: 模态框关闭后恢复不可聚焦状态，防止窗口抢焦点
    await (window as any).electronAPI.setFocusable(false)
  }
}

const saveButton = async () => {
  if (!newButton.value.name || !newButton.value.content) return
  
  if (editingButton.value) {
    const index = buttons.value.findIndex(b => b.id === editingButton.value!.id)
    if (index !== -1) {
      buttons.value.splice(index, 1, { ...newButton.value })
    }
  } else {
    buttons.value.push({ ...newButton.value, id: Date.now().toString() })
  }
  await saveConfig()
  closeModal()
}

const startRecordingShortcut = async () => {
  isRecordingShortcut.value = true
  newButton.value.content = ''
  await nextTick()
  document.addEventListener('keydown', handleShortcutKeydown)
}

const stopRecordingShortcut = () => {
  isRecordingShortcut.value = false
  document.removeEventListener('keydown', handleShortcutKeydown)
}

const handleShortcutKeydown = (e: KeyboardEvent) => {
  if (!isRecordingShortcut.value) return
  
  e.preventDefault()
  e.stopPropagation()
  
  const keys: string[] = []
  
  if (e.ctrlKey) keys.push('Ctrl')
  if (e.altKey) keys.push('Alt')
  if (e.shiftKey) keys.push('Shift')
  if (e.metaKey) keys.push('Win')
  
  const key = e.key.toUpperCase()
  const ignoredKeys = ['CONTROL', 'ALT', 'SHIFT', 'META']
  
  if (!ignoredKeys.includes(key) && key.length === 1) {
    keys.push(key)
  } else if (!ignoredKeys.includes(key)) {
    const specialKeys: Record<string, string> = {
      'ENTER': 'Enter',
      'TAB': 'Tab',
      'ESCAPE': 'Esc',
      'BACKSPACE': 'Backspace',
      'DELETE': 'Delete',
      'SPACE': 'Space',
      'ARROWUP': 'Up',
      'ARROWDOWN': 'Down',
      'ARROWLEFT': 'Left',
      'ARROWRIGHT': 'Right'
    }
    if (specialKeys[key]) {
      keys.push(specialKeys[key])
    } else if (key.startsWith('F') && key.length <= 3) {
      keys.push(key)
    }
  }
  
  if (keys.length > 1 || (keys.length === 1 && !['CTRL', 'ALT', 'SHIFT', 'WIN'].includes(keys[0]))) {
    newButton.value.content = keys.join('+')
  }
}
</script>

<template>
  <div class="container">
    <div class="button-list">
      <div 
        v-for="button in buttons" 
        :key="button.id" 
        class="quick-btn"
        @mousedown="handleMouseDown($event, button)"
        @contextmenu="showContextMenu($event, button.id)"
      >
        {{ button.name }}
      </div>
      <div class="quick-btn add-btn" @click="openAddModal">＋</div>
    </div>
    
    <Teleport to="body">
      <div v-if="contextMenuVisible" 
           class="context-menu" 
           :style="{ left: contextMenuPosition.x + 'px', top: contextMenuPosition.y + 'px' }"
           @click.stop>
        <div class="menu-item" @click="editButton">编辑</div>
        <div class="menu-item delete" @click="deleteButton">删除</div>
      </div>
      
      <div v-if="showAddModal" class="modal-overlay" @click.self="closeModal">
        <div class="modal" @click.stop>
          <div class="modal-title">{{ editingButton ? '编辑' : '添加' }}</div>
          <div class="form-group">
            <label>名称</label>
            <input v-model="newButton.name" type="text" placeholder="名称" />
          </div>
          <div class="form-group">
            <label>类型</label>
            <select v-model="newButton.type">
              <option value="text">文本</option>
              <option value="shortcut">快捷键</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ newButton.type === 'text' ? '内容' : '快捷键' }}</label>
            <input v-if="newButton.type === 'text'" 
                   v-model="newButton.content" 
                   type="text" 
                   placeholder="输入文本" />
            <div v-else 
                 class="shortcut-input"
                 :class="{ recording: isRecordingShortcut }"
                 @click="startRecordingShortcut">
              {{ newButton.content || (isRecordingShortcut ? '按下快捷键...' : '点击录制') }}
            </div>
          </div>
          <div v-if="newButton.type === 'text'" class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="newButton.appendEnter" />
              <span>输入后按回车</span>
            </label>
          </div>
          <div class="modal-actions">
            <button class="btn cancel" @click="closeModal">取消</button>
            <button class="btn save" @click="saveButton">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: transparent;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

#app {
  width: 100%;
  height: 100vh;
}

.container {
  padding: 6px;
  position: relative;
  height: 100vh;
}

.button-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-btn {
  padding: 8px 10px;
  min-height: 28px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.quick-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(1.02);
}

.quick-btn:active {
  transform: scale(0.98);
}

.add-btn {
  background: rgba(255, 255, 255, 0.1);
  border-style: dashed;
  font-size: 14px;
  font-weight: 300;
}

.add-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.context-menu {
  position: fixed;
  background: rgba(40, 40, 50, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 4px 0;
  min-width: 70px;
  z-index: 9999;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.menu-item {
  padding: 8px 14px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.menu-item.delete:hover {
  background: rgba(255, 80, 80, 0.3);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal {
  background: rgba(30, 30, 40, 0.98);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 12px;
  width: 200px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.modal-title {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  text-align: center;
}

.form-group {
  margin-bottom: 8px;
}

.form-group label {
  display: block;
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  margin-bottom: 3px;
}

.form-group input[type="text"],
.form-group select {
  width: 100%;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #fff;
  font-size: 11px;
  outline: none;
}

.form-group input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.form-group input:focus,
.form-group select:focus {
  border-color: rgba(255, 255, 255, 0.4);
}

.form-group select option {
  background: #2a2a35;
  color: #fff;
}

.checkbox-group {
  margin-bottom: 6px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.8);
  font-size: 10px;
}

.checkbox-label input[type="checkbox"] {
  width: 12px;
  height: 12px;
  cursor: pointer;
  accent-color: rgba(80, 150, 255, 0.8);
}

.shortcut-input {
  width: 100%;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.shortcut-input.recording {
  border-color: rgba(80, 150, 255, 0.8);
  background: rgba(80, 150, 255, 0.2);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.modal-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.btn {
  flex: 1;
  padding: 6px;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn.cancel {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.btn.cancel:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn.save {
  background: rgba(80, 150, 255, 0.8);
  color: #fff;
}

.btn.save:hover {
  background: rgba(80, 150, 255, 1);
}
</style>
