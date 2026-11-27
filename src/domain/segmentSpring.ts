import { createUnderdampedSpring } from './underdampedSpring'

export const stepSegmentSpring = createUnderdampedSpring(120, 18)

// 同一手势从按下采样到松手；转向后只使用新方向的位移。
export class PointerVelocity {
  private samples: { x: number; time: number }[] = []

  sample(x: number, time: number): number {
    const last = this.samples.at(-1)
    const first = this.samples[0]
    if (first && last && (last.x - first.x) * (x - last.x) < 0) this.samples = [last]
    if (last?.time === time) last.x = x
    else this.samples.push({ x, time })

    // 松手时可能没有新位移；把停留时间也计入最近 50ms 的速度。
    while (this.samples.length > 2 && this.samples[0]!.time < time - 50) this.samples.shift()
    const start = this.samples[0]!
    const elapsed = time - start.time
    return elapsed > 0 ? (x - start.x) * 1000 / elapsed : 0
  }
}
