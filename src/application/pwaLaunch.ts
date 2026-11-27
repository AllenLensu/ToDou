import { hasOneDriveRedirect } from '../sync/providers'

type LaunchQueue = { setConsumer: (consume: (launch: { targetURL?: string }) => void) => void }

/** Installed-PWA launches can arrive in an existing editor without navigating its document. */
export function listenForPwaLaunch(
  host: { location: Pick<Location, 'href' | 'origin' | 'hash'>; launchQueue?: LaunchQueue },
  consumeAuthorization: (url: string) => void,
) {
  const initialUrl = host.location.href
  let first = true
  host.launchQueue?.setConsumer(({ targetURL }) => {
    const startupAlreadyHandled = first && targetURL === initialUrl
    first = false
    if (!targetURL || startupAlreadyHandled) return
    let url: URL
    try { url = new URL(targetURL) } catch { return }
    if (url.origin !== host.location.origin || (url.pathname !== '/' && url.pathname !== '/index.html')) return
    if (hasOneDriveRedirect(url.href)) consumeAuthorization(url.href)
    else if (url.hash === '#today' || url.hash === '#new-task') host.location.hash = url.hash
    // A plain launch only focuses the existing window; there is no workspace action to dispatch.
  })
}
