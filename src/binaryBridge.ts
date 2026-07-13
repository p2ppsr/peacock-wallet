import { WalletInterface, WalletWireProcessor } from '@bsv/sdk'
import { invoke, Channel } from '@tauri-apps/api/core'

/**
 * Binary ("cicada") substrate bridge.
 *
 * Receives raw binary wallet calls from the Rust HTTP server on :3301 through
 * a Tauri Channel and dispatches them through the same wallet instance used by
 * the JSON substrate, so permission prompts and origin tracking stay aligned.
 *
 * IPC frame layout from Rust:
 *   [0..8]   u64 request_id (little-endian)
 *   [8]      u8  callCode
 *   [9]      u8  originLen
 *   [10..]   origin utf8 + params (WalletWireProcessor wire format)
 */

type QueueTask = () => Promise<void>

class BinaryQueue {
  private active = 0
  private readonly queue: QueueTask[] = []

  constructor(
    private readonly concurrency: number,
    private readonly maxQueueSize: number
  ) {}

  enqueue(task: QueueTask): boolean {
    if (this.active >= this.concurrency) {
      if (this.maxQueueSize >= 0 && this.queue.length >= this.maxQueueSize) {
        return false
      }
      this.queue.push(task)
      return true
    }
    this.run(task)
    return true
  }

  private run(task: QueueTask): void {
    this.active += 1
    task()
      .catch((err) => console.error('[binaryBridge] task failed:', err))
      .finally(() => {
        this.active -= 1
        const next = this.queue.shift()
        if (next) this.run(next)
      })
  }

  get size(): number {
    return this.active + this.queue.length
  }
}

const readU64LE = (buf: Uint8Array, offset: number): bigint => {
  const dv = new DataView(buf.buffer, buf.byteOffset + offset, 8)
  return dv.getBigUint64(0, true)
}

const buildErrorFrame = (message: string): Uint8Array => {
  const msgBytes = new TextEncoder().encode(message)
  const stackBytes = new Uint8Array(0)
  const frame = new Uint8Array(1 + 1 + msgBytes.length + 1 + stackBytes.length)
  frame[0] = 1
  frame[1] = msgBytes.length
  frame.set(msgBytes, 2)
  frame[2 + msgBytes.length] = stackBytes.length
  return frame
}

let currentToken = 0
let currentStop: (() => void) | undefined

const detach = () => {
  if (!currentStop) return
  try {
    currentStop()
  } catch (err) {
    console.error('[binaryBridge] detach error:', err)
  } finally {
    currentStop = undefined
  }
}

export const startBinaryBridge = async (
  wallet: WalletInterface
): Promise<() => void> => {
  detach()
  const token = ++currentToken
  const generation = crypto.randomUUID()
  const processor = new WalletWireProcessor(wallet)
  const queue = new BinaryQueue(8, 256)
  let stopped = false

  const channel = new Channel<ArrayBuffer>()

  channel.onmessage = (raw) => {
    if (stopped || token !== currentToken) return

    const frame =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : ArrayBuffer.isView(raw)
          ? new Uint8Array(
              (raw as ArrayBufferView).buffer,
              (raw as ArrayBufferView).byteOffset,
              (raw as ArrayBufferView).byteLength
            )
          : undefined

    if (!frame || frame.byteLength < 10) {
      console.warn('[binaryBridge] malformed frame')
      return
    }

    const requestIdBig = readU64LE(frame, 0)
    const requestId = requestIdBig.toString()
    const wireFrame = frame.subarray(8)

    const accepted = queue.enqueue(async () => {
      if (stopped || token !== currentToken) {
        await respond(requestId, 409, buildErrorFrame('Wallet session changed'))
        return
      }

      let responseBytes: Uint8Array
      try {
        const result = await processor.transmitToWallet(Array.from(wireFrame))
        responseBytes = Uint8Array.from(result)
      } catch (err) {
        console.error('[binaryBridge] processor threw:', err)
        responseBytes = buildErrorFrame(
          err instanceof Error ? err.message : String(err)
        )
      }

      await respond(requestId, 200, responseBytes)
    })

    if (!accepted) {
      void respond(requestId, 429, buildErrorFrame('Wallet is busy'))
    } else if (queue.size > 128) {
      console.warn(`[binaryBridge] queue depth high: ${queue.size}`)
    }
  }

  await invoke('register_binary_handler', { generation, channel })

  const stop = () => {
    if (stopped) return
    stopped = true
    if (token === currentToken) currentToken++
    void invoke('clear_binary_handler', { generation }).catch((err) => {
      console.error('[binaryBridge] clear_binary_handler failed:', err)
    })
  }
  currentStop = stop
  return stop
}

const respond = async (
  requestId: string,
  status: number,
  body: Uint8Array
): Promise<void> => {
  try {
    await invoke('respond_binary', body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ) as ArrayBuffer, {
      headers: {
        'x-request-id': requestId,
        'x-status': String(status)
      }
    })
  } catch (err) {
    console.error('[binaryBridge] respond_binary failed:', err)
  }
}
