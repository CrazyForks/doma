// Pro overlay：Safari iframe 诊断 + bootstrap 失败也要 mount
import { createApp } from 'vue'
import '@/assets/css/common.less'
import '@/assets/css/variable.less'
import App from './App.vue'
import popupMsg from '@/config/locale/local.popup'
import sidepanelMsg from '@/config/locale/local.sidepanel'
import { i18n } from '@/config/locale/i18n'

const messages = {
  en: { ...popupMsg.en, ...sidepanelMsg.en },
  zh: { ...popupMsg.zh, ...sidepanelMsg.zh },
}
import { bootstrapEdition } from '@/edition/editionBootstrap'
import store from '@/store'
import toast from '@/components/layout/box/toast/index.ts'
import { isSafariBuild } from '@/utils/safariBuild'

const toastAction = (options: any) => {
  if (options && typeof options == 'string') {
    toast({ title: options })
  } else {
    toast(options)
  }
}

function boot(msg: string, bg?: string) {
  const paint = (window as any).__domaSafariBoot as undefined | ((m: string, b?: string) => void)
  if (typeof paint === 'function') paint(msg, bg)
  console.log('[DomA/popup]', msg)
}

boot(`main.ts running · safari=${isSafariBuild()} · ${location.href}`, '#135')
if (isSafariBuild()) {
  console.warn('[PANEL-RELOAD][iframe] popup/sidepanel main.ts boot', {
    href: String(location.href || '').slice(0, 160),
    t: Date.now(),
  })
}

const app = createApp(App)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[DomA/popup] vue error', err, info)
  boot(`Vue error: ${String(err)} | ${info}`, '#900')
}
app.provide('global', {
  store,
  toast: toastAction,
})

function mountApp() {
  try {
    boot('mounting #app…', '#135')
    app.use(i18n({ messages })).mount('#app')
    boot(`mounted OK · children=${document.getElementById('app')?.childElementCount ?? 0}`, '#0a0')
  } catch (e) {
    console.error('[DomA/popup] mount failed', e)
    boot(`mount failed: ${String(e)}`, '#900')
    const el = document.getElementById('app')
    if (el) {
      el.innerHTML = `<div style="padding:16px;font:14px/1.4 -apple-system,sans-serif;color:#c00">DomA mount failed: ${String(e)}</div>`
    }
  }
}

boot('bootstrapEdition start…', '#135')
void bootstrapEdition()
  .then(() => boot('bootstrapEdition done', '#135'))
  .catch((e) => {
    console.warn('[DomA/popup] bootstrapEdition error (continue mount)', e)
    boot(`bootstrap error (continue): ${String(e)}`, '#a60')
  })
  .finally(() => {
    mountApp()
  })
