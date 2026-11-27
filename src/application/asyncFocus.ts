/** 等待异步操作及渲染完成后才聚焦；新请求或取消会使旧请求的聚焦失效。 */
export function createAsyncFocus(settle: () => Promise<unknown>) {
  let revision = 0
  return {
    cancel() { revision++ },
    async after(action: () => unknown | Promise<unknown>, allowed: () => boolean, focus: () => void) {
      const request = ++revision
      await action()
      if (request !== revision) return false
      await settle()
      if (request !== revision || !allowed()) return false
      focus()
      return true
    },
  }
}
