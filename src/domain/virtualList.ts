// 只计算变高列表的前缀偏移、可见窗口和滚动锚点；DOM 测量由 composable 提供。
// offsets[i] 是第 i 行顶部相对列表起点的像素位置，末项为总高；scrollTop 也使用列表局部坐标。
export type VirtualLayout = {
  keys: readonly string[]
  indices: Map<string, number>
  offsets: Float64Array
  totalHeight: number
}

export function createVirtualLayout(keys: readonly string[], measured: ReadonlyMap<string, number>, estimatedHeight = 88): VirtualLayout {
  const offsets = new Float64Array(keys.length + 1)
  const indices = new Map<string, number>()
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    indices.set(key, index)
    const height = measured.get(key)
    offsets[index + 1] = offsets[index]! + (height !== undefined && Number.isFinite(height) && height > 0 ? height : estimatedHeight)
  }
  return { keys, indices, offsets, totalHeight: offsets[keys.length]! }
}

export function virtualIndexAt(layout: VirtualLayout, offset: number): number {
  if (!layout.keys.length) return 0
  let low = 0
  let high = layout.keys.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (layout.offsets[middle + 1]! <= offset) low = middle + 1
    else high = middle
  }
  return Math.min(low, layout.keys.length - 1)
}

export function virtualWindow(layout: VirtualLayout, scrollTop: number, viewportHeight: number, overscan = 440) {
  const firstPixel = Math.max(0, scrollTop - overscan)
  const lastPixel = Math.min(layout.totalHeight, scrollTop + Math.max(0, viewportHeight) + overscan)
  if (!layout.keys.length || lastPixel <= 0) return { start: 0, end: 0, before: 0, after: layout.totalHeight }
  if (firstPixel >= layout.totalHeight) return { start: layout.keys.length, end: layout.keys.length, before: layout.totalHeight, after: 0 }
  const start = virtualIndexAt(layout, firstPixel)
  // 结束像素落在行边界时不额外包含下一行；end 为 slice 使用的不含结束项索引。
  const last = virtualIndexAt(layout, Math.max(firstPixel, lastPixel - 0.001))
  const end = Math.min(layout.keys.length, last + 1)
  // 未渲染部分用上下占位高度补齐，保持完整列表的滚动范围。
  return { start, end, before: layout.offsets[start]!, after: layout.totalHeight - layout.offsets[end]! }
}

export function revealVirtualIndex(layout: VirtualLayout, index: number, scrollTop: number, viewportHeight: number): number {
  if (!layout.keys.length) return 0
  const bounded = Math.max(0, Math.min(layout.keys.length - 1, index))
  const top = layout.offsets[bounded]!
  const bottom = layout.offsets[bounded + 1]!
  if (bottom - top > viewportHeight) return top
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight)
  return scrollTop
}

/** 按键恢复首个可见记录及行内位置；键已移除时退回原索引（越界取末项），新行变矮时截住行内偏移。 */
export function restoreVirtualAnchor(previous: VirtualLayout, next: VirtualLayout, scrollTop: number): number {
  if (!previous.keys.length || !next.keys.length) return 0
  const previousIndex = virtualIndexAt(previous, Math.max(0, scrollTop))
  const key = previous.keys[previousIndex]!
  const nextIndex = next.indices.get(key) ?? Math.min(previousIndex, next.keys.length - 1)
  const within = Math.max(0, scrollTop - previous.offsets[previousIndex]!)
  const height = next.offsets[nextIndex + 1]! - next.offsets[nextIndex]!
  return next.offsets[nextIndex]! + Math.min(within, Math.max(0, height - 1))
}
