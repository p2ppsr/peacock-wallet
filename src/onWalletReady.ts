import {
  WalletInterface,
  CreateActionArgs,
  SignActionArgs,
  AbortActionArgs,
  ListActionsArgs,
  InternalizeActionArgs,
  ListOutputsArgs,
  RelinquishOutputArgs,
  GetPublicKeyArgs,
  RevealCounterpartyKeyLinkageArgs,
  RevealSpecificKeyLinkageArgs,
  WalletEncryptArgs,
  WalletDecryptArgs,
  CreateHmacArgs,
  VerifyHmacArgs,
  CreateSignatureArgs,
  VerifySignatureArgs,
  AcquireCertificateArgs,
  ListCertificatesArgs,
  ProveCertificateArgs,
  RelinquishCertificateArgs,
  DiscoverByIdentityKeyArgs,
  DiscoverByAttributesArgs,
  GetHeaderArgs,
  WalletError
} from '@bsv/sdk';
import { listen, emit } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { startBinaryBridge } from './binaryBridge'
import {
  INVALID_ORIGIN,
  INVALID_REQUEST,
  normalizeBridgePath,
  ORIGIN_REQUIRED,
  UNKNOWN_WALLET_PATH
} from './walletBridgePreLogin'

class HttpRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = INVALID_REQUEST) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
    this.code = code;
  }
}

type NormalizedHeaders = Record<string, string>;
type HttpWalletResponse = { request_id: number; status: number; body?: unknown };

let activeListenerToken = 0;
let activeUnlisten: (() => void) | undefined;

const detachActiveListener = () => {
  if (!activeUnlisten) {
    return;
  }

  try {
    activeUnlisten();
  } catch (error) {
    console.error('Failed to detach previous wallet listener:', error);
  } finally {
    activeUnlisten = undefined;
  }
};

const normalizeHeaders = (headers: unknown): NormalizedHeaders => {
  const normalized: NormalizedHeaders = {};

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const key = String(entry[0]).toLowerCase();
        const value = String(entry[1]);
        normalized[key] = value;
      }
    }
    return normalized;
  }

  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      normalized[key.toLowerCase()] = String(value);
    }
  }

  return normalized;
};

const extractRequestId = (payload: unknown): number | undefined => {
  if (typeof payload !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed.request_id === 'number') {
      return parsed.request_id;
    }
    if (parsed && typeof parsed.request_id === 'string') {
      const asNumber = Number(parsed.request_id);
      if (!Number.isNaN(asNumber)) {
        return asNumber;
      }
    }
  } catch {
    const numericMatch = payload.match(/"request_id"\s*:\s*(\d+)/);
    if (numericMatch) {
      return Number(numericMatch[1]);
    }
    const stringMatch = payload.match(/"request_id"\s*:\s*"(.*?)"/);
    if (stringMatch) {
      const asNumber = Number(stringMatch[1]);
      if (!Number.isNaN(asNumber)) {
        return asNumber;
      }
    }
  }

  return undefined;
};

const toBodyString = (payload: unknown): string => {
  if (payload === undefined) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch (error) {
    console.error('Failed to serialize response payload:', error);
    return '';
  }
};

const yieldToMainThread = (): Promise<void> => {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  const idleCallback = (window as unknown as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idleCallback === 'function') {
    return new Promise((resolve) => {
      idleCallback(() => resolve(), { timeout: 16 });
    });
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

type QueueTask = () => Promise<void>;

class AsyncRequestQueue {
  private active = 0;
  private readonly queue: QueueTask[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueueSize: number
  ) { }

  enqueue(task: QueueTask): boolean {
    if (this.active >= this.concurrency) {
      if (this.maxQueueSize >= 0 && this.queue.length >= this.maxQueueSize) {
        return false;
      }
      this.queue.push(task);
      return true;
    }

    this.runTask(task);
    return true;
  }

  private runTask(task: QueueTask): void {
    this.active += 1;
    task()
      .catch((error) => {
        console.error('[AsyncRequestQueue] task failed:', error);
      })
      .finally(() => {
        this.active -= 1;
        this.pump();
      });
  }

  private pump(): void {
    if (this.active >= this.concurrency) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.runTask(next);
  }

  get size(): number {
    return this.queue.length + this.active;
  }
}

const safeEmitResponse = async (requestId: number, status: number, payload: unknown): Promise<void> => {
  try {
    await emit('ts-response', {
      request_id: requestId,
      status,
      body: toBodyString(payload)
    });
  } catch (error) {
    console.error('Failed to emit ts-response:', error);
  }
};

async function setBridgeAcceptsRequests(accepts: boolean): Promise<void> {
  try {
    await invoke('set_wallet_bridge_accepts_requests', { accepts });
  } catch (error) {
    console.debug('Failed to update wallet bridge readiness:', error);
  }
}

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443'
};

const canonicalizeHost = (url: URL): string => {
  const hostname = url.hostname?.trim();
  if (!hostname) {
    throw new HttpRequestError(400, 'Invalid origin host', INVALID_ORIGIN);
  }

  const normalizedHost = hostname.toLowerCase();
  const needsBrackets = normalizedHost.includes(':');
  const baseHost = needsBrackets ? `[${normalizedHost}]` : normalizedHost;
  const port = url.port?.trim();
  const defaultPort = DEFAULT_PORTS[url.protocol];

  if (port && (!defaultPort || port !== defaultPort)) {
    return `${baseHost}:${port}`;
  }

  return baseHost;
};

const normalizeOriginValue = (raw: string, errorMessage: string): string => {
  try {
    return canonicalizeHost(new URL(raw));
  } catch (error) {
    throw new HttpRequestError(400, errorMessage, INVALID_ORIGIN);
  }
};

// Parse the origin header and turn it into a canonical fqdn (e.g. projectbabbage.com:8080)
// Handles both origin and legacy originator headers
function parseOrigin(headers: NormalizedHeaders): string {
  const rawOrigin = headers['origin'];
  if (rawOrigin) {
    return normalizeOriginValue(rawOrigin, 'Invalid Origin header');
  }

  const rawOriginator = headers['originator'];
  if (rawOriginator) {
    const candidate = rawOriginator.includes('://')
      ? rawOriginator
      : `http://${rawOriginator}`;
    return normalizeOriginValue(candidate, 'Invalid Originator header');
  }

  throw new HttpRequestError(400, 'Origin header is required', ORIGIN_REQUIRED);
}


export const onWalletReady = async (rawWallet: WalletInterface): Promise<(() => void) | undefined> => {
  detachActiveListener();
  const listenerToken = ++activeListenerToken;
  const requestQueue = new AsyncRequestQueue(8, 256);
  const wallet = rawWallet;

  const handleWalletRequest = async (payloadText: string, requestIdHint?: number): Promise<void> => {
    let responded = false;
    let requestId: number | undefined = requestIdHint;
    let response: HttpWalletResponse | undefined;

    try {
      if (!payloadText) {
        throw new HttpRequestError(400, 'Invalid request payload', INVALID_REQUEST);
      }

      await yieldToMainThread();

      const req = JSON.parse(payloadText);
      const parsedRequestId =
        typeof req.request_id === 'number'
          ? req.request_id
          : Number(req.request_id);

      if (!Number.isFinite(parsedRequestId)) {
        throw new HttpRequestError(400, 'Invalid request_id', INVALID_REQUEST);
      }

      requestId = parsedRequestId;
      req.request_id = parsedRequestId;

      const headers = normalizeHeaders(req.headers);
      req.headers = headers;
      const origin = parseOrigin(headers);

      function walletErrorBody(error: unknown): Record<string, unknown> {
        const json = WalletError.unknownToJson(error);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(json);
        } catch {
          body = {
            message: error instanceof Error ? error.message : String(error)
          };
        }

        const message = typeof body.message === 'string'
          ? body.message
          : error instanceof Error
            ? error.message
            : String(error);

        if (message.includes('seekPermission=false')) {
          return {
            ...body,
            code: body.code ?? 'WALLET_PERMISSION_REQUIRED',
            message,
            retryable: true
          };
        }

        return body;
      }

      function responseFromError(error: unknown, method: string): { request_id: number; status: number; body: unknown } {
        console.error(`${method} error:`, error)
        return {
          request_id: req.request_id,
          status: 400,
          body: walletErrorBody(error)
        };
      }

      const path = normalizeBridgePath(req.path);

      switch (path) {
        // 1. createAction
        case '/createAction': {
          try {
            const args = JSON.parse(req.body) as CreateActionArgs;

            const result = await wallet.createAction(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'createAction');
          }
          break
        }

        // 2. signAction
        case '/signAction': {
          try {
            const args = JSON.parse(req.body) as SignActionArgs

            const result = await wallet.signAction(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'signAction');
          }
          break
        }

        // 3. abortAction
        case '/abortAction': {
          try {
            const args = JSON.parse(req.body) as AbortActionArgs

            const result = await wallet.abortAction(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'abortAction');
          }
          break
        }

        // 4. listActions
        case '/listActions': {
          try {
            const args = JSON.parse(req.body) as ListActionsArgs

            const result = await wallet.listActions(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'listActions');
          }
          break
        }

        // 5. internalizeAction
        case '/internalizeAction': {
          try {
            const args = JSON.parse(req.body) as InternalizeActionArgs

            const result = await wallet.internalizeAction(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'internalizeAction');
          }
          break
        }

        // 6. listOutputs
        case '/listOutputs': {
          try {
            const args = JSON.parse(req.body) as ListOutputsArgs

            const result = await wallet.listOutputs(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'listOutputs');
          }
          break
        }

        // 7. relinquishOutput
        case '/relinquishOutput': {
          try {
            const args = JSON.parse(req.body) as RelinquishOutputArgs

            const result = await wallet.relinquishOutput(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'relinquishOutput');
          }
          break
        }

        // 8. getPublicKey
        case '/getPublicKey': {
          try {
            const args = JSON.parse(req.body) as GetPublicKeyArgs

            const result = await wallet.getPublicKey(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('getPublicKey error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 9. revealCounterpartyKeyLinkage
        case '/revealCounterpartyKeyLinkage': {
          try {
            const args = JSON.parse(req.body) as RevealCounterpartyKeyLinkageArgs

            const result = await wallet.revealCounterpartyKeyLinkage(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('revealCounterpartyKeyLinkage error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 10. revealSpecificKeyLinkage
        case '/revealSpecificKeyLinkage': {
          try {
            const args = JSON.parse(req.body) as RevealSpecificKeyLinkageArgs

            const result = await wallet.revealSpecificKeyLinkage(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('revealSpecificKeyLinkage error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 11. encrypt
        case '/encrypt': {
          try {
            const args = JSON.parse(req.body) as WalletEncryptArgs

            const result = await wallet.encrypt(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('encrypt error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 12. decrypt
        case '/decrypt': {
          try {
            const args = JSON.parse(req.body) as WalletDecryptArgs

            const result = await wallet.decrypt(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('decrypt error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 13. createHmac
        case '/createHmac': {
          try {
            const args = JSON.parse(req.body) as CreateHmacArgs

            const result = await wallet.createHmac(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('createHmac error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 14. verifyHmac
        case '/verifyHmac': {
          try {
            const args = JSON.parse(req.body) as VerifyHmacArgs

            const result = await wallet.verifyHmac(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('verifyHmac error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 15. createSignature
        case '/createSignature': {
          try {
            const args = JSON.parse(req.body) as CreateSignatureArgs

            const result = await wallet.createSignature(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('createSignature error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 16. verifySignature
        case '/verifySignature': {
          try {
            const args = JSON.parse(req.body) as VerifySignatureArgs

            const result = await wallet.verifySignature(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('verifySignature error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 17. acquireCertificate
        case '/acquireCertificate': {
          try {
            const args = JSON.parse(req.body) as AcquireCertificateArgs

            const result = await wallet.acquireCertificate(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'acquireCertificate');
          }
          break
        }

        // 18. listCertificates
        case '/listCertificates': {
          try {
            const args = JSON.parse(req.body) as ListCertificatesArgs

            const result = await wallet.listCertificates(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'listCertificates');
          }
          break
        }

        // 19. proveCertificate
        case '/proveCertificate': {
          try {
            const args = JSON.parse(req.body) as ProveCertificateArgs

            const result = await wallet.proveCertificate(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'proveCertificate');
          }
          break
        }

        // 20. relinquishCertificate
        case '/relinquishCertificate': {
          try {
            const args = JSON.parse(req.body) as RelinquishCertificateArgs

            const result = await wallet.relinquishCertificate(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'relinquishCertificate');
          }
          break
        }

        // 21. discoverByIdentityKey
        case '/discoverByIdentityKey': {
          try {
            const args = JSON.parse(req.body) as DiscoverByIdentityKeyArgs

            const result = await wallet.discoverByIdentityKey(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'discoverByIdentityKey');
          }
          break
        }

        // 22. discoverByAttributes
        case '/discoverByAttributes': {
          try {
            const args = JSON.parse(req.body) as DiscoverByAttributesArgs

            const result = await wallet.discoverByAttributes(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            response = responseFromError(error, 'discoverByAttributes');
          }
          break
        }

        // 23. isAuthenticated
        case '/isAuthenticated': {
          try {
            const result = await wallet.isAuthenticated({}, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('isAuthenticated error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 24. waitForAuthentication
        case '/waitForAuthentication': {
          try {
            const result = await wallet.waitForAuthentication({}, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('waitForAuthentication error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 25. getHeight
        case '/getHeight': {
          try {
            const result = await wallet.getHeight({}, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('getHeight error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 26. getHeaderForHeight
        case '/getHeaderForHeight': {
          try {
            const args = JSON.parse(req.body) as GetHeaderArgs

            const result = await wallet.getHeaderForHeight(args, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('getHeaderForHeight error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 27. getNetwork
        case '/getNetwork': {
          try {
            const result = await wallet.getNetwork({}, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('getNetwork error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        // 28. getVersion
        case '/getVersion': {
          try {
            const result = await wallet.getVersion({}, origin)
            response = {
              request_id: req.request_id,
              status: 200,
              body: JSON.stringify(result),
            }
          } catch (error) {
            console.error('getVersion error:', error)
            response = {
              request_id: req.request_id,
              status: 400,
              body: walletErrorBody(error),
            }
          }
          break
        }

        default: {
          response = {
            request_id: req.request_id,
            status: 404,
            body: JSON.stringify({
              code: UNKNOWN_WALLET_PATH,
              message: 'Unknown wallet path: ' + path,
              retryable: false
            }),
          }
          break
        }
      }

      if (!response) {
        throw new Error(`No response generated for wallet path: ${req.path}`);
      }

      await safeEmitResponse(response.request_id, response.status, response.body);
      responded = true;
    } catch (error) {
      if (error instanceof HttpRequestError) {
        console.warn('Wallet request rejected:', error.message);
        const id = requestId ?? extractRequestId(payloadText);
        if (typeof id === 'number') {
          await safeEmitResponse(id, error.status, {
            code: error.code,
            message: error.message,
            retryable: false
          });
          responded = true;
        } else {
          console.warn('Unable to respond to wallet request without request_id');
        }
        return;
      }

      console.error('Error handling http-request event:', error);

      if (!responded) {
        const id = requestId ?? extractRequestId(payloadText);
        if (typeof id === 'number') {
          await safeEmitResponse(id, 500, {
            message: error instanceof Error ? error.message : String(error)
          });
          responded = true;
        } else {
          console.error('Unable to respond to wallet request: missing request_id in payload');
        }
      }
    }
  };

  let stopBinaryBridge: (() => void) | undefined
  try {
    stopBinaryBridge = await startBinaryBridge(rawWallet)
  } catch (error) {
    console.error('Failed to start binary substrate bridge:', error)
  }

  const unlisten = await listen('http-request', (event) => {
    const payloadText = typeof event.payload === 'string' ? event.payload : '';
    const requestIdHint = extractRequestId(payloadText);

    const accepted = requestQueue.enqueue(async () => {
      if (listenerToken !== activeListenerToken) {
        if (typeof requestIdHint === 'number') {
          await safeEmitResponse(requestIdHint, 409, {
            message: 'Wallet session changed. Please retry your request.'
          });
        } else {
          console.warn('Dropping wallet request because session changed before processing.');
        }
        return;
      }

      try {
        await handleWalletRequest(payloadText, requestIdHint);
      } catch (error) {
        console.error('Unhandled wallet request error:', error);
      }
    });

    if (!accepted) {
      if (typeof requestIdHint === 'number') {
        void safeEmitResponse(requestIdHint, 429, {
          message: 'Wallet is busy. Please retry shortly.'
        });
      } else {
        console.warn('Dropping wallet request because queue is full and request_id is missing.');
      }
    } else if (requestQueue.size > 128) {
      console.warn(`Wallet request queue length high: ${requestQueue.size}`);
    }
  });

  const wrappedUnlisten = () => {
    try {
      unlisten();
    } catch (error) {
      console.error('Failed to detach wallet http-request listener:', error);
    }
    if (stopBinaryBridge) {
      try {
        stopBinaryBridge();
      } catch (error) {
        console.error('Failed to stop binary substrate bridge:', error);
      }
      stopBinaryBridge = undefined;
    }
    if (activeListenerToken === listenerToken) {
      activeUnlisten = undefined;
    }
    void setBridgeAcceptsRequests(false);
  };

  activeUnlisten = wrappedUnlisten;
  await setBridgeAcceptsRequests(true);
  return wrappedUnlisten;
};
