// 网页构建用生成的预缓存 worker 替换此占位文件；桌面构建在嵌入资源前删除它。
// 此处故意让安装失败：跳过生成时不能把占位 worker 当作真实离线实现。
self.addEventListener('install', (event) => {
  event.waitUntil(Promise.reject(new Error('服务工作线程尚未生成本次构建的预缓存清单')))
})
