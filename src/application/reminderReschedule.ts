/** 同一时刻仅字符串表示不同，不应清掉已有的提醒周期和推迟状态。 */
export const sameReminderTime = (before: string | null, after: string | null) =>
  before === after || (before !== null && after !== null && Date.parse(before) === Date.parse(after))

/** 改提醒时间前先排空旧调度器的写入，避免旧周期在改期后重新覆盖状态。 */
export const runReminderTimeChange = async <T>(
  before: string | null,
  after: string | null,
  mutate: () => Promise<T>,
  lifecycle: { pause: () => Promise<unknown>; resume: () => Promise<void> },
  refreshRelatedReminders = false,
): Promise<T> => {
  if (!refreshRelatedReminders && sameReminderTime(before, after)) return mutate()
  await lifecycle.pause()
  try { return await mutate() }
  finally { await lifecycle.resume() }
}
