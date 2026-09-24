/** Let queued UI/cancellation work run without waiting for a visible animation frame. */
export function yieldWalletStorageTask (): Promise<void> {
  return new Promise(resolve => {
    if (typeof MessageChannel !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}
