import { shallowRef } from 'vue'

type Failure = 'register' | 'install' | 'activate' | 'update' | 'verify' | 'incomplete'
type CacheStatus = { version: string; complete: boolean | null }
const isVersion = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{12}$/.test(value)
const failureKey = 'todou.offline.failedBuild'

function queryWorker(worker: ServiceWorker): Promise<CacheStatus> {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel()
    const finish = () => { clearTimeout(timer); port1.close() }
    const timer = setTimeout(() => { finish(); reject(new Error('Worker did not answer')) }, 5000)
    port1.onmessage = ({ data }) => {
      finish()
      if (isVersion(data?.version) && (data.complete === null || typeof data.complete === 'boolean')) resolve(data)
      else reject(new Error('Invalid cache status'))
    }
    try { worker.postMessage({ type: 'todou-offline-status' }, [port2]) }
    catch (error) { finish(); port2.close(); reject(error) }
  })
}

export function createOfflineReadiness(production: boolean, workers?: ServiceWorkerContainer, storage?: Storage) {
  const environment = !production ? 'development' : workers ? 'supported' : 'unsupported'
  const currentVersion = shallowRef<string | null>(null)
  const candidateVersion = shallowRef<string | null>(null)
  const failure = shallowRef<Failure | null>(null)
  const downloading = shallowRef(false)
  const retrying = shallowRef(false)
  let registration: ServiceWorkerRegistration | undefined
  let candidate: ServiceWorker | null = null
  let replacedFailure: string | null = null
  let sequence = 0
  let started = false
  function savedFailure() {
    try {
      const version = storage?.getItem(failureKey)
      return isVersion(version) ? version : null
    } catch { return null }
  }
  const previousFailure = environment === 'supported' ? savedFailure() : null
  if (previousFailure) { candidateVersion.value = previousFailure; failure.value = 'install' }

  function saveFailedBuild(version: string | null) {
    try {
      if (version) storage?.setItem(failureKey, version)
      else storage?.removeItem(failureKey)
    } catch { /* The current window can still show status. */ }
  }

  async function verify() {
    const check = ++sequence
    const controller = workers?.controller
    if (!controller) { currentVersion.value = null; return }
    try {
      const status = await queryWorker(controller)
      if (check !== sequence || controller !== workers?.controller) return
      currentVersion.value = status.complete ? status.version : null
      if (!status.complete) { failure.value = status.complete === false ? 'incomplete' : 'verify'; return }
      const candidateNowControls = candidate === controller || candidateVersion.value === status.version
      const checkingExistingCache = !downloading.value && (failure.value === null || failure.value === 'verify' || failure.value === 'incomplete')
      if (candidateNowControls || checkingExistingCache) {
        if (candidate === controller) candidate = null
        downloading.value = false
        // A second window can verify the old controller after the first records a failed update.
        let failed = savedFailure()
        if (failed && (failed === status.version || (candidateNowControls && failed === replacedFailure))) {
          saveFailedBuild(null)
          failed = null
        }
        if (candidateNowControls) replacedFailure = null
        candidateVersion.value = failed
        failure.value = candidateVersion.value ? 'install' : null
      }
    } catch {
      if (check === sequence && controller === workers?.controller) {
        currentVersion.value = null
        failure.value = 'verify'
      }
    }
  }

  function observeCandidate(worker: ServiceWorker) {
    if (candidate === worker) return
    candidate = worker
    let phase: Failure = 'install'
    function onState() {
      if (candidate !== worker) return
      if (worker.state === 'redundant') {
        downloading.value = false
        failure.value = phase
        if (candidateVersion.value) saveFailedBuild(candidateVersion.value)
      } else if (worker.state === 'activated') {
        void verify()
      } else {
        if (worker.state === 'installed' || worker.state === 'activating') phase = 'activate'
        downloading.value = true
        failure.value = null
      }
      if (worker.state === 'redundant' || worker.state === 'activated') worker.removeEventListener('statechange', onState)
    }
    worker.addEventListener('statechange', onState)
    onState()
  }

  function observeRegistration(next: ServiceWorkerRegistration) {
    function found() {
      const installing = next.installing ?? next.waiting
      if (installing) observeCandidate(installing)
    }
    if (registration !== next) {
      registration = next
      next.addEventListener('updatefound', found)
    }
    found()
  }

  async function start() {
    if (environment !== 'supported' || !workers || started) return
    started = true
    workers.addEventListener('controllerchange', () => { currentVersion.value = null; void verify() })
    workers.addEventListener('message', ({ source, data }) => {
      if (data?.type !== 'todou-offline-install' || !isVersion(data.version) || !source || !('scriptURL' in source)) return
      if (new URL(source.scriptURL).pathname !== '/sw.js') return
      if (data.phase !== 'installing' && data.phase !== 'failed') return
      if (data.phase === 'installing') replacedFailure = savedFailure()
      candidateVersion.value = data.version
      downloading.value = data.phase === 'installing'
      failure.value = downloading.value ? null : 'install'
      if (!downloading.value) saveFailedBuild(data.version)
    })
    // An already-controlled page can verify its cache even when registration fails offline.
    const checking = verify()
    try {
      const existing = await workers.getRegistration()
      if (existing) observeRegistration(existing)
      observeRegistration(await workers.register('/sw.js'))
    } catch {
      failure.value ??= workers.controller ? 'update' : 'register'
    }
    await checking
  }

  async function retry() {
    if (!workers || retrying.value || downloading.value) return
    retrying.value = true
    const repair = failure.value === 'incomplete'
    if (!candidateVersion.value) failure.value = null
    try {
      if (repair) {
        // Changing the script URL triggers a fresh atomic install even for the same build.
        const alternate = registration?.active?.scriptURL.endsWith('?repair') ? '/sw.js' : '/sw.js?repair'
        observeRegistration(await workers.register(alternate))
      } else if (registration?.active) {
        await registration.update()
      } else {
        observeRegistration(await workers.register('/sw.js'))
      }
      await verify()
    } catch { failure.value = registration?.active ? 'update' : 'register' }
    finally { retrying.value = false }
  }

  return { environment, currentVersion, candidateVersion, downloading, retrying, failure, start, retry, verify }
}

function browserStorage() {
  try { return window.localStorage } catch { return undefined }
}

export const offlineReadiness = createOfflineReadiness(
  import.meta.env?.PROD ?? false,
  typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) ? navigator.serviceWorker : undefined,
  browserStorage(),
)
