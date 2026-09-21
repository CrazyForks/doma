<script setup lang="ts">
import { ref, watch, onMounted, onErrorCaptured } from 'vue'
import Popup from './view/Popup.vue'
import SidePannel from './view/SidePannel.vue'
import { isSafariBuild } from '@/utils/safariBuild'

/** Safari iframe 里 hash 可能丢失/拼写不一；同时支持 query ?view=sidepannel */
function resolvePanelPath(): string {
  const q = new URLSearchParams(location.search)
  const view = (q.get('view') || q.get('panel') || '').toLowerCase()
  if (view === 'sidepannel' || view === 'sidepanel' || view === '1') {
    return '#sidepannel'
  }
  const hash = (location.hash || '').toLowerCase()
  if (hash === '#sidepannel' || hash === '#sidepanel') {
    return '#sidepannel'
  }
  return location.hash || '#popup'
}

const currentPath = ref(resolvePanelPath())
const routeError = ref('')

console.log('[DomA/App] path=', currentPath.value, 'href=', location.href, 'safari=', isSafariBuild())

watch(() => location.hash, () => {
  currentPath.value = resolvePanelPath()
  console.log('[DomA/App] hash →', currentPath.value)
})

onErrorCaptured((err, _inst, info) => {
  routeError.value = `${String(err)} (${info})`
  console.error('[DomA/App] captured', err, info)
  const paint = (window as any).__domaSafariBoot
  if (typeof paint === 'function') paint(`App captured: ${routeError.value}`, '#900')
  return false
})

onMounted(() => {
  console.log('[DomA/App] onMounted path=', currentPath.value)
  const paint = (window as any).__domaSafariBoot
  if (typeof paint === 'function') {
    paint(`App mounted · route=${currentPath.value}`, '#0a0')
  }
  if (currentPath.value === '#sidepannel') {
    document.documentElement.style.height = '100%'
    document.body.style.height = '100%'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }
})
</script>

<template>
  <div
    v-if="isSafariBuild()"
    style="position:sticky;top:28px;z-index:9;padding:6px 10px;font:12px monospace;background:#e8f5e9;color:#1b5e20;border-bottom:1px solid #a5d6a7"
  >
    route={{ currentPath }} · safari panel
    <span v-if="routeError" style="color:#b71c1c"> · ERR {{ routeError }}</span>
  </div>
  <SidePannel v-if="currentPath==='#sidepannel'" />
  <Popup v-else />
</template>

<style lang="less">
html, body, #app {
  height: 100%;
  margin: 0;
}
</style>
