<template>
  <div
    class="jev-setup-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="t('chat.jevSetup.title')"
    @mousedown.self="onCancel"
  >
    <div class="jev-setup-dialog">
      <div class="jev-setup-header">
        <div class="jev-setup-title">{{ t("chat.jevSetup.title") }}</div>
        <button
          type="button"
          class="jev-setup-close"
          :aria-label="t('chat.jevSetup.close')"
          @click="onCancel"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4L4 12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      <p class="jev-setup-desc">{{ t("chat.jevSetup.desc") }}</p>

      <label class="jev-setup-label">{{ t("chat.jevSetup.apiKey") }}</label>
      <input
        v-model="apiKey"
        type="password"
        class="jev-setup-input"
        :placeholder="t('chat.jevSetup.apiKeyPlaceholder')"
        autocomplete="off"
        @blur="onApiKeyBlur"
      />

      <label class="jev-setup-label">{{ t("chat.jevSetup.model") }}</label>
      <div class="jev-setup-model-row">
        <select v-model="model" class="jev-setup-select" :disabled="loadingModels">
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
        <button
          type="button"
          class="jev-setup-refresh"
          :disabled="loadingModels || !apiKey.trim()"
          @click="refreshModels"
        >
          {{ loadingModels ? t("chat.jevSetup.loadingModels") : t("chat.jevSetup.refreshModels") }}
        </button>
      </div>
      <p v-if="errorText" class="jev-setup-error">{{ errorText }}</p>

      <div class="jev-setup-actions">
        <button type="button" class="jev-setup-btn jev-setup-btn--ghost" @click="onCancel">
          {{ t("chat.jevSetup.cancel") }}
        </button>
        <button
          type="button"
          class="jev-setup-btn jev-setup-btn--primary"
          :disabled="!canSave"
          @click="onSave"
        >
          {{ t("chat.jevSetup.save") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  JEV_DEFAULT_MODEL,
  JEV_FALLBACK_MODELS,
  isJevConfigured,
  isJevHostedApiKey,
  loadJevConfig,
  resolveJevBaseUrl,
  saveJevConfig,
} from "@/services/chat/jev/jevConfig";
import { listJevModels } from "@/services/chat/jev/jevClient";

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const { t } = useI18n();

const apiKey = ref("");
const model = ref(JEV_DEFAULT_MODEL);
const models = ref<string[]>([...JEV_FALLBACK_MODELS]);
const loadingModels = ref(false);
const errorText = ref("");
const saving = ref(false);

const canSave = computed(
  () => !!apiKey.value.trim() && !!model.value.trim() && !saving.value,
);

onMounted(async () => {
  const cfg = await loadJevConfig();
  apiKey.value = cfg.apiKey;
  model.value = cfg.model || JEV_DEFAULT_MODEL;
  if (isJevConfigured(cfg)) {
    await refreshModels();
  }
});

async function refreshModels() {
  errorText.value = "";
  loadingModels.value = true;
  try {
    const baseUrl = resolveJevBaseUrl(apiKey.value.trim());
    const ids = await listJevModels({
      apiKey: apiKey.value.trim(),
      baseUrl,
    });
    models.value = ids.length ? ids : [...JEV_FALLBACK_MODELS];
    if (!models.value.includes(model.value)) {
      model.value = models.value[0] || JEV_DEFAULT_MODEL;
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : String(e);
    models.value = [...JEV_FALLBACK_MODELS];
  } finally {
    loadingModels.value = false;
  }
}

function onApiKeyBlur() {
  if (apiKey.value.trim()) void refreshModels();
}

function onCancel() {
  emit("close");
}

async function onSave() {
  if (!canSave.value) return;
  saving.value = true;
  errorText.value = "";
  try {
    const key = apiKey.value.trim();
    const baseUrl = resolveJevBaseUrl(key);
    await saveJevConfig({
      apiKey: key,
      model: model.value.trim(),
      baseUrl,
      enabled: true,
    });
    console.log("[jev] setup:saved", {
      baseUrl,
      model: model.value.trim(),
      hostedKey: isJevHostedApiKey(key),
    });
    emit("saved");
    emit("close");
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="less">
.jev-setup-overlay {
  position: fixed;
  inset: 0;
  z-index: 10080;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.35);
  box-sizing: border-box;
}

.jev-setup-dialog {
  width: min(360px, 100%);
  max-height: min(90vh, 520px);
  overflow: auto;
  padding: 14px 16px 16px;
  border-radius: 12px;
  background: var(--stay-background, #f8f8f6);
  border: 1px solid var(--stay-border, #e4e4e0);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  box-sizing: border-box;
}

.jev-setup-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.jev-setup-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: var(--stay-black, #2f3134);
}

.jev-setup-close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--stay-secondaryFont, #888);
  cursor: pointer;

  &:hover {
    background: rgba(47, 49, 52, 0.08);
  }
}

.jev-setup-desc {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--stay-secondaryFont, #666);
}

.jev-setup-label {
  display: block;
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--stay-black, #2f3134);
}

.jev-setup-input,
.jev-setup-select {
  width: 100%;
  height: 34px;
  margin: 0 0 12px;
  padding: 0 10px;
  border: 1px solid var(--stay-border, #d8d8d4);
  border-radius: 8px;
  background: #fff;
  color: var(--stay-black, #2f3134);
  font-size: 13px;
  box-sizing: border-box;
}

.jev-setup-model-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;

  .jev-setup-select {
    flex: 1;
    margin-bottom: 0;
    min-width: 0;
  }
}

.jev-setup-refresh {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--stay-border, #d8d8d4);
  border-radius: 8px;
  background: rgba(47, 49, 52, 0.04);
  color: var(--stay-black, #2f3134);
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.jev-setup-error {
  margin: 0 0 8px;
  font-size: 12px;
  color: #c0392b;
}

.jev-setup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.jev-setup-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;

  &--ghost {
    background: transparent;
    color: var(--stay-secondaryFont, #666);

    &:hover {
      background: rgba(47, 49, 52, 0.06);
    }
  }

  &--primary {
    background: var(--stay-primary, #2f6fed);
    color: #fff;

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }
}
</style>
