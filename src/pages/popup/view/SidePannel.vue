<template>
  <div class="slider-pannel-wrapper chat-mode" data-doma-sidepannel="1">
    <div
      v-if="phase === 'loading'"
      class="sidepannel-status"
    >
      {{ loadHint || 'Loading…' }}
    </div>

    <div
      v-else-if="phase === 'error'"
      class="sidepannel-status sidepannel-status--error"
    >
      <div class="sidepannel-status-title">Failed</div>
      {{ loadError }}
      <button type="button" class="sidepannel-retry" @click="boot">
        Retry
      </button>
    </div>

    <component :is="ChatPanelComp" v-else-if="ChatPanelComp" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef, type Component } from 'vue'
import { isSafariBuild } from '@/utils/safariBuild'

const phase = ref<'loading' | 'full' | 'error'>('loading')
const loadError = ref('')
const loadHint = ref('')
const ChatPanelComp = shallowRef<Component | null>(null)

/** Safari：整页跳到独立 sidepanel（避免 popup 壳内动态 import TDZ） */
function navigateToSafariSidepanel() {
  const path = 'popup/sidepanel.html'
  loadHint.value = 'Opening chat…'
  try {
    const ext = typeof chrome !== 'undefined' ? chrome : (browser as typeof chrome)
    location.assign(ext.runtime.getURL(path))
  } catch (e) {
    loadError.value = String(e)
    phase.value = 'error'
  }
}

async function loadFullInPlace() {
  phase.value = 'loading'
  loadHint.value = 'Loading chat…'
  try {
    const mod = await import('@/components/chat/ChatPanel.vue')
    ChatPanelComp.value = mod.default
    phase.value = 'full'
  } catch (e) {
    loadError.value = String(e)
    phase.value = 'error'
  }
}

function boot() {
  loadError.value = ''
  if (isSafariBuild()) navigateToSafariSidepanel()
  else void loadFullInPlace()
}

onMounted(() => {
  boot()
})
</script>

<style scoped lang="less">
.slider-pannel-wrapper {
  width: 100%;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.sidepannel-status {
  flex: 1;
  padding: 20px 16px;
  font: 14px/1.45 -apple-system, sans-serif;
  color: #333;
}
.sidepannel-status--error {
  color: #b71c1c;
}
.sidepannel-status-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.sidepannel-retry {
  margin-top: 12px;
  border: 0;
  border-radius: 8px;
  padding: 10px 12px;
  font-weight: 600;
  background: #eee;
  color: #333;
  cursor: pointer;
}
</style>
