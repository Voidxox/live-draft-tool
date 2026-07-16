import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // 开发时把 /ws 转发到 WebSocket 同步服务端 (server/index.js)
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
        changeOrigin: true,
      },
      // Steam 数据代理: /api/* 转发到同一个服务端的 HTTP 接口
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
