/** 按文件名时间戳长度兼容毫秒、微秒及原生 SystemTime 纳秒，不依赖文件修改时间。 */
export function recoveryCopyTime(name: string): Date | null {
  const timestamp = [...name.matchAll(/-(\d{12,})(?=-|\.)/g)].at(-1)?.[1]
  if (!timestamp) return null
  const epoch = BigInt(timestamp)
  // 按位数约定推断单位（12–13 位毫秒、14–16 位微秒、更长为纳秒），先用整数除法截去亚毫秒部分。
  const milliseconds = timestamp.length > 16 ? epoch / 1_000_000n : timestamp.length > 13 ? epoch / 1_000n : epoch
  const date = new Date(Number(milliseconds))
  return Number.isFinite(date.getTime()) ? date : null
}
