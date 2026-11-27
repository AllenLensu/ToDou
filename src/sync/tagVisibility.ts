export const tagVisibilityPrefix = 'tag_visibility:'
export const tagVisibilityKey = (id: string) => tagVisibilityPrefix + id
export const isTagVisibility = (key: string) => key.startsWith(tagVisibilityPrefix) && key.length > tagVisibilityPrefix.length
