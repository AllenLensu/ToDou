// This worker only probes the empty lease database. Task data lives in SQLite.
// A disposable worker lets a blocked tab cancel its request without queuing
// a deletion that would delay other tabs behind the current owner.
self.onmessage = ({ data: leaseName }: MessageEvent<string>) => {
  const request = indexedDB.deleteDatabase(leaseName)
  request.onblocked = () => self.postMessage('busy')
  request.onerror = () => self.postMessage('error')
  request.onsuccess = () => self.postMessage('available')
}
