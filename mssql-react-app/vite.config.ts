import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path';
// import fs from 'fs';
// import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: 'inline',
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      },
      input: {
        tableDesigner: resolve(__dirname, './src/pages/TableDesigner/tableDesigner.html'),
      }
    },
    outDir: '../out/mssql-react-app'
  }
})