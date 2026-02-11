import React, { useState, useEffect, createContext, useMemo, useCallback, useContext, useRef } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import {
  Wallet,
  WalletPermissionsManager,
  PrivilegedKeyManager,
  WalletStorageManager,
  SimpleWalletManager,
  WalletSigner,
  Services,
  StorageClient,
  PermissionRequest,
  WalletLogger,
} from '@bsv/wallet-toolbox-client'
import {
  PrivateKey,
  Utils,
  WalletInterface,
  CachedKeyDeriver,
} from '@bsv/sdk'
import type { IdentityClient, RegistryClient } from '@bsv/sdk'
import { DEFAULT_SETTINGS, WalletSettings, WalletSettingsManager } from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'
import type { PermissionsManagerConfig } from '@bsv/wallet-toolbox-client'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { DEFAULT_STORAGE_URL, DEFAULT_CHAIN, ADMIN_ORIGINATOR } from './config'
import { deriveDefaultFiatCurrencyFromNavigator, getCurrencyDisplayName } from './utils/currency'
import { UserContext } from './UserContext'
import { CounterpartyPermissionRequest, GroupPermissionRequest, GroupedPermissions } from './types/GroupedPermissions'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'
import { WalletProfile } from './types/WalletProfile'
import { getIdentityClient, getRegistryClient } from './utils/clientFactories'
import { reconcileStoredKeyMaterial } from './utils/keyMaterial'

// -----
// Permission Configuration (User Wallet specific)
// -----

/**
 * Get permissions manager configuration - advanced mode only
 * This is vendor-specific configuration for the User Wallet desktop UX
 * 
 * @returns PermissionsManagerConfig object with advanced permissions (prompts for everything)
 */
function getPermissionConfigForMode(): Partial<PermissionsManagerConfig> {
  // Advanced mode: Prompt for everything (power user control)
  return {
    differentiatePrivilegedOperations: true,
    seekBasketInsertionPermissions: true,
    seekBasketListingPermissions: true,
    seekBasketRemovalPermissions: true,
    seekCertificateAcquisitionPermissions: true,
    seekCertificateDisclosurePermissions: true,
    seekCertificateRelinquishmentPermissions: true,
    seekCertificateListingPermissions: true,
    seekGroupedPermission: true,
    seekPermissionsForIdentityKeyRevelation: true,
    seekPermissionsForIdentityResolution: true,
    seekPermissionsForKeyLinkageRevelation: true,
    seekPermissionsForPublicKeyRevelation: true,
    seekPermissionWhenApplyingActionLabels: true,
    seekPermissionWhenListingActionsByLabel: true,
    seekProtocolPermissionsForEncrypting: true,
    seekProtocolPermissionsForHMAC: false, // HMACs are generally less "unsafe" to compute
    seekProtocolPermissionsForSigning: true,
    seekSpendingPermissions: true,
    whitelistedCounterparties: {
      '028155878063d691f01cfc0eeb626404ebe9303ec50f9542c234c5c85100a98ca1': ['auth message signature'],
      '028fa337dcdb5a2cc623d1ca673774fbc3cb4134820a94fdbb7073b79e6a1e8a37': ['auth message signature'],
      '0247632654abc935c66c68eb6797f7f1b300dfe3107cacad7c86b69176d938bbfb': ['auth message signature', '3241645161d8'],
      '03daf815fe38f83da0ad83b5bedc520aa488aef5cbc93a93c67a7fe60406cbffe8': ['auth message signature'],
      '02b4478e0df7197f4b245a269f6b5eb7689cf0213336752a2349d4137cc9d91c7b': ['auth message signature', '3241645161d8'],
      '03c191e1b2b421203f950eb8666fc8976c434cb9b81ebc3281cafbadff8aae4d02': ['auth message signature']
    }
  }
}

const createDisabledPrivilegedManager = () =>
  new PrivilegedKeyManager(async () => {
    throw new Error('Privileged operations are not supported with this wallet.');
  });

// -----
// Context Types
// -----


interface ManagerState {
  walletManager?: SimpleWalletManager;
  permissionsManager?: WalletPermissionsManager;
  settingsManager?: WalletSettingsManager;
}

export interface WalletContextValue {
  // Managers:
  managers: ManagerState;
  updateManagers: (newManagers: ManagerState) => void;
  // Settings
  settings: WalletSettings;
  updateSettings: (newSettings: WalletSettings) => Promise<void>;
  network: 'mainnet' | 'testnet';
  // Active Profile
  activeProfile: WalletProfile | null;
  setActiveProfile: (profile: WalletProfile | null) => void;
  // Logout
  logout: () => void;
  adminOriginator: string;
  setPasswordRetriever: (retriever: (reason: string, test: (passwordCandidate: string) => boolean) => Promise<string>) => void
  setRecoveryKeySaver: (saver: (key: number[]) => Promise<true>) => void
  snapshotLoaded: boolean
  basketRequests: BasketAccessRequest[]
  certificateRequests: CertificateAccessRequest[]
  protocolRequests: ProtocolAccessRequest[]
  spendingRequests: SpendingRequest[]
  groupPermissionRequests: GroupPermissionRequest[]
  counterpartyPermissionRequests: CounterpartyPermissionRequest[]
  advanceBasketQueue: () => void
  advanceCertificateQueue: () => void
  advanceProtocolQueue: () => void
  advanceSpendingQueue: () => void
  advanceGroupQueue: () => void
  advanceCounterpartyPermissionQueue: () => void
  recentApps: any[]
  clients: {
    registryFromWallet: RegistryClient | null
    registryFromPermissions: RegistryClient | null
    identityClient: IdentityClient | null
  }
}

export const WalletContext = createContext<WalletContextValue>({
  managers: {},
  updateManagers: () => { },
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => { },
  network: 'mainnet',
  activeProfile: null,
  setActiveProfile: () => { },
  logout: () => { },
  adminOriginator: ADMIN_ORIGINATOR,
  setPasswordRetriever: () => { },
  setRecoveryKeySaver: () => { },
  snapshotLoaded: false,
  basketRequests: [],
  certificateRequests: [],
  protocolRequests: [],
  spendingRequests: [],
  groupPermissionRequests: [],
  counterpartyPermissionRequests: [],
  advanceBasketQueue: () => { },
  advanceCertificateQueue: () => { },
  advanceProtocolQueue: () => { },
  advanceSpendingQueue: () => { },
  advanceGroupQueue: () => { },
  advanceCounterpartyPermissionQueue: () => { },
  recentApps: [],
  clients: {
    registryFromWallet: null,
    registryFromPermissions: null,
    identityClient: null
  }
})

// ---- Group-gating types ----
type GroupPhase = 'idle' | 'pending';

type GroupDecision = {
  allow: {
    // permissive model; we build this from the granted payload
    protocols?: Set<string> | 'all';
    baskets?: Set<string>;
    certificates?: Array<{ type: string; fields?: Set<string> }>;
    spendingUpTo?: number; // satoshis
  };
};

type PermissionType = 'identity' | 'protocol' | 'renewal' | 'basket';

type BasketAccessRequest = {
  requestID: string
  basket?: string
  originator: string
  reason?: string
  renewal?: boolean
}

type CertificateAccessRequest = {
  requestID: string
  certificate?: {
    certType?: string
    fields?: Record<string, any>
    verifier?: string
  }
  originator: string
  reason?: string
  renewal?: boolean
}

type ProtocolAccessRequest = {
  requestID: string
  protocolSecurityLevel: number
  protocolID: string
  counterparty?: string
  originator?: string
  description?: string
  renewal?: boolean
  type?: PermissionType
}

type SpendingRequest = {
  requestID: string
  originator: string
  description?: string
  transactionAmount: number
  totalPastSpending: number
  amountPreviouslyAuthorized: number
  authorizationAmount: number
  renewal?: boolean
  lineItems: any[]
}

interface WalletContextProps {
  children?: React.ReactNode;
  onWalletReady: (wallet: WalletInterface) => Promise<(() => void) | undefined>;
}

export const WalletContextProvider: React.FC<WalletContextProps> = ({
  children,
  onWalletReady
}) => {
  const [managers, setManagers] = useState<ManagerState>({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const adminOriginator = ADMIN_ORIGINATOR;
  const recentApps: any[] = []
  const [activeProfile, setActiveProfile] = useState<WalletProfile | null>(null)

  const [regionCurrencyPromptOpen, setRegionCurrencyPromptOpen] = useState(false)
  const [regionCurrencyPromptSuggested, setRegionCurrencyPromptSuggested] = useState<string>('USD')

  const { isFocused, onFocusRequested, onFocusRelinquished, setBasketAccessModalOpen, setCertificateAccessModalOpen, setProtocolAccessModalOpen, setSpendingAuthorizationModalOpen, setGroupPermissionModalOpen, setCounterpartyPermissionModalOpen } = useContext(UserContext);

  // Track if we were originally focused
  const [wasOriginallyFocused, setWasOriginallyFocused] = useState(false)

  // Separate request queues for basket and certificate access
  const [basketRequests, setBasketRequests] = useState<BasketAccessRequest[]>([])
  const [certificateRequests, setCertificateRequests] = useState<CertificateAccessRequest[]>([])
  const [protocolRequests, setProtocolRequests] = useState<ProtocolAccessRequest[]>([])
  const [spendingRequests, setSpendingRequests] = useState<SpendingRequest[]>([])
  const [groupPermissionRequests, setGroupPermissionRequests] = useState<GroupPermissionRequest[]>([])
  const [counterpartyPermissionRequests, setCounterpartyPermissionRequests] = useState<CounterpartyPermissionRequest[]>([])

  // ---- Group gate & deferred buffers ----
  const [groupPhase, setGroupPhase] = useState<GroupPhase>('idle');
  const groupPhaseRef = useRef<GroupPhase>('idle')
  const groupDecisionRef = useRef<GroupDecision | null>(null);
  const groupTimerRef = useRef<number | null>(null);
  const permissionsManagerRef = useRef<any>(null);
  const groupRequestCooldownKeyByIdRef = useRef<Map<string, string>>(new Map());
  const groupCooldownUntilRef = useRef<Record<string, number>>({});
  const GROUP_COOLDOWN_MS = 5 * 60 * 1000;

  const pactCooldownTimerByCacheKeyRef = useRef<Record<string, number>>({})
  const PACT_COOLDOWN_MS = 5 * 60 * 1000

  const getPactCacheKey = useCallback((originator: string, counterparty: string) => {
    const normalizedOriginator = originator.replace(/^https?:\/\//, '')
    return `${normalizedOriginator}:${counterparty}`
  }, [])

  const startPactCooldown = useCallback((originator: string, counterparty: string) => {
    const cacheKey = getPactCacheKey(originator, counterparty)
    const normalizedOriginator = originator.replace(/^https?:\/\//, '')
    groupCooldownUntilRef.current[`${normalizedOriginator}|${counterparty}`] = Date.now() + GROUP_COOLDOWN_MS

    try {
      ;(permissionsManagerRef.current as any)?.pactEstablishedCache?.set?.(cacheKey, Date.now())
    } catch {
      // ignore
    }

    const prevTimer = pactCooldownTimerByCacheKeyRef.current[cacheKey]
    if (prevTimer) {
      window.clearTimeout(prevTimer)
      delete pactCooldownTimerByCacheKeyRef.current[cacheKey]
    }

    pactCooldownTimerByCacheKeyRef.current[cacheKey] = window.setTimeout(() => {
      try {
        ;(permissionsManagerRef.current as any)?.pactEstablishedCache?.delete?.(cacheKey)
      } catch {
        // ignore
      }
      delete pactCooldownTimerByCacheKeyRef.current[cacheKey]
    }, PACT_COOLDOWN_MS) as any
  }, [getPactCacheKey])
  const [deferred, setDeferred] = useState<{
    basket: BasketAccessRequest[],
    certificate: CertificateAccessRequest[],
    protocol: ProtocolAccessRequest[],
    spending: SpendingRequest[],
    counterparty: CounterpartyPermissionRequest[],
  }>({ basket: [], certificate: [], protocol: [], spending: [], counterparty: [] });
  const deferredRef = useRef(deferred)

  useEffect(() => {
    groupPhaseRef.current = groupPhase
  }, [groupPhase])

  useEffect(() => {
    deferredRef.current = deferred
  }, [deferred])

  const setGroupPhaseSafe = useCallback((phase: GroupPhase) => {
    groupPhaseRef.current = phase
    setGroupPhase(phase)
  }, [])

  const normalizeOriginator = useCallback((o: string) => o.replace(/^https?:\/\//, ''), []);

  const getGroupCooldownKey = useCallback((originator: string, permissions?: GroupedPermissions) => {
    const normalizedOriginator = normalizeOriginator(originator);
    const protocolPermissions = permissions?.protocolPermissions ?? [];
    const hasOnlyProtocols =
      !!protocolPermissions.length &&
      !(permissions?.basketAccess?.length) &&
      !(permissions?.certificateAccess?.length) &&
      !permissions?.spendingAuthorization;

    if (!hasOnlyProtocols) {
      return normalizedOriginator;
    }

    const allLevel2 = protocolPermissions.every(p => (p.protocolID?.[0] ?? 0) === 2);
    if (!allLevel2) {
      return normalizedOriginator;
    }

    const cps = new Set(protocolPermissions.map(p => p.counterparty ?? 'self'));
    if (cps.size !== 1) {
      return normalizedOriginator;
    }

    const counterparty = protocolPermissions[0]?.counterparty ?? 'self';
    return `${normalizedOriginator}|${counterparty}`;
  }, [normalizeOriginator]);

  const isGroupCooldownActive = useCallback((key: string) => {
    const until = groupCooldownUntilRef.current[key] ?? 0;
    return Date.now() < until;
  }, []);

  const startGroupCooldown = useCallback((key: string) => {
    groupCooldownUntilRef.current[key] = Date.now() + GROUP_COOLDOWN_MS;
  }, []);

  useEffect(() => {
    permissionsManagerRef.current = managers.permissionsManager;
  }, [managers.permissionsManager]);

  useEffect(() => {
    return () => {
      try {
        for (const id of Object.values(pactCooldownTimerByCacheKeyRef.current)) {
          window.clearTimeout(id)
        }
      } catch {
        // ignore
      }
      pactCooldownTimerByCacheKeyRef.current = {}
    }
  }, [])

  const deferRequest = <T,>(key: keyof typeof deferred, item: T) => {
    setDeferred(prev => {
      const next = { ...prev, [key]: [...(prev as any)[key], item] as any } as any
      deferredRef.current = next
      return next
    });
  };

  // Decide if an item is covered by the group decision (conservative, adapt if needed)
  const isCoveredByDecision = (d: GroupDecision | null, req: any): boolean => {
    if (!d) return false;
    // Basket
    if ('basket' in req) {
      return !!d.allow.baskets && !!req.basket && d.allow.baskets.has(req.basket);
    }
    // Certificate
    if ('certificateType' in req || 'type' in req) {
      const type = (req.certificateType ?? req.type) as string | undefined;
      const fields = new Set<string>(req.fieldsArray ?? req.fields ?? []);
      if (!type) return false;
      const rule = d.allow.certificates?.find(c => c.type === type);
      if (!rule) return false;
      if (!rule.fields || rule.fields.size === 0) return true;
      for (const f of fields) if (!rule.fields.has(f)) return false;
      return true;
    }
    // Protocol
    if ('protocolID' in req) {
      if (d.allow.protocols === 'all') return true;
      if (!(d.allow.protocols instanceof Set)) return false;
      const key = req.protocolSecurityLevel === 2
        ? `${req.protocolID}|${req.counterparty ?? 'self'}`
        : req.protocolID;
      return d.allow.protocols.has(key);
    }
    // Spending
    if ('authorizationAmount' in req) {
      return d.allow.spendingUpTo != null && req.authorizationAmount <= (d.allow.spendingUpTo as number);
    }
    return false;
  };

  // Build decision object from the "granted" payload used by grantGroupedPermission
  const decisionFromGranted = (granted: any): GroupDecision => {
    const protocols = (() => {
      const arr = granted?.protocolPermissions ?? granted?.protocols ?? [];
      const names = new Set<string>();
      for (const p of arr) {
        const id = p?.protocolID;
        if (Array.isArray(id) && id.length > 1 && typeof id[1] === 'string') {
          const sec = id[0];
          const name = id[1];
          const counterparty = p?.counterparty ?? 'self';
          const key = sec === 2 ? `${name}|${counterparty}` : name;
          names.add(key);
        }
        else if (typeof id === 'string') names.add(id);
        else if (typeof p?.name === 'string') names.add(p.name);
      }
      return names;
    })();
    const baskets = (() => {
      const arr = granted?.basketAccess ?? granted?.baskets ?? [];
      const set = new Set<string>();
      for (const b of arr) {
        if (typeof b === 'string') set.add(b);
        else if (typeof b?.basket === 'string') set.add(b.basket);
      }
      return set;
    })();
    const certificates = (() => {
      const arr = granted?.certificateAccess ?? granted?.certificates ?? [];
      const out: Array<{ type: string; fields?: Set<string> }> = [];
      for (const c of arr) {
        const type = c?.type ?? c?.certificateType;
        if (typeof type === 'string') {
          const fields = new Set<string>((c?.fields ?? []).filter((x: any) => typeof x === 'string'));
          out.push({ type, fields: fields.size ? fields : undefined });
        }
      }
      return out;
    })();
    const spendingUpTo = (() => {
      const s = granted?.spendingAuthorization ?? granted?.spending ?? null;
      if (!s) return undefined;
      if (typeof s === 'number') return s;
      if (typeof s?.satoshis === 'number') return s.satoshis;
      if (typeof s?.amount === 'number') return s.amount;
      return undefined;
    })();
    return { allow: { protocols, baskets, certificates, spendingUpTo } };
  };

  // Release buffered requests after group decision (or on timeout/deny)
  const releaseDeferredAfterGroup = async (decision: GroupDecision | null) => {
    if (groupTimerRef.current) { window.clearTimeout(groupTimerRef.current); groupTimerRef.current = null; }
    groupDecisionRef.current = decision;

    const deferredCurrent = deferredRef.current

    const requeue = {
      basket: [] as BasketAccessRequest[],
      certificate: [] as CertificateAccessRequest[],
      protocol: [] as ProtocolAccessRequest[],
      spending: [] as SpendingRequest[],
      counterparty: [] as CounterpartyPermissionRequest[],
    };

    const maybeHandle = async (list: any[], key: keyof typeof requeue) => {
      for (const r of list) {
        if (isCoveredByDecision(decision, r)) {
          // Covered by grouped decision — do not requeue; grouped grant should satisfy it.
          // If you need explicit per-request approval, call it here against permissionsManager.
          // Example (adjust to your API):
          // await managers.permissionsManager?.respondToRequest(r.requestID, { approved: true });
        } else {
          (requeue as any)[key].push(r);
        }
      }
    };

    await maybeHandle(deferredCurrent.basket, 'basket');
    await maybeHandle(deferredCurrent.certificate, 'certificate');
    await maybeHandle(deferredCurrent.protocol, 'protocol');
    await maybeHandle(deferredCurrent.spending, 'spending');
    await maybeHandle(deferredCurrent.counterparty, 'counterparty');

    setDeferred({ basket: [], certificate: [], protocol: [], spending: [], counterparty: [] });
    deferredRef.current = { basket: [], certificate: [], protocol: [], spending: [], counterparty: [] }
    setGroupPhaseSafe('idle');

    // Re-open the uncovered ones via your existing flows
    if (requeue.basket.length) { setBasketRequests(requeue.basket); setBasketAccessModalOpen(true); }
    if (requeue.certificate.length) { setCertificateRequests(requeue.certificate); setCertificateAccessModalOpen(true); }
    if (requeue.protocol.length) { setProtocolRequests(requeue.protocol); setProtocolAccessModalOpen(true); }
    if (requeue.spending.length) { setSpendingRequests(requeue.spending); setSpendingAuthorizationModalOpen(true); }
    if (requeue.counterparty.length) { setCounterpartyPermissionRequests(requeue.counterparty); setCounterpartyPermissionModalOpen(true); }
  };

  const updateSettings = useCallback(async (newSettings: WalletSettings) => {
    if (!managers.settingsManager) {
      throw new Error('The user must be logged in to update settings!')
    }
    await managers.settingsManager.set(newSettings);
    setSettings(newSettings);
  }, [managers.settingsManager]);

  // ---- Callbacks for password/recovery/etc.
  const [passwordRetriever, setPasswordRetriever] = useState<
    (reason: string, test: (passwordCandidate: string) => boolean) => Promise<string>
  >(
    async (_reason, test) => {
      const candidate = '';
      const safeTest = typeof test === 'function' ? test : () => false
      if (safeTest(candidate)) {
        return candidate;
      }
      throw new Error('Password prompts are disabled in this build.');
    }
  );
  const [recoveryKeySaver, setRecoveryKeySaver] = useState<
    (key: number[]) => Promise<true>
  >();


  // Provide a handler for basket-access requests that enqueues them
  const basketAccessCallback = useCallback((incomingRequest: PermissionRequest & {
    requestID: string
    basket?: string
    originator: string
    reason?: string
    renewal?: boolean
  }) => {
    // Gate while group is pending
    if (groupPhaseRef.current === 'pending') {
      if (incomingRequest?.requestID) {
        deferRequest('basket', {
          requestID: incomingRequest.requestID,
          basket: incomingRequest.basket,
          originator: incomingRequest.originator,
          reason: incomingRequest.reason,
          renewal: incomingRequest.renewal
        });
      }
      return;
    }
    // Enqueue the new request
    if (incomingRequest?.requestID) {
      setBasketRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setBasketAccessModalOpen(true)
          })
        }

        return [
          ...prev,
          {
            requestID: incomingRequest.requestID,
            basket: incomingRequest.basket,
            originator: incomingRequest.originator,
            reason: incomingRequest.reason,
            renewal: incomingRequest.renewal
          }
        ]
      })
    }
  }, [isFocused, onFocusRequested])

  const counterpartyPermissionCallback = useCallback((args: CounterpartyPermissionRequest): Promise<void> => {
    if (!args?.requestID || !args?.permissions) {
      return Promise.resolve()
    }

    const newItem: CounterpartyPermissionRequest = {
      requestID: args.requestID,
      originator: args.originator,
      counterparty: args.counterparty,
      counterpartyLabel: args.counterpartyLabel,
      permissions: args.permissions,
    }

    if (groupPhaseRef.current === 'pending') {
      deferRequest('counterparty', newItem)
      return Promise.resolve()
    }

    setCounterpartyPermissionRequests(prev => {
      const wasEmpty = prev.length === 0
      if (wasEmpty) {
        setCounterpartyPermissionModalOpen(true)
        isFocused().then(currentlyFocused => {
          setWasOriginallyFocused(currentlyFocused)
          if (!currentlyFocused) {
            onFocusRequested()
          }
        })
      }
      return [...prev, newItem]
    })

    return Promise.resolve()
  }, [isFocused, onFocusRequested, setCounterpartyPermissionModalOpen])

  // Provide a handler for certificate-access requests that enqueues them
  const certificateAccessCallback = useCallback((incomingRequest: PermissionRequest & {
    requestID: string
    certificate?: {
      certType?: string
      fields?: Record<string, any>
      verifier?: string
    }
    originator: string
    reason?: string
    renewal?: boolean
  }) => {
    // Gate while group is pending
    if (groupPhaseRef.current === 'pending') {
      const certificate = incomingRequest.certificate as any
      deferRequest('certificate', {
        requestID: incomingRequest.requestID,
        originator: incomingRequest.originator,
        verifierPublicKey: certificate?.verifier || '',
        certificateType: certificate?.certType || '',
        fieldsArray: Object.keys(certificate?.fields || {}),
        description: incomingRequest.reason,
        renewal: incomingRequest.renewal
      } as any)
      return
    }

    // Enqueue the new request
    if (incomingRequest?.requestID) {
      setCertificateRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setCertificateAccessModalOpen(true)
          })
        }

        // Extract certificate data, safely handling potentially undefined values
        const certificate = incomingRequest.certificate as any
        const certType = certificate?.certType || ''
        const fields = certificate?.fields || {}

        // Extract field names as an array for the CertificateChip component
        const fieldsArray = fields ? Object.keys(fields) : []

        const verifier = certificate?.verifier || ''

        return [
          ...prev,
          {
            requestID: incomingRequest.requestID,
            originator: incomingRequest.originator,
            verifierPublicKey: verifier,
            certificateType: certType,
            fieldsArray,
            description: incomingRequest.reason,
            renewal: incomingRequest.renewal
          } as any
        ]
      })
    }
  }, [isFocused, onFocusRequested])

  // Provide a handler for protocol permission requests that enqueues them
  const protocolPermissionCallback = useCallback((args: PermissionRequest & { requestID: string }): Promise<void> => {
    const {
      requestID,
      counterparty,
      originator,
      reason,
      renewal,
      protocolID
    } = args

    if (!requestID || !protocolID) {
      return Promise.resolve()
    }

    const [protocolSecurityLevel, protocolNameString] = protocolID

    // Determine type of permission
    let permissionType: PermissionType = 'protocol'
    if (protocolNameString === 'identity resolution') {
      permissionType = 'identity'
    } else if (renewal) {
      permissionType = 'renewal'
    } else if (protocolNameString.includes('basket')) {
      permissionType = 'basket'
    }

    // Create the new permission request
    const newItem: ProtocolAccessRequest = {
      requestID,
      protocolSecurityLevel,
      protocolID: protocolNameString,
      counterparty,
      originator,
      description: reason,
      renewal,
      type: permissionType
    }

    if (groupPhaseRef.current === 'pending') {
      deferRequest('protocol', newItem)
      return Promise.resolve()
    }

    // Enqueue the new request
    return new Promise<void>(resolve => {
      setProtocolRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setProtocolAccessModalOpen(true)
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [isFocused, onFocusRequested])

  // Provide a handler for spending authorization requests that enqueues them
  const spendingAuthorizationCallback = useCallback(async (args: PermissionRequest & { requestID: string }): Promise<void> => {
    const {
      requestID,
      originator,
      reason,
      renewal,
      spending
    } = args

    if (!requestID || !spending) {
      return Promise.resolve()
    }

    let {
      satoshis,
      lineItems
    } = spending

    if (!lineItems) {
      lineItems = []
    }

    // TODO: support these
    const transactionAmount = 0
    const totalPastSpending = 0
    const amountPreviouslyAuthorized = 0

    // Create the new permission request
    const newItem: SpendingRequest = {
      requestID,
      originator,
      description: reason,
      transactionAmount,
      totalPastSpending,
      amountPreviouslyAuthorized,
      authorizationAmount: satoshis,
      renewal,
      lineItems
    }

    if (groupPhaseRef.current === 'pending') {
      deferRequest('spending', newItem)
      return
    }

    // Enqueue the new request
    return new Promise<void>(resolve => {
      setSpendingRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setSpendingAuthorizationModalOpen(true)
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [isFocused, onFocusRequested])

  // Provide a handler for group permission requests that enqueues them
  const groupPermissionCallback = useCallback(async (args: {
    requestID: string,
    permissions: GroupedPermissions,
    originator: string,
    reason?: string
  }): Promise<void> => {
    const {
      requestID,
      originator,
      permissions
    } = args

    if (!requestID || !permissions) {
      return Promise.resolve()
    }

    // Create the new permission request
    const newItem: GroupPermissionRequest = {
      requestID,
      originator,
      permissions
    }

    const cooldownKey = getGroupCooldownKey(originator, permissions)
    groupRequestCooldownKeyByIdRef.current.set(requestID, cooldownKey)

    if (isGroupCooldownActive(cooldownKey)) {
      try {
        Promise.resolve((permissionsManagerRef.current as any)?.dismissGroupedPermission?.(requestID)).catch(error => {
          console.debug('Failed to dismiss grouped permission during cooldown:', error)
        })
      } catch (error) {
        console.debug('Failed to dismiss grouped permission during cooldown:', error)
      }
      groupRequestCooldownKeyByIdRef.current.delete(requestID)
      return Promise.resolve()
    }

    // Enqueue the new request
    return new Promise<void>(resolve => {
      setGroupPermissionRequests(prev => {
        const wasEmpty = prev.length === 0

        // If no requests were queued, handle focusing logic right away
        if (wasEmpty) {
          setGroupPhaseSafe('pending')
          isFocused().then(currentlyFocused => {
            setWasOriginallyFocused(currentlyFocused)
            if (!currentlyFocused) {
              onFocusRequested()
            }
            setGroupPermissionModalOpen(true)
          })
        }

        resolve()
        return [...prev, newItem]
      })
    })
  }, [getGroupCooldownKey, isFocused, isGroupCooldownActive, onFocusRequested, setGroupPermissionModalOpen, setGroupPhaseSafe])

  // ---- ENTER GROUP PENDING MODE & PAUSE OTHERS when group request enqueued ----
  useEffect(() => {
    if (groupPermissionRequests.length > 0 && groupPhaseRef.current !== 'pending') {
      setGroupPhaseSafe('pending')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPermissionRequests.length])

  // ---- Network + storage configuration ----
  const [selectedNetwork] = useState<'main' | 'test'>(DEFAULT_CHAIN); // "test" or "main"
  const [selectedStorageUrl] = useState<string>(DEFAULT_STORAGE_URL);
  const [snapshotLoaded, setSnapshotLoaded] = useState<boolean>(false);

  // Build wallet function
  const buildWallet = useCallback(async (
    primaryKey: number[],
    privilegedKeyManager: PrivilegedKeyManager
  ): Promise<any> => {
    try {
      const newManagers = {} as any;
      const chain = selectedNetwork;
      const keyDeriver = new CachedKeyDeriver(new PrivateKey(primaryKey));
      const storageManager = new WalletStorageManager(keyDeriver.identityKey);
      const signer = new WalletSigner(chain, keyDeriver as any, storageManager);
      const services = new Services(chain);
      const makeLogger = () => new WalletLogger()
      const wallet = new Wallet(signer, services, undefined, privilegedKeyManager, makeLogger);
      newManagers.settingsManager = wallet.settingsManager;

      // Use user-selected storage provider
      const client = new StorageClient(wallet, selectedStorageUrl);
      await client.makeAvailable();
      await storageManager.addWalletStorageProvider(client);

      // Setup permissions with advanced configuration
      const permissionConfig = getPermissionConfigForMode();
      const permissionsManager = new WalletPermissionsManager(wallet, adminOriginator, permissionConfig);

      if (protocolPermissionCallback) {
        permissionsManager.bindCallback('onProtocolPermissionRequested', protocolPermissionCallback);
      }
      if (basketAccessCallback) {
        permissionsManager.bindCallback('onBasketAccessRequested', basketAccessCallback);
      }
      if (spendingAuthorizationCallback) {
        permissionsManager.bindCallback('onSpendingAuthorizationRequested', spendingAuthorizationCallback);
      }
      if (certificateAccessCallback) {
        permissionsManager.bindCallback('onCertificateAccessRequested', certificateAccessCallback);
      }

      if (groupPermissionCallback) {
        permissionsManager.bindCallback('onGroupedPermissionRequested', groupPermissionCallback);
      }

      if (counterpartyPermissionCallback) {
        ; (permissionsManager as any).bindCallback('onCounterpartyPermissionRequested', counterpartyPermissionCallback as any);
      }

      // ---- Proxy grouped-permission grant/deny so we can release the gate automatically ----
      const originalGrantGrouped = (permissionsManager as any).grantGroupedPermission?.bind(permissionsManager);
      const originalDenyGrouped = (permissionsManager as any).denyGroupedPermission?.bind(permissionsManager);
      const originalDismissGrouped = (permissionsManager as any).dismissGroupedPermission?.bind(permissionsManager);
      if (originalGrantGrouped) {
        (permissionsManager as any).grantGroupedPermission = async (...args: any[]) => {
          const params =
            args.length === 1 && args[0] && typeof args[0] === 'object' && 'requestID' in args[0]
              ? args[0]
              : { requestID: args[0], granted: args[1] };

          const res = await originalGrantGrouped(params);
          try {
            await releaseDeferredAfterGroup(decisionFromGranted(params.granted));
          } catch (error) {
            console.debug('Failed to release grouped decision:', error);
          }
          const key = groupRequestCooldownKeyByIdRef.current.get(params.requestID)
          if (key) {
            startGroupCooldown(key)
            groupRequestCooldownKeyByIdRef.current.delete(params.requestID)
          }
          return res;
        };
      }

      // ---- Proxy counterparty (PACT) grant/deny so we can force fallback to single prompts after deny/partial ----
      const originalGrantCounterparty = (permissionsManager as any).grantCounterpartyPermission?.bind(permissionsManager)
      const originalDenyCounterparty = (permissionsManager as any).denyCounterpartyPermission?.bind(permissionsManager)

      const parsePactRequestId = (requestID: string): { originator?: string; counterparty?: string } => {
        const m = /^pact:(.+):([0-9a-fA-F]{66})$/.exec(requestID)
        if (!m) return {}
        return { originator: m[1], counterparty: m[2] }
      }

      if (originalGrantCounterparty) {
        (permissionsManager as any).grantCounterpartyPermission = async (...args: any[]) => {
          const params =
            args.length === 1 && args[0] && typeof args[0] === 'object' && 'requestID' in args[0]
              ? args[0]
              : { requestID: args[0], granted: args[1], expiry: args[2] }

          const active = (permissionsManager as any).activeRequests?.get?.(params.requestID)
          const requestedCount = active?.request?.permissions?.protocols?.length ?? 0
          const grantedCount = params?.granted?.protocols?.length ?? 0
          const parsed = parsePactRequestId(params.requestID)
          const originator = active?.request?.originator ?? parsed.originator
          const counterparty = active?.request?.counterparty ?? parsed.counterparty

          const res = await originalGrantCounterparty(params)

          if (originator && counterparty && requestedCount > 0 && grantedCount < requestedCount) {
            startPactCooldown(originator, counterparty)
          }
          return res
        }
      }

      if (originalDenyCounterparty) {
        ;(permissionsManager as any).denyCounterpartyPermission = async (requestID: string) => {
          const active = (permissionsManager as any).activeRequests?.get?.(requestID)
          const parsed = parsePactRequestId(requestID)
          const originator = active?.request?.originator ?? parsed.originator
          const counterparty = active?.request?.counterparty ?? parsed.counterparty

          const res = await originalDenyCounterparty(requestID)

          if (originator && counterparty) {
            startPactCooldown(originator, counterparty)
          }
          return res
        }
      }
      if (originalDismissGrouped) {
        (permissionsManager as any).dismissGroupedPermission = async (requestID: string) => {
          const res = await originalDismissGrouped(requestID);
          try {
            await releaseDeferredAfterGroup(null);
          } catch (error) {
            console.debug('Failed to release grouped decision:', error);
          }
          const key = groupRequestCooldownKeyByIdRef.current.get(requestID)
          if (key) {
            startGroupCooldown(key)
            groupRequestCooldownKeyByIdRef.current.delete(requestID)
          }
          return res;
        };
      }
      if (originalDenyGrouped) {
        (permissionsManager as any).denyGroupedPermission = async (requestID: string) => {
          const res = await originalDenyGrouped(requestID);
          try {
            await releaseDeferredAfterGroup(null);
          } catch (error) {
            console.debug('Failed to release grouped decision:', error);
          }
          const key = groupRequestCooldownKeyByIdRef.current.get(requestID)
          if (key) {
            startGroupCooldown(key)
            groupRequestCooldownKeyByIdRef.current.delete(requestID)
          }
          return res;
        };
      }

      // Store in window for debugging
      (window as any).permissionsManager = permissionsManager;
      newManagers.permissionsManager = permissionsManager;

      setManagers(m => ({ ...m, ...newManagers }));

      return permissionsManager;
    } catch (error: any) {
      console.error("Error building wallet:", error);
      toast.error("Failed to build wallet: " + error.message);
      return null;
    }
  }, [
    selectedNetwork,
    selectedStorageUrl,
    adminOriginator,
    protocolPermissionCallback,
    basketAccessCallback,
    spendingAuthorizationCallback,
    certificateAccessCallback,
    groupPermissionCallback,
    counterpartyPermissionCallback,
    startPactCooldown
  ]);


  // Load snapshot function
  const loadWalletSnapshot = useCallback(async (walletManager: SimpleWalletManager) => {
    if (localStorage.snap) {
      try {
        const snapArr = Utils.toArray(localStorage.snap, 'base64');
        await walletManager.loadSnapshot(snapArr);
        // We'll handle setting snapshotLoaded in a separate effect watching authenticated state
      } catch (err: any) {
        console.error("Error loading snapshot", err);
        localStorage.removeItem('snap'); // Clear invalid snapshot
        toast.error("Couldn't load saved data: " + err.message);
      }
    }
  }, []);

  // Watch for wallet authentication after snapshot is loaded
  useEffect(() => {
    if (managers?.walletManager?.authenticated && localStorage.snap) {
      setSnapshotLoaded(true);
    }
  }, [managers?.walletManager?.authenticated]);

  // ---- Build the wallet manager once all required inputs are ready.
  useEffect(() => {
    if (
      passwordRetriever &&
      recoveryKeySaver &&
      !managers.walletManager // build only once
    ) {
      try {
        const walletManager = new SimpleWalletManager(adminOriginator, buildWallet);

        // Store in window for debugging
        (window as any).walletManager = walletManager;

        // Set initial managers state to prevent null references
        setManagers(m => ({ ...m, walletManager }));

        const hydrateFromStorage = async () => {
          try {
            await loadWalletSnapshot(walletManager);
            const { keyHex } = reconcileStoredKeyMaterial();
            if (keyHex) {
              const keyBytes = Utils.toArray(keyHex, 'hex');
              await walletManager.providePrimaryKey(keyBytes);
              const privilegedManager = createDisabledPrivilegedManager();
              await walletManager.providePrivilegedKeyManager(privilegedManager);
            }
          } catch (err: any) {
            console.error('Error hydrating wallet from storage:', err);
          }
        };

        hydrateFromStorage();
      } catch (err: any) {
        console.error("Error initializing wallet manager:", err);
        toast.error("Failed to initialize wallet: " + err.message);
      }
    }
  }, [
    passwordRetriever,
    recoveryKeySaver,
    managers.walletManager,
    buildWallet,
    loadWalletSnapshot,
    adminOriginator
  ]);

  // When Settings manager becomes available, populate the user's settings
  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoaded(false)
      if (managers.settingsManager) {
        try {
          const userSettings = await managers.settingsManager.get();
          setSettings(userSettings);
        } catch (e) {
          // Unable to load settings, defaults are already loaded.
        } finally {
          setSettingsLoaded(true)
        }
      } else {
        setSettingsLoaded(false)
      }
    };

    loadSettings();
  }, [managers]);

  useEffect(() => {
    const wallet = managers?.walletManager as any
    if (!wallet?.authenticated) return
    if (!managers.settingsManager) return
    if (!activeProfile?.id) return
    if (!settingsLoaded) return
    if (typeof localStorage === 'undefined') return

    const profileId = Array.isArray((activeProfile as any).id)
      ? (activeProfile as any).id.join(',')
      : String((activeProfile as any).id)
    const firstLoginKey = `uw_first_login_done_v1:${profileId}`

    try {
      if (localStorage.getItem(firstLoginKey)) return
    } catch {
      return
    }

    const current = (settings?.currency || '').toString().toUpperCase()
    const shouldAutoSet = !current

    if (shouldAutoSet) {
      try {
        const derived = deriveDefaultFiatCurrencyFromNavigator().toString().toUpperCase()
        if (derived && derived !== current) {
          const nextSettings = {
            ...settings,
            currency: derived
          }
          void managers.settingsManager.set(nextSettings as any).then(() => {
            setSettings(nextSettings as any)
          })
        }
      } catch {
        // ignore
      }
    }

    try {
      localStorage.setItem(firstLoginKey, '1')
    } catch {
      // ignore
    }
  }, [activeProfile?.id, managers?.walletManager, managers.settingsManager, settings, settingsLoaded])

  useEffect(() => {
    const wallet = managers?.walletManager as any
    if (!wallet?.authenticated) return
    if (!activeProfile?.id) return
    if (typeof localStorage === 'undefined') return
    if (regionCurrencyPromptOpen) return

    const current = (settings?.currency || '').toString().toUpperCase()
    if (current !== 'BSV' && current !== 'SATS') return

    const profileId = Array.isArray((activeProfile as any).id)
      ? (activeProfile as any).id.join(',')
      : String((activeProfile as any).id)

    const storageKey = `uw_region_currency_prompted_v1:${profileId}`
    try {
      if (localStorage.getItem(storageKey)) return
    } catch {
      return
    }

    const suggested = deriveDefaultFiatCurrencyFromNavigator()
    const suggestedUpper = suggested.toString().toUpperCase()
    if (!suggestedUpper) return
    if (suggestedUpper === current) {
      try {
        localStorage.setItem(storageKey, '1')
      } catch {
        // ignore
      }
      return
    }

    setRegionCurrencyPromptSuggested(suggestedUpper)
    setRegionCurrencyPromptOpen(true)
  }, [activeProfile?.id, managers?.walletManager, regionCurrencyPromptOpen, settings?.currency])

  const markRegionCurrencyPrompted = useCallback(() => {
    if (!activeProfile?.id) return
    const profileId = Array.isArray((activeProfile as any).id)
      ? (activeProfile as any).id.join(',')
      : String((activeProfile as any).id)
    const storageKey = `uw_region_currency_prompted_v1:${profileId}`
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      // ignore
    }
  }, [activeProfile?.id])

  const denyRegionCurrencySwitch = useCallback(() => {
    markRegionCurrencyPrompted()
    setRegionCurrencyPromptOpen(false)
  }, [markRegionCurrencyPrompted])

  const acceptRegionCurrencySwitch = useCallback(async () => {
    try {
      await updateSettings({
        ...settings,
        currency: regionCurrencyPromptSuggested
      })
    } catch {
      // ignore
    } finally {
      markRegionCurrencyPrompted()
      setRegionCurrencyPromptOpen(false)
    }
  }, [markRegionCurrencyPrompted, regionCurrencyPromptSuggested, settings, updateSettings])

  const logout = useCallback(() => {
    const preserved: Record<string, string> = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key) continue
        if (key.startsWith('uw_region_currency_prompted_v1:') || key.startsWith('uw_first_login_done_v1:')) {
          const value = localStorage.getItem(key)
          if (value != null) preserved[key] = value
        }
      }
    } catch {
      // ignore
    }

    // Clear localStorage to prevent auto-login
    localStorage.clear();

    try {
      for (const [key, value] of Object.entries(preserved)) {
        localStorage.setItem(key, value)
      }
    } catch {
      // ignore
    }
    if (localStorage.snap) {
      localStorage.removeItem('snap');
    }
    localStorage.removeItem('primaryKeyHex');
    localStorage.removeItem('mnemonic12');

    // Reset manager state
    setManagers({});

    setSettings(DEFAULT_SETTINGS)
    setSettingsLoaded(false)

    setSnapshotLoaded(false);
  }, []);

  // Automatically set active profile when wallet manager becomes available
  useEffect(() => {
    const wallet = managers?.walletManager as any;
    if (!wallet?.authenticated) {
      setActiveProfile(null)
      return
    }

    if (typeof wallet?.listProfiles === 'function') {
      const profiles = wallet.listProfiles()
      const profileToSet = profiles.find((p: any) => p.active) || profiles[0]
      if (profileToSet?.id) {
        setActiveProfile(profileToSet)
        return
      }
    }

    try {
      const { keyHex } = reconcileStoredKeyMaterial()
      if (!keyHex) {
        setActiveProfile(null)
        return
      }

      const keyBytes = Utils.toArray(keyHex, 'hex')
      const deriver = new CachedKeyDeriver(new PrivateKey(keyBytes))
      const identityKeyHex = deriver.identityKey
      const derivedProfile: WalletProfile = {
        id: Utils.toArray(identityKeyHex, 'hex'),
        name: 'default',
        createdAt: Date.now(),
        active: true,
        identityKey: identityKeyHex as any
      }
      setActiveProfile(derivedProfile)
    } catch (error) {
      console.error('Failed to derive profile from stored key:', error)
      setActiveProfile(null)
    }
  }, [managers?.walletManager?.authenticated])

  // Track recent origins to prevent duplicate updates in a short time period
  const recentOriginsRef = useRef<Map<string, number>>(new Map());
  const walletListenerRef = useRef<(() => void) | undefined>(undefined);
  const DEBOUNCE_TIME_MS = 5000; // 5 seconds debounce

  useEffect(() => {
    const wallet = managers?.walletManager;
    const profileId = activeProfile?.id;

    if (!wallet?.authenticated || !profileId) {
      recentOriginsRef.current.clear();
      if (walletListenerRef.current) {
        walletListenerRef.current();
        walletListenerRef.current = undefined;
      }
      return undefined;
    }

    let encodedProfileId: string;
    try {
      encodedProfileId = Utils.toBase64(profileId);
    } catch (error) {
      console.error('Failed to encode profile id for wallet listener:', error);
      return undefined;
    }

    let disposed = false;
    recentOriginsRef.current.clear();

    const updateRecentAppWrapper = async (id: string, origin: string): Promise<void> => {
      try {
        const cacheKey = `${id}:${origin}`;
        const now = Date.now();

        const lastProcessed = recentOriginsRef.current.get(cacheKey);
        if (lastProcessed && (now - lastProcessed) < DEBOUNCE_TIME_MS) {
          return;
        }

        recentOriginsRef.current.set(cacheKey, now);
        await updateRecentApp(id, origin);

        window.dispatchEvent(new CustomEvent('recentAppsUpdated', {
          detail: {
            profileId: id,
            origin
          }
        }));
      } catch (error) {
        console.debug('Error tracking recent app:', error);
      }
    };

    const bindListener = async () => {
      if (walletListenerRef.current) {
        walletListenerRef.current();
        walletListenerRef.current = undefined;
      }

      try {
        const interceptorWallet = new RequestInterceptorWallet(wallet, encodedProfileId, updateRecentAppWrapper);
        const unlisten = await onWalletReady(interceptorWallet);

        if (disposed) {
          if (unlisten) {
            unlisten();
          }
          return;
        }

        walletListenerRef.current = unlisten ?? undefined;
      } catch (error) {
        console.error('Failed to initialize wallet request listener:', error);
      }
    };

    bindListener();

    return () => {
      disposed = true;
      if (walletListenerRef.current) {
        walletListenerRef.current();
        walletListenerRef.current = undefined;
      }
    };
  }, [managers?.walletManager, managers?.walletManager?.authenticated, activeProfile?.id, onWalletReady])

  useEffect(() => {
    if (typeof managers.walletManager === 'object') {
      (async () => {

      })()
    }
  }, [adminOriginator, managers?.permissionsManager])

  // Pop the first request from the basket queue, close if empty, relinquish focus if needed
  const advanceBasketQueue = () => {
    setBasketRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setBasketAccessModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the certificate queue, close if empty, relinquish focus if needed
  const advanceCertificateQueue = () => {
    setCertificateRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setCertificateAccessModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the protocol queue, close if empty, relinquish focus if needed
  const advanceProtocolQueue = () => {
    setProtocolRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setProtocolAccessModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the spending queue, close if empty, relinquish focus if needed
  const advanceSpendingQueue = () => {
    setSpendingRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setSpendingAuthorizationModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  // Pop the first request from the group permission queue, close if empty, relinquish focus if needed
  const advanceGroupQueue = () => {
    setGroupPermissionRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setGroupPhaseSafe('idle')
        setGroupPermissionModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  const advanceCounterpartyPermissionQueue = () => {
    setCounterpartyPermissionRequests(prev => {
      const newQueue = prev.slice(1)
      if (newQueue.length === 0) {
        setCounterpartyPermissionModalOpen(false)
        if (!wasOriginallyFocused) {
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  const registryFromWallet = useMemo(
    () => getRegistryClient(managers.walletManager, adminOriginator),
    [managers.walletManager, adminOriginator]
  )
  const registryFromPermissions = useMemo(
    () => getRegistryClient(managers.permissionsManager, adminOriginator),
    [managers.permissionsManager, adminOriginator]
  )
  const identityClient = useMemo(
    () => getIdentityClient(managers.permissionsManager, adminOriginator),
    [managers.permissionsManager, adminOriginator]
  )

  const contextValue = useMemo<WalletContextValue>(() => ({
    managers,
    updateManagers: setManagers,
    settings,
    updateSettings,
    network: selectedNetwork === 'test' ? 'testnet' : 'mainnet',
    activeProfile: activeProfile,
    setActiveProfile: setActiveProfile,
    logout,
    adminOriginator,
    setPasswordRetriever,
    setRecoveryKeySaver,
    snapshotLoaded,
    basketRequests,
    certificateRequests,
    protocolRequests,
    spendingRequests,
    groupPermissionRequests,
    counterpartyPermissionRequests,
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceGroupQueue,
    advanceProtocolQueue,
    advanceSpendingQueue,
    advanceCounterpartyPermissionQueue,
    recentApps,
    clients: {
      registryFromWallet,
      registryFromPermissions,
      identityClient
    }
  }), [
    managers,
    settings,
    updateSettings,
    selectedNetwork,
    activeProfile,
    logout,
    adminOriginator,
    setPasswordRetriever,
    setRecoveryKeySaver,
    snapshotLoaded,
    basketRequests,
    certificateRequests,
    protocolRequests,
    spendingRequests,
    groupPermissionRequests,
    counterpartyPermissionRequests,
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceProtocolQueue,
    advanceSpendingQueue,
    recentApps,
    registryFromWallet,
    registryFromPermissions,
    identityClient,
    advanceGroupQueue,
    advanceCounterpartyPermissionQueue
  ]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={regionCurrencyPromptOpen}
        onClose={denyRegionCurrencySwitch}
        fullWidth
        maxWidth='xs'
      >
        <DialogTitle color='textPrimary'>Switch to your local currency?</DialogTitle>
        <DialogContent>
          <DialogContentText color='textSecondary'>
            You’re currently displaying amounts in{' '}
            {((settings?.currency || '').toString().toUpperCase() === 'SATS' ? 'Sats' : 'BSV')}. Would you like to
            switch to{' '}
            {getCurrencyDisplayName(
              regionCurrencyPromptSuggested,
              (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || undefined
            )}{' '}
            ({regionCurrencyPromptSuggested}) based on your region?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={denyRegionCurrencySwitch}>Cancel</Button>
          <Button
            color='error'
            onClick={() => {
              void acceptRegionCurrencySwitch()
            }}
          >
            Switch
          </Button>
        </DialogActions>
      </Dialog>
    </WalletContext.Provider>
  )
}
