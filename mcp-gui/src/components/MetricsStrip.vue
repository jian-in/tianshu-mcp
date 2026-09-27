<script setup lang="ts">
/**
 * 指标仪：四格等分读数（标签 11px 弱色 / 数字 18px 等宽 tabular）。
 */
defineProps<{
  items: { label: string; value: number; tone?: string }[];
}>();
</script>

<template>
  <div class="metrics">
    <div v-for="item in items" :key="item.label" class="metric">
      <div class="metric-label">{{ item.label }}</div>
      <div class="metric-value" :class="item.tone ? `tone-${item.tone}` : ''">{{ item.value }}</div>
    </div>
  </div>
</template>