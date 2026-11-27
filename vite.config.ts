import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { TLSSocket } from 'node:tls'
import { defineConfig, type Connect } from 'vite'

function setIsolationHeaders(server: { middlewares: Connect.Server }) {
  server.middlewares.use((req, res, next) => {
    const host = req.headers.host ?? ''
    const loopback = /^(?:localhost|[\w.-]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host)
    if (loopback || req.socket instanceof TLSSocket || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    }
    next()
  })
}

// 网页／PWA 使用默认根路径并输出到 dist/web。
export default defineConfig({
  plugins: [vue(), tailwindcss(), {
    name: 'todou-isolation-headers',
    configureServer: setIsolationHeaders,
    configurePreviewServer: setIsolationHeaders,
  }],
  build: {
    outDir: 'dist/web',
  },
  // 隔离头仅在可信来源生效。局域网 HTTP 使用 SQLite 的 Web Storage 后端。
  server: {
    // 开发服务只提供 Web 项目文件，根目录还保存本地交接资料和发布包。
    fs: { allow: ['index.html', 'package.json', 'public', 'src', 'scripts', 'tests', 'node_modules'] },
  },
  preview: {
    host: true,
    port: 5050,
    strictPort: true,
  },
  optimizeDeps: {
    // 保留 SQLite WASM 的模块与资源加载方式，不交给开发期依赖预打包；并非从生产包中移除。
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
})


