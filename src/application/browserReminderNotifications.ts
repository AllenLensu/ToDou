import { t } from '../i18n'
import type { ReminderEvent, ReminderItem } from './reminderService'

type ReminderIdentity = Pick<ReminderItem, 'kind' | 'id'>
export const reminderNotificationPrefix = 'todou-reminder-'
export const reminderTag = (item: ReminderIdentity) => reminderNotificationPrefix + item.kind + '-' + item.id
const windowNotifications = new Map<string, Notification>()

/** A fresh page can enumerate worker notifications. First installation and development may have no active worker yet. */
export async function getReminderRegistration() {
  const registration = await globalThis.navigator?.serviceWorker?.getRegistration()
  return registration?.active && typeof registration.getNotifications === 'function'
    && typeof registration.showNotification === 'function' ? registration : undefined
}

function closeWindowNotification(tag: string) {
  const notification = windowNotifications.get(tag)
  if (!notification) return
  windowNotifications.delete(tag)
  // Chromium ignores close() while loading. Retry when the banner actually appears.
  notification.onshow = () => {
    if (!windowNotifications.has(tag)) notification.close()
  }
  notification.close()
}

export const closeReminderNotification = (item: ReminderIdentity) => closeWindowNotification(reminderTag(item))

export function closeWindowReminderNotifications() {
  for (const tag of windowNotifications.keys()) closeWindowNotification(tag)
}

export async function withdrawReminderNotification(item: ReminderIdentity) {
  closeReminderNotification(item)
  const registration = await getReminderRegistration()
  if (!registration) return
  for (const notification of await registration.getNotifications({ tag: reminderTag(item) })) notification.close()
}

export async function showReminderNotification(event: ReminderEvent, registration?: ServiceWorkerRegistration) {
  const isAlarm = event.strength === 'alarm'
  const title = isAlarm ? t('ToDou · 闹钟提醒') : t('ToDou · 提醒')
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    throw new Error(t('系统通知未获授权或不可用，已保留页面提醒。'))
  }
  const tag = reminderTag(event.item)
  const options: NotificationOptions = {
    body: event.item.title, tag, requireInteraction: isAlarm, silent: !isAlarm,
    data: { remindAt: event.item.remindAt, notifiedAt: event.at },
  }
  if (registration) {
    await registration.showNotification(title, options)
    closeWindowNotification(tag)
    return
  }
  const notification = new Notification(title, options)
  windowNotifications.set(tag, notification)
  notification.onclose = notification.onerror = () => {
    if (windowNotifications.get(tag) === notification) windowNotifications.delete(tag)
  }
}
