<script setup>
// 边框流光 (Border Beam) — 借鉴 Inspira UI, 零依赖手写。
// 一条光点沿卡片边框跑一圈, 只用于"当前轮到的队伍"的 active 指示,
// 替代之前删掉的呼吸辉光 —— 转播 HUD 里 active 目标常有这种描边动线。
//
// 实现: 绝对定位铺满父级 (父级需 position:relative + overflow:hidden),
// 用一个 conic-gradient 方块持续旋转, 再用 padding + mask 掏空中心,
// 只在边框留下一段渐隐的光弧。尊重 prefers-reduced-motion。
const props = defineProps({
  // 光弧颜色 (默认用队伍色变量, 回退金色)
  color: { type: String, default: 'var(--team-color, var(--gold))' },
  // 转一圈的秒数
  duration: { type: Number, default: 6 },
  // 边框光条粗细 (px)
  size: { type: Number, default: 1.5 },
})
</script>

<template>
  <span
    class="border-beam"
    :style="{
      '--bb-color': color,
      '--bb-duration': `${duration}s`,
      '--bb-size': `${size}px`,
    }"
    aria-hidden="true"
  ></span>
</template>

<style scoped>
.border-beam {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: var(--bb-size);
  pointer-events: none;
  z-index: 1;
  /* 只保留边框区: 内容盒挖空, 仅描边可见 */
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
}
.border-beam::before {
  content: '';
  position: absolute;
  inset: -150%;
  /* 一段亮弧 + 大片透明, 旋转时像光点绕圈 */
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 300deg,
    color-mix(in srgb, var(--bb-color) 30%, transparent) 336deg,
    var(--bb-color) 356deg,
    color-mix(in srgb, var(--bb-color) 30%, transparent) 360deg
  );
  animation: bb-spin var(--bb-duration) linear infinite;
}
@keyframes bb-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  /* 不旋转: 保留一圈静态描边作为 active 指示 */
  .border-beam::before { animation: none; }
  .border-beam {
    background: var(--bb-color);
    opacity: 0.5;
  }
}
</style>
