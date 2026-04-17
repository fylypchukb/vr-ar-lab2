import { fileURLToPath } from 'url'
import { resolve } from 'path'
import basicSsl from '@vitejs/plugin-basic-ssl'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default {
  plugins: [
    basicSsl({
      name: 'test',
      domains: ['*.custom.com'],
      certDir: '/Users/.../.devServer/cert',
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        task1: resolve(__dirname, 'pages/task-1.html'),
        task2: resolve(__dirname, 'pages/task-2.html'),
        task3: resolve(__dirname, 'pages/task-3.html'),
        task4: resolve(__dirname, 'pages/task-4.html'),
        task5: resolve(__dirname, 'pages/task-5.html'),
        task6: resolve(__dirname, 'pages/task-6.html'),
      },
    },
  },
}
