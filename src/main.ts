import { t } from './i18n'
import { createApp } from 'vue'
import './style.css'
import { initializeLocale } from './i18n'
import App from './App.vue'
import { applyTheme, readCachedTheme } from './application/theme'
import { acquireWindowLease, type WindowLease } from './application/windowLease'
import { initializeDeviceConnection, useDeviceConnection } from './composables/useDeviceConnection'
import { createAuthorizationReturnLoading } from './sync/authorizationReturnLoading'
import { hasOneDriveRedirect } from './sync/providers'
import { listenForPwaLaunch } from './application/pwaLaunch'
import { offlineReadiness } from './application/offlineReadiness'

// 挂载前先应用缓存主题，避免等待数据库初始化时闪回默认配色。
initializeLocale()
applyTheme(readCachedTheme())

// 网页租约覆盖整个工作区生命周期，不能在挂载完成时释放。
let sessionLease: WindowLease | null = null
// 已安装 PWA 的授权回调可能落在另一窗口；处理登录只更新本机网盘连接。
// 因而先启动回调处理再争取数据库锁，未获锁的窗口也能完成授权。
const workspacePage = location.pathname === '/' || location.pathname === '/index.html'
if (workspacePage) listenForPwaLaunch(window, url => { void initializeDeviceConnection(true, url) })
const returnedFromLogin = workspacePage && hasOneDriveRedirect()
const deviceConnectionReady = workspacePage ? initializeDeviceConnection(returnedFromLogin) : Promise.resolve()

const startWorkspace = async () => {
  const root = document.querySelector<HTMLElement>('#app')!
  root.replaceChildren()
  try {
    if (returnedFromLogin) {
      // 回调页在兑换完成前先给出分段等待；结果仍由连接层原来的成功或错误文案接上。
      root.append(createAuthorizationReturnLoading(document))
    } else {
      const startup = document.createElement('p')
      startup.textContent = t('正在打开 ToDou…')
      startup.setAttribute('role', 'status')
      root.append(startup)
    }
    sessionLease = await acquireWindowLease()
    if (!sessionLease) {
      if (returnedFromLogin) {
        // 只有未取得锁的回调窗口等待连接验证，不阻塞主窗口编辑本地数据库。
        await deviceConnectionReady
        showStartupMessage(useDeviceConnection().message.value, t('请返回已经打开的 ToDou 窗口，在设置中查看网盘连接。'))
      } else {
        showStartupMessage(t('ToDou 正在另一窗口使用'), t('请先关闭另一窗口，再回到这里重试。这样可以保留最新内容，并避免重复提醒。'))
      }
      return
    }
    // 持锁窗口无需等待远端连接验证；挂载后由工作区初始化本地数据和提醒。
    createApp(App, { returnedFromLogin }).mount(root)
  } catch (error) {
    sessionLease?.release()
    sessionLease = null
    showStartupMessage(t('暂时无法打开 ToDou'), error instanceof Error ? error.message : t('请重试。'))
  }
}

const showStartupMessage = (title: string, detail: string) => {
  const root = document.querySelector<HTMLElement>('#app')!
  const panel = document.createElement('main')
  panel.className = 'app-shell tw:flex tw:flex-col tw:h-[100vh] tw:supports-[height:100dvh]:h-dvh tw:max-w-[1360px] tw:my-0 tw:mx-auto tw:pt-[calc(var(--space-2xl)+env(safe-area-inset-top))] tw:px-[56px] tw:pb-xl tw:le-1040:ge-821:px-lg tw:le-820:pt-[calc(var(--space-md)+env(safe-area-inset-top))] tw:le-820:px-[22px] tw:le-820:pb-[calc(80px+env(safe-area-inset-bottom))] tw:le-500:[&&]:px-sm'
  const heading = document.createElement('h1')
  heading.className = 'tw:text-text-display tw:text-display tw:font-normal tw:tracking-[-.04em] tw:leading-none'
  heading.textContent = title
  const message = document.createElement('p')
  message.textContent = detail
  message.setAttribute('role', 'status')
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'button tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0'
  retry.textContent = t('重试')
  retry.addEventListener('click', () => { void startWorkspace() })
  panel.append(heading, message, retry)
  root.replaceChildren(panel)
}

if (workspacePage) void startWorkspace()
else location.replace('/404.html')

if (workspacePage) {
  if (document.readyState === 'complete') void offlineReadiness.start()
  else window.addEventListener('load', () => { void offlineReadiness.start() }, { once: true })
}

