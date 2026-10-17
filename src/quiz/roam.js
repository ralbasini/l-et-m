// Lets an avatar wander around a stage like the ones in the host lobby: walk
// left or right for a while, stand still, hop, or throw a backflip. Each avatar
// chooses its next move at random, so no two behave alike.
//   mood 'happy': lively, with plenty of hops and flips.
//   mood 'sad':   slow, mostly standing around, no flips.
const MOODS = {
  happy: { walk: 0.3, pause: 0.1, hop: 0.25, flip: 0.35, speed: [40, 95] },
  sad: { walk: 0.4, pause: 0.5, hop: 0.1, flip: 0, speed: [18, 40] },
}

export function roam (stage, el, mood = 'happy') {
  const cfg = MOODS[mood] || MOODS.happy
  let raf = 0
  let last = 0
  let x = null
  let dir = Math.random() < 0.5 ? -1 : 1
  let speed = 40
  let kind = 'pause'
  let until = 0
  let jump = null

  const next = (t) => {
    const r = Math.random()
    jump = null
    if (r < cfg.walk) {
      kind = 'walk'; dir = Math.random() < 0.5 ? -1 : 1
      speed = cfg.speed[0] + Math.random() * (cfg.speed[1] - cfg.speed[0])
      until = t + 700 + Math.random() * 2200
      if (Math.random() < 0.35 && mood !== 'sad') jump = { t0: t, dur: 420, h: 12 + Math.random() * 10 }
    } else if (r < cfg.walk + cfg.pause) {
      kind = 'pause'; until = t + 600 + Math.random() * 2000
    } else if (r < cfg.walk + cfg.pause + cfg.hop) {
      const hops = 1 + Math.floor(Math.random() * 3)
      kind = 'hop'; until = t + hops * 440
      jump = { t0: t, dur: 420, h: 14 + Math.random() * 12 }
    } else {
      kind = 'flip'; until = t + 950
      jump = { t0: t, dur: 900, h: 55, flip: true }
    }
  }

  const frame = (t) => {
    if (!el.isConnected) return
    raf = requestAnimationFrame(frame)
    const W = stage.clientWidth
    if (!W) { last = t; return } // screen not visible yet
    const max = Math.max(0, W - el.offsetWidth)
    if (x === null) { x = Math.random() * max; until = t + Math.random() * 800 }
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t
    if (t >= until) next(t)
    if (kind === 'walk') {
      x += dir * speed * dt
      if (x < 0) { x = 0; dir = 1 } else if (x > max) { x = max; dir = -1 }
    }
    let y = 0; let rot = 0
    if (jump) {
      const u = Math.min(1, (t - jump.t0) / jump.dur)
      y = -4 * jump.h * u * (1 - u)
      if (jump.flip) rot = -dir * 360 * (u < 0.15 ? 0 : u > 0.85 ? 1 : (u - 0.15) / 0.7)
      if (u >= 1) jump = kind === 'hop' && t + 420 < until ? { t0: t, dur: 420, h: 14 + Math.random() * 12 } : null
    }
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(1)}deg)`
  }
  raf = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(raf)
}

// For avatars that stay in place (podium, leaderboard rows): every so often the
// avatar hops once to three times or throws a backflip, each on its own random timer.
export function perform (el, { flip = 0.45, gap = [700, 2600], height = 1 } = {}) {
  let timer = 0
  let stopped = false
  const hop = (h) => ({ transform: `translateY(${-h * height}px)` })
  const go = () => {
    if (stopped || !el.isConnected) return
    let done
    if (Math.random() < flip) {
      done = el.animate([
        { transform: 'translateY(0) rotate(0) scale(1, 1)', offset: 0 },
        { transform: 'translateY(0) rotate(0) scale(1.1, 0.88)', offset: 0.12 },
        { transform: `translateY(${-60 * height}px) rotate(-180deg)`, offset: 0.5 },
        { transform: 'translateY(0) rotate(-360deg) scale(1.1, 0.9)', offset: 0.9 },
        { transform: 'translateY(0) rotate(-360deg) scale(1, 1)', offset: 1 },
      ], { duration: 950, easing: 'ease-in-out' }).finished
    } else {
      const n = 1 + Math.floor(Math.random() * 3)
      const frames = [{ transform: 'translateY(0)' }]
      for (let i = 0; i < n; i++) frames.push(hop(14 + Math.random() * 12), { transform: 'translateY(0) scale(1.08, 0.92)' })
      frames.push({ transform: 'translateY(0)' })
      done = el.animate(frames, { duration: n * 480, easing: 'ease-in-out' }).finished
    }
    done.then(() => { timer = setTimeout(go, gap[0] + Math.random() * (gap[1] - gap[0])) }, () => {})
  }
  timer = setTimeout(go, Math.random() * gap[1])
  return () => { stopped = true; clearTimeout(timer) }
}
