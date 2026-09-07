import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./", // itch.io のようにサブフォルダ配信される環境でも正しくパス解決できるようにする
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "ビジネスゲーム　〜飲料販売〜",
        short_name: "飲料販売ゲーム",
        description: "小売店の発注・販売をテーマにした経営シミュレーションゲーム",
        theme_color: "#2F6B4F",
        background_color: "#EFE7D8",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // オフラインでも起動できるよう、ビルド成果物一式をキャッシュする
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
      },
    }),
  ],
});
