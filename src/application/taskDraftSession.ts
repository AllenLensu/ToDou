export type DraftSaveState = 'pending' | 'saving' | 'saved' | 'failed'
type SessionOptions<T> = {
  read: () => T
  save: (snapshot: T) => Promise<void>
  onState: (state: DraftSaveState) => void
  onError: (error: unknown) => void
  canSave?: () => boolean
  delay?: number
}

/** 管理一次编辑会话：保存独立快照，异步保存结果不能回填并覆盖用户正在输入的草稿。 */
export class TaskDraftSession<T> {
  private baseline: string | null = null
  private existing = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private flight: Promise<boolean> | null = null
  private disposed = false
  private heldForReview = false
  private options: SessionOptions<T>

  constructor(options: SessionOptions<T>) { this.options = options }

  private serialize() { return JSON.stringify(this.options.read()) }

  get dirty() { return this.serialize() !== this.baseline }
  get awaitingReview() { return this.heldForReview && this.dirty }

  reset(existing: boolean) {
    this.cancelTimer()
    this.existing = existing
    this.heldForReview = false
    this.baseline = this.serialize()
    this.options.onState('saved')
  }

  /** 恢复后的数据库可能与草稿不同，暂停自动保存，等待用户检查后显式提交。 */
  holdForReview(existing: boolean) {
    this.cancelTimer()
    this.existing = existing
    // 原库的基线不能证明恢复库已包含当前草稿，即使用户把内容改回原值。
    const isDirty = this.dirty
    if (isDirty) this.baseline = null
    this.heldForReview = true
    this.options.onState(isDirty ? 'pending' : 'saved')
  }

  changed(serialized?: string) {
    this.cancelTimer()
    const isDirty = (serialized ?? this.serialize()) !== this.baseline
    if (!isDirty) {
      if (!this.flight) this.options.onState('saved')
      return
    }
    this.options.onState(this.flight ? 'saving' : 'pending')
    // 已有任务默认防抖 800ms；新任务不自动创建，首次保存须显式允许创建。
    if (this.existing && !this.disposed && !this.heldForReview && this.options.canSave?.() !== false) {
      this.timer = setTimeout(() => { void this.flush(false, false) }, this.options.delay ?? 800)
    }
  }

  /** 显式保存和导航前提交会继续保存期间的新输入；防抖保存只提交当次快照。 */
  async flush(explicitSave = false, drain = true): Promise<boolean> {
    this.cancelTimer()
    if (this.flight) {
      if (!await this.flight) return false
      if (drain && this.dirty) return this.flush(explicitSave, drain)
      return !this.dirty
    }
    const serialized = this.serialize()
    if (serialized === this.baseline) return true
    // 改期范围等必要选择尚未确认时，自动保存、显式保存和导航均保留草稿。
    if (this.options.canSave?.() === false) return false
    if (!explicitSave && (!this.existing || this.heldForReview)) return false
    const snapshot = JSON.parse(serialized) as T
    this.options.onState('saving')
    const run = async () => {
      try {
        await this.options.save(snapshot)
        this.baseline = serialized
        this.heldForReview = false
        this.existing = true
        this.options.onState(this.dirty ? 'pending' : 'saved')
        return true
      } catch (error) {
        this.options.onState('failed')
        this.options.onError(error)
        return false
      }
    }
    this.flight = run()
    const success = await this.flight
    this.flight = null
    if (!success) return false
    const latest = this.serialize()
    if (drain && latest !== this.baseline) return this.flush(explicitSave, drain)
    if (latest !== this.baseline) this.changed(latest)
    return true
  }

  dispose() { this.disposed = true; this.cancelTimer() }

  private cancelTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
