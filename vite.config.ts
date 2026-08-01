import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react({
      // Ensure that all .jsx, .tsx, .js, and .ts files are included.
      include: "**/*.{jsx,tsx,js,ts}",
    }),
  ],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          mui: ['@mui/material', '@mui/icons-material']
        }
      }
    },
    chunkSizeWarningLimit: 1200
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
    preserveSymlinks: true,
    alias: {
      // amountinator 0.2.13 still references the former deep module path.
      // Route it through Wallet Toolbox's supported browser entrypoint.
      '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager': '@bsv/wallet-toolbox-client'
    }
  },
}));
