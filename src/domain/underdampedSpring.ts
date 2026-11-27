/** 直接求解欠阻尼弹簧。时间以秒计，速度单位为 px/s。 */
export function createUnderdampedSpring(stiffness: number, damping: number, mass = 1) {
  const accelerationRate = stiffness / mass
  const decayRate = damping / (2 * mass)
  const frequency = Math.sqrt(accelerationRate - decayRate ** 2)

  return (position: number, velocity: number, target: number, seconds: number) => {
    if (seconds <= 0) return { position, velocity }
    const offset = position - target
    const decay = Math.exp(-decayRate * seconds)
    const cosine = Math.cos(frequency * seconds)
    const sineOverFrequency = Math.sin(frequency * seconds) / frequency
    return {
      position: target + decay * (offset * cosine + (velocity + decayRate * offset) * sineOverFrequency),
      velocity: decay * (velocity * cosine - (decayRate * velocity + accelerationRate * offset) * sineOverFrequency),
    }
  }
}
