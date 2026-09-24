import { DEVICE_BACKUP_PREFERENCES_KEY, loadDeviceBackupPreferences, saveDeviceBackupPreferences, resolveBackupPreferences, reconcileBackupPreferences, missingPreferredBackups, type DeviceBackupPreferences, type ResolvedBackupPreferences } from './walletStoragePreferences'
import { invoke } from '@tauri-apps/api/core'
import { PortabilityError, type ArchiveSource } from './walletPortability'
import { runPortabilityWorker } from './walletPortabilityClient'
import { loadArchiveJob, openArchiveStorage, updateArchiveJob, type ArchiveJob } from './walletPortabilityStore'
import { commitArchiveActivation, recoverArchiveActivation } from './walletPortabilityActivation'
import { loadProfileWalletStorageConfig, walletProfileStorage } from './walletStorageProfiles'
import { resolveLocalWalletDatabase } from './walletStorageLocal'
import { prepareWalletBackupSetup, validateWalletStorageCapabilities } from './walletStorageSetup'
import { yieldWalletStorageTask } from './walletStorageScheduling'
import {
  addBackupTarget,
  beginWalletStorageOperation,
  clearPendingWalletStorageOperation,
  isMatchingPendingWalletStorageOperation,
  loadWalletStorageConfig,
  makePrimaryTarget,
  markWalletStorageSynced,
  normalizeWalletStorageTarget,
  persistWalletStorageConfig,
  removeBackupTarget,
  recoverPendingWalletStorageOperation,
  walletStorageTargetId,
  walletStorageTargetsEqual,
  type NetworkWalletStorageConfig,
  type WalletStorageNetwork,
  type WalletStorageOperationKind,
  type WalletStorageTarget
} from './walletStorageConfig'
import {
  applyWalletStorageUploadChunkLimits,
  buildWalletStorageProviderStatuses,
  encodeWalletStorageSyncProgress,
  parseWalletStorageSyncProgress,
  enforceConfiguredPrimary,
  findStoreForTarget,
  getBoundedWalletStorageUploadChunk,
  summarizeWalletStorageSyncChunk,
  type WalletStorageProviderStatus
} from './walletStorageRuntime'
import { WalletBackupStorageClient, WalletStorageProviderError, walletStorageFailureDetails, walletStorageTransferMessage, type WalletStorageFailure } from './walletStorageRpc'
import { WalletStorageConnections, WalletBackupStorageManager } from './walletStorageConnections'
import { updateSyncDisplayProgress, type StorageSyncDisplayProgress } from './walletStorageProgress'
import {
  runWalletStorageBenchmark,
  type WalletStorageBenchmarkResult
} from './walletStorageBenchmark'

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
  Services,
  StorageIdb,
  sdk,
  PermissionRequest,
  WalletLogger,
  DEFAULT_SETTINGS,
  WalletSettings,
  WalletSettingsManager,
  ChaintracksServiceClient,
} from '@bsv/wallet-toolbox-client'
import {
  PrivateKey,
  Utils,
  WalletInterface,
  CachedKeyDeriver,
} from '@bsv/sdk'
import type { IdentityClient, RegistryClient } from '@bsv/sdk'
import type { PermissionsManagerConfig } from '@bsv/wallet-toolbox-client'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import {
  ACTIVE_WALLET_ENVIRONMENT,
  DEFAULT_STORAGE_URL,
  ADMIN_ORIGINATOR,
  WALLET_ENVIRONMENT_STORAGE_KEY,
  getWalletEnvironmentStorageItem,
  walletEnvironmentStoragePrefix,
  type WalletEnvironment,
} from './config'
import { deriveDefaultFiatCurrencyFromNavigator, getCurrencyDisplayName } from './utils/currency'
import { UserContext } from './UserContext'
import { CounterpartyPermissionRequest, GroupPermissionRequest, GroupedPermissions } from './types/GroupedPermissions'
import { updateRecentApp } from './pages/Dashboard/Apps/getApps'
import { RequestInterceptorWallet } from './RequestInterceptorWallet'
import { WalletProfile } from './types/WalletProfile'
import { getIdentityClient, getRegistryClient } from './utils/clientFactories'
import { reconcileStoredKeyMaterial } from './utils/keyMaterial'
import { listen } from '@tauri-apps/api/event'
import type { ActivePromptSummary, WalletBridgeInspector } from './onWalletReady'
import {
  createWalletTelemetryConfig,
  reportDiagnosticError,
  reportDiagnosticEvent
} from './diagnostics'
import {
  createStorageConnectionWarmer,
  isOfficialStorageEndpoint,
  type StorageConnectionWarmupReason
} from './storageConnectionWarmup'
import { localChaintracksManager } from './chaintracks/localChaintracks'

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
  wallet?: WalletInterface;
  storageManager?: WalletStorageManager;
  storageConnections?: WalletStorageConnections;
}

export interface WalletStorageOperationState {
  busy: boolean
  automatic?: boolean
  providerFailure?: WalletStorageFailure
  kind?: WalletStorageOperationKind | 'sync-backups' | 'remove-backup' | 'local-benchmark' | 'cancel-setup' | 'portable-data'
  error?: string
  cancelled?: boolean
  cancelRequested?: boolean
  startedAt?: number
  completedAt?: number
  progress: Array<{ message: string; at: number }>
  syncProgress?: StorageSyncDisplayProgress
}

export interface WalletContextValue {
  // Managers:
  managers: ManagerState;
  updateManagers: (newManagers: ManagerState) => void;
  // Settings
  settings: WalletSettings;
  updateSettings: (newSettings: WalletSettings) => Promise<void>;
  network: WalletEnvironment['networkPreset'];
  environment: WalletEnvironment;
  storageConfig: NetworkWalletStorageConfig
  storageProviders: WalletStorageProviderStatus[]
  storageOperation: WalletStorageOperationState
  storageBenchmark?: WalletStorageBenchmarkResult
  addBackupStorage: (target: WalletStorageTarget, progress?: (message: string) => void) => Promise<void>
  removeBackupStorage: (target: WalletStorageTarget, progress?: (message: string) => void) => Promise<void>
  syncBackupStorage: (progress?: (message: string) => void, options?: { automatic?: boolean }) => Promise<void>
  setPrimaryStorage: (target: WalletStorageTarget, progress?: (message: string) => void) => Promise<void>
  runLocalStorageBenchmark: (progress?: (message: string) => void, options?: { sourceUrl?: string; maxPages?: number }) => Promise<WalletStorageBenchmarkResult>
  cancelBackupSetup: () => Promise<void>
  cancelStorageOperation: () => void
  deviceBackupPreferences: DeviceBackupPreferences
  backupPreferences: ResolvedBackupPreferences
  saveBackupPreferences: (mode: 'device' | 'profile', preferences: DeviceBackupPreferences) => Promise<void>
  setUpPreferredBackup: () => Promise<void>
  walletDataIdentity?: string
  getArchiveSource: (synchronize: boolean, progress?: (message: string) => void) => Promise<ArchiveSource>
  mergeWalletArchive: (id: string, progress: (message: string) => void, signal?: AbortSignal) => Promise<ArchiveJob>
  activateWalletArchive: (id: string, progress: (message: string) => void, signal?: AbortSignal) => Promise<void>
  // Active Profile
  activeProfile: WalletProfile | null;
  setActiveProfile: (profile: WalletProfile | null) => void;
  // Logout
  logout: () => Promise<void>;
  adminOriginator: string;
  setPasswordRetriever: (retriever: (reason: string, test: (passwordCandidate: string) => boolean) => Promise<string>) => void
  setRecoveryKeySaver: (saver: (key: number[]) => Promise<true>) => void
  snapshotLoaded: boolean
  walletHydrating: boolean
  walletStartupError?: string
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

export class WalletStorageOperationCancelledError extends Error {
  constructor () {
    super('Wallet storage operation cancelled')
    this.name = 'WalletStorageOperationCancelledError'
  }
}

const defaultStorageConfig = (): NetworkWalletStorageConfig => ({
  revision: 0,
  primary: { kind: 'remote', url: DEFAULT_STORAGE_URL },
  backups: [],
  localStorageIdentityKey: '',
  lastSuccessfulSyncAt: {},
  updatedAt: ''
})

const createLocalStorageIdentityKey = (): string => PrivateKey.fromRandom().toHex()

const createStorageOperationId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const WalletContext = createContext<WalletContextValue>({
  managers: {},
  updateManagers: () => { },
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => { },
  network: ACTIVE_WALLET_ENVIRONMENT.networkPreset,
  environment: ACTIVE_WALLET_ENVIRONMENT,
  storageConfig: defaultStorageConfig(),
  storageProviders: [],
  storageOperation: { busy: false, progress: [] },
  storageBenchmark: undefined,
  addBackupStorage: async () => { },
  removeBackupStorage: async () => { },
  syncBackupStorage: async () => { },
  setPrimaryStorage: async () => { },
  runLocalStorageBenchmark: async () => { throw new Error('Wallet storage is not ready') },
  cancelBackupSetup: async () => { },
  cancelStorageOperation: () => { },
  deviceBackupPreferences: { backups: [{ kind: 'local' }], automatic: true },
  backupPreferences: { mode: 'device', backups: [{ kind: 'local' }], automatic: true },
  saveBackupPreferences: async () => {},
  setUpPreferredBackup: async () => {},
  getArchiveSource: async () => { throw new PortabilityError('storage') },
  mergeWalletArchive: async () => { throw new PortabilityError('storage') },
  activateWalletArchive: async () => { throw new PortabilityError('storage') },
  activeProfile: null,
  setActiveProfile: () => { },
  logout: async () => { },
  adminOriginator: ADMIN_ORIGINATOR,
  setPasswordRetriever: () => { },
  setRecoveryKeySaver: () => { },
  snapshotLoaded: false,
  walletHydrating: true,
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

type WalletQaPermissionKind = 'basket' | 'certificate' | 'protocol' | 'spending'

type WalletQaPermissionDecision = {
  kind: WalletQaPermissionKind
  decision: 'grant' | 'deny'
}

interface WalletContextProps {
  children?: React.ReactNode;
  onWalletReady: (wallet: WalletInterface, inspector?: WalletBridgeInspector) => Promise<(() => void) | undefined>;
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
  const wasOriginallyFocusedRef = useRef(false)
  const didRequestPromptFocusRef = useRef(false)
  const groupDidRequestFocusRef = useRef(false)
  const pendingGroupFocusRequestIdRef = useRef<string | null>(null)

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
    () => async (_reason: string, test: (passwordCandidate: string) => boolean) => {
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
            wasOriginallyFocusedRef.current = currentlyFocused
            if (!currentlyFocused) {
              didRequestPromptFocusRef.current = true
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
          wasOriginallyFocusedRef.current = currentlyFocused
          if (!currentlyFocused) {
            didRequestPromptFocusRef.current = true
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
            wasOriginallyFocusedRef.current = currentlyFocused
            if (!currentlyFocused) {
              didRequestPromptFocusRef.current = true
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
            wasOriginallyFocusedRef.current = currentlyFocused
            if (!currentlyFocused) {
              didRequestPromptFocusRef.current = true
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
            wasOriginallyFocusedRef.current = currentlyFocused
            if (!currentlyFocused) {
              didRequestPromptFocusRef.current = true
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
          pendingGroupFocusRequestIdRef.current = requestID
          groupDidRequestFocusRef.current = false
          isFocused().then(currentlyFocused => {
            if (pendingGroupFocusRequestIdRef.current !== requestID) return
            wasOriginallyFocusedRef.current = currentlyFocused
            if (!currentlyFocused) {
              groupDidRequestFocusRef.current = true
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
  const selectedNetwork = ACTIVE_WALLET_ENVIRONMENT.chain
  const selectedStorageUrl = ACTIVE_WALLET_ENVIRONMENT.storageUrl
  const [snapshotLoaded, setSnapshotLoaded] = useState<boolean>(false);
  const [walletHydrating, setWalletHydrating] = useState(true)
  const [walletStartupError, setWalletStartupError] = useState<string>()
  const storageNetwork = selectedNetwork
  const [storageConfig, setStorageConfig] = useState<NetworkWalletStorageConfig>(() =>
    loadWalletStorageConfig(localStorage, storageNetwork, DEFAULT_STORAGE_URL, createLocalStorageIdentityKey)
  )
  const deviceBackupPreferences = useMemo(() => loadDeviceBackupPreferences(localStorage, storageNetwork), [storageNetwork])
  const backupPreferences = useMemo(() => resolveBackupPreferences(storageConfig, deviceBackupPreferences), [storageConfig, deviceBackupPreferences])
  const [storageProviders, setStorageProviders] = useState<WalletStorageProviderStatus[]>([])
  const [storageOperation, setStorageOperation] = useState<WalletStorageOperationState>({ busy: false, progress: [] })
  const [storageBenchmark, setStorageBenchmark] = useState<WalletStorageBenchmarkResult>()
  const storageScopeRef = useRef<{ identityKey: string; network: WalletStorageNetwork }>()
  const storageProfileChangingRef = useRef(false)
  const storageOperationDoneRef = useRef<Promise<void>>(Promise.resolve())
  const storageOperationRef = useRef(false)
  const storageOperationCancelRequestedRef = useRef(false)
  const storageProviderErrorsRef = useRef(new Map<string, string>())
  const storageSyncProgressReporterRef = useRef<((message: string) => void) | undefined>(undefined)
  const storageConnectionWarmerRef = useRef<ReturnType<typeof createStorageConnectionWarmer> | undefined>(undefined)

  const throwIfStorageOperationCancelled = useCallback(() => {
    if (storageOperationCancelRequestedRef.current) {
      throw new WalletStorageOperationCancelledError()
    }
  }, [])

  const cancelStorageOperation = useCallback(() => {
    if (!storageOperationRef.current || storageOperationCancelRequestedRef.current) return
    storageOperationCancelRequestedRef.current = true
    storageSyncProgressReporterRef.current?.(
      'Cancellation requested; finishing the current page before stopping safely...'
    )
    setStorageOperation(previous => ({ ...previous, cancelRequested: true }))
  }, [])

  const saveStorageConfig = useCallback((next: NetworkWalletStorageConfig): NetworkWalletStorageConfig => {
    const scope = storageScopeRef.current
    const persisted = persistWalletStorageConfig(
      scope ? walletProfileStorage(localStorage, scope.identityKey) : localStorage,
      scope?.network ?? storageNetwork, next
    )
    setStorageConfig(persisted)
    return persisted
  }, [storageNetwork])

  useEffect(() => {
    const next = loadWalletStorageConfig(
      localStorage,
      storageNetwork,
      selectedStorageUrl || DEFAULT_STORAGE_URL,
      createLocalStorageIdentityKey
    )
    setStorageConfig(next)
    storageProviderErrorsRef.current = new Map()
    setStorageProviders([])
  }, [storageNetwork])

  const warmStorageConnection = useCallback((reason: StorageConnectionWarmupReason) => {
    void storageConnectionWarmerRef.current?.warm(reason)
  }, [])

  useEffect(() => {
    const handleFocus = () => warmStorageConnection('focus')
    const handleOnline = () => warmStorageConnection('online')
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') warmStorageConnection('visible')
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
      storageConnectionWarmerRef.current?.clear()
      storageConnectionWarmerRef.current = undefined
    }
  }, [warmStorageConnection])

  const refreshStorageProviders = useCallback((
    storageManager: WalletStorageManager,
    config: NetworkWalletStorageConfig,
    errors = storageProviderErrorsRef.current
  ) => {
    setStorageProviders(buildWalletStorageProviderStatuses(
      config,
      storageManager.getStores(),
      errors
    ))
  }, [])

  const createWalletStorageProvider = useCallback(async (
    wallet: WalletInterface,
    target: WalletStorageTarget,
    chain: WalletStorageNetwork,
    localStorageIdentityKey: string,
    telemetry: ReturnType<typeof createWalletTelemetryConfig>,
    existingLocal = false
  ) => {
    if (target.kind === 'local') {
      storageSyncProgressReporterRef.current?.('Checking this profile’s device backup location...')
      const { publicKey } = await wallet.getPublicKey({ identityKey: true })
      storageSyncProgressReporterRef.current?.('Opening the saved device backup location...')
      const binding = await resolveLocalWalletDatabase(localStorage, chain, publicKey, localStorageIdentityKey, existingLocal)
      const provider = new StorageIdb({
        chain,
        commissionSatoshis: 0,
        commissionPubKeyHex: undefined,
        feeModel: { model: 'sat/kb', value: 1 }
      })
      provider.dbName = binding.name
      const syncTotalsByPhase = new Map<string, number>()
      const getSyncChunk = provider.getSyncChunk.bind(provider)
      provider.getSyncChunk = async args => {
        throwIfStorageOperationCancelled()
        const phase = `${args.fromStorageIdentityKey}:${args.toStorageIdentityKey}:${String(args.since ?? '')}`
        const knownTotalRecords = syncTotalsByPhase.get(phase)
        ;(args as sdk.RequestSyncChunkArgs & { includeTotals?: boolean }).includeTotals = knownTotalRecords == null
        const chunk = await getBoundedWalletStorageUploadChunk<
          sdk.RequestSyncChunkArgs,
          sdk.SyncChunk
        >(
          applyWalletStorageUploadChunkLimits(args),
          getSyncChunk,
          true
        )
        throwIfStorageOperationCancelled()
        const chunkProgress = summarizeWalletStorageSyncChunk(args, chunk, knownTotalRecords)
        if (chunkProgress.totalRecords != null) syncTotalsByPhase.set(phase, chunkProgress.totalRecords)
        storageSyncProgressReporterRef.current?.(
          encodeWalletStorageSyncProgress(chunkProgress)
        )
        return chunk
      }
      const processSyncChunk = provider.processSyncChunk.bind(provider)
      provider.processSyncChunk = async (args, chunk) => {
        throwIfStorageOperationCancelled()
        const chunkProgress = summarizeWalletStorageSyncChunk(args, chunk)
        const recordLabel = `${chunkProgress.records.toLocaleString()} ${chunkProgress.stageName}`
        storageSyncProgressReporterRef.current?.(`Saving ${recordLabel} to the local backup...`)
        await yieldWalletStorageTask()
        throwIfStorageOperationCancelled()
        const startedAt = Date.now()
        const result = await processSyncChunk(args, chunk)
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        storageSyncProgressReporterRef.current?.(
          `Saved ${recordLabel} to the local backup in ${elapsedSeconds.toLocaleString()}s.`
        )
        throwIfStorageOperationCancelled()
        return result
      }
      storageSyncProgressReporterRef.current?.('Preparing the device database...')
      await provider.migrate(`Peacock ${chain} local storage`, binding.storageIdentityKey)
      const settings = await provider.makeAvailable()
      return { provider, storageIdentityKey: settings.storageIdentityKey }
    }

    const normalizedTarget = normalizeWalletStorageTarget(target)
    if (normalizedTarget.kind !== 'remote') throw new Error('Expected a remote storage target')
    const url = normalizedTarget.url
    let provider = new WalletBackupStorageClient(wallet, url, {
      binaryRequests: isOfficialStorageEndpoint(url),
      telemetry
    })
    const instrument = (client: WalletBackupStorageClient) => {
      client.onSyncTransferProgress = progress => {
        throwIfStorageOperationCancelled()
        storageSyncProgressReporterRef.current?.(walletStorageTransferMessage(normalizedTarget, progress))
      }
      client.checkCancelled = throwIfStorageOperationCancelled
      client.onRetry = message => storageSyncProgressReporterRef.current?.(message)
      return client
    }
    instrument(provider)
    let settings = await provider.makeAvailable()
    validateWalletStorageCapabilities(settings, chain)
    // New sync providers explicitly advertise the protocol that also supports
    // binary request bodies. Older third-party providers keep their prior mode.
    if (!isOfficialStorageEndpoint(url) &&
      (settings as typeof settings & { syncCheckpointVersion?: number }).syncCheckpointVersion === 1) {
      provider = instrument(new WalletBackupStorageClient(wallet, url, { binaryRequests: true, telemetry }))
      settings = await provider.makeAvailable()
      validateWalletStorageCapabilities(settings, chain)
    }
    const syncTotalsByPhase = new Map<string, number>()
    const getSyncChunk = provider.getBoundedSyncChunk.bind(provider)
    provider.getSyncChunk = async args => {
      throwIfStorageOperationCancelled()
      const phase = `${args.fromStorageIdentityKey}:${args.toStorageIdentityKey}:${String(args.since ?? '')}`
      const knownTotalRecords = syncTotalsByPhase.get(phase)
      ;(args as sdk.RequestSyncChunkArgs & { includeTotals?: boolean }).includeTotals = knownTotalRecords == null
      const chunk = await getSyncChunk(args, (maxRoughSize: number, reason: 'response-too-large' | 'response-timeout') => {
        storageSyncProgressReporterRef.current?.(
          reason === 'response-timeout'
            ? `The provider did not return this page before the authenticated response deadline; retrying with a smaller ${Math.ceil(maxRoughSize / 1024)} KiB page...`
            : `The provider response was too large; retrying this page at ${Math.ceil(maxRoughSize / 1024)} KiB...`
        )
      })
      throwIfStorageOperationCancelled()
      const chunkProgress = summarizeWalletStorageSyncChunk(args, chunk, knownTotalRecords)
      if (chunkProgress.totalRecords != null) syncTotalsByPhase.set(phase, chunkProgress.totalRecords)
      storageSyncProgressReporterRef.current?.(
        encodeWalletStorageSyncProgress(chunkProgress)
      )
      return chunk
    }
    return { provider, storageIdentityKey: settings.storageIdentityKey }
  }, [throwIfStorageOperationCancelled])

  const runStorageOperation = useCallback(async <T,>(
    kind: WalletStorageOperationState['kind'],
    operation: (report: (message: string) => void) => Promise<T>,
    progress?: (message: string) => void,
    automatic = false
  ): Promise<T> => {
    if (storageProfileChangingRef.current) throw new Error('Wait for the profile switch to finish before changing backups')
    if (storageOperationRef.current) {
      throw new Error('Another wallet storage operation is already running')
    }
    storageOperationRef.current = true
    let finishOperation!: () => void
    storageOperationDoneRef.current = new Promise(resolve => { finishOperation = resolve })
    storageOperationCancelRequestedRef.current = false
    const report = (message: string) => {
      const at = Date.now()
      const syncProgress = parseWalletStorageSyncProgress(message)
      setStorageOperation(previous => ({
        ...previous,
        syncProgress: syncProgress
          ? updateSyncDisplayProgress(previous.syncProgress, syncProgress, at, previous.startedAt)
          : previous.syncProgress,
        progress: [...previous.progress, { message, at }].slice(-400)
      }))
      progress?.(message)
    }
    storageSyncProgressReporterRef.current = report
    setStorageOperation({
      busy: true,
      kind,
      automatic,
      startedAt: Date.now(),
      progress: []
    })
    try {
      const result = await operation(report)
      setStorageOperation(previous => ({
        ...previous,
        busy: false,
        completedAt: Date.now()
      }))
      return result
    } catch (error: any) {
      const cancelled = error instanceof WalletStorageOperationCancelledError || (error instanceof PortabilityError && error.code === 'cancelled')
      const message = error?.message || String(error)
      setStorageOperation(previous => ({
        ...previous,
        busy: false,
        cancelled,
        cancelRequested: false,
        completedAt: Date.now(),
        providerFailure: error instanceof WalletStorageProviderError
          ? walletStorageFailureDetails(error)
          : undefined,
        error: cancelled ? undefined : message
      }))
      if (!cancelled) {
        reportDiagnosticError('wallet.storage.operation_failed', error, {
          surface: 'wallet-storage',
          context: { operation: kind }
        })
      }
      throw error
    } finally {
      storageSyncProgressReporterRef.current = undefined
      storageOperationRef.current = false
      storageOperationCancelRequestedRef.current = false
      finishOperation()
    }
  }, [])

  // Build wallet function
  const buildWallet = useCallback(async (
    primaryKey: number[],
    privilegedKeyManager: PrivilegedKeyManager
  ): Promise<any> => {
    if (storageProfileChangingRef.current) throw new Error('A wallet profile switch is already in progress')
    storageProfileChangingRef.current = true
    if (storageOperationRef.current) {
      storageOperationCancelRequestedRef.current = true
      setStorageOperation(previous => ({ ...previous, cancelRequested: true }))
      storageSyncProgressReporterRef.current?.('Switching profiles; finishing the current backup page safely...')
      await storageOperationDoneRef.current
    }
    storageConnectionWarmerRef.current?.clear()
    storageConnectionWarmerRef.current = undefined
    try {
      const newManagers = {} as any;
      const chain = selectedNetwork;
      const keyDeriver = new CachedKeyDeriver(new PrivateKey(primaryKey));
      recoverArchiveActivation(localStorage, chain, keyDeriver.identityKey)
      const scopedStorage = walletProfileStorage(localStorage, keyDeriver.identityKey)
      let storageConfig = loadProfileWalletStorageConfig(
        localStorage, chain, keyDeriver.identityKey, selectedStorageUrl || DEFAULT_STORAGE_URL, createLocalStorageIdentityKey
      )
      const saveStorageConfig = (next: NetworkWalletStorageConfig) => persistWalletStorageConfig(scopedStorage, chain, next)

      const preferredConfig = reconcileBackupPreferences(storageConfig, loadDeviceBackupPreferences(localStorage, chain))
      if (preferredConfig !== storageConfig) storageConfig = saveStorageConfig(preferredConfig)
      let storageManager = new WalletBackupStorageManager(keyDeriver.identityKey);
      const telemetry = createWalletTelemetryConfig()

      const serviceOptions = Services.createDefaultOptions(chain)
      if (ACTIVE_WALLET_ENVIRONMENT.chaintracksUrl) {
        // Arcade's Go ChainTracks endpoint does not currently allow browser
        // CORS requests. Use the staging ChainTracks facade for proof
        // validation while retaining Arcade below for TTN broadcasting.
        serviceOptions.chaintracks = new ChaintracksServiceClient(
          chain,
          ACTIVE_WALLET_ENVIRONMENT.chaintracksUrl
        )
      }
      if (ACTIVE_WALLET_ENVIRONMENT.arcadeUrl) {
        serviceOptions.arcadeUrl = ACTIVE_WALLET_ENVIRONMENT.arcadeUrl
      }
      // The packaged checkpoint and two-reference local verifier are mainnet-only.
      // TerraTestNet keeps its explicitly configured CORS-safe remote verifier.
      if (chain === 'main') {
        serviceOptions.chainTracker = await localChaintracksManager.getChainTracker(chain)
      }
      const services = new Services(serviceOptions);
      const makeLogger = () => new WalletLogger()
      const wallet = new Wallet({
        chain,
        keyDeriver,
        storage: storageManager,
        services,
        privilegedKeyManager,
        makeLogger,
        telemetry
      } as any);

      newManagers.settingsManager = wallet.settingsManager;

      newManagers.wallet = wallet
      newManagers.storageManager = storageManager

      const providerErrors = new Map<string, string>()
      storageProviderErrorsRef.current = providerErrors
      let observedLocalStorageIdentityKey: string | undefined

      // The configured primary is fail-closed: it must be reachable before the
      // wallet can write. Local-first configurations therefore continue working
      // offline, while a remote-primary outage cannot silently promote a stale
      // backup and risk two active writers.
      try {
        const primary = await createWalletStorageProvider(
          wallet,
          storageConfig.primary,
          chain,
          storageConfig.localStorageIdentityKey,
          telemetry, storageConfig.primary.kind === 'local'
        )
        if (storageConfig.primary.kind === 'local') {
          observedLocalStorageIdentityKey = primary.storageIdentityKey
        }
        await storageManager.addWalletStorageProvider(primary.provider)
        newManagers.storageConnections = new WalletStorageConnections(
          keyDeriver.identityKey, storageManager, storageConfig.primary, primary.provider,
          next => {
            storageManager = next
            wallet.storage = next
            newManagers.storageManager = next
            setManagers(current => current.wallet === wallet ? { ...current, storageManager: next } : current)
          }
        )
      } catch (error: any) {
        providerErrors.set(walletStorageTargetId(storageConfig.primary), error?.message || String(error))
        throw new Error(`Primary wallet storage is unavailable: ${error?.message || String(error)}`)
      }

      // A backup outage must not take a healthy primary offline. Unavailable
      // backups remain in durable configuration and are shown as degraded until
      // a later restart/retry can attach them.
      // Unfinished additions remain detached and resumable until explicitly completed or cancelled.
      for (const target of storageConfig.backups) {
        try {
          const backup = await createWalletStorageProvider(
            wallet,
            target,
            chain,
            storageConfig.localStorageIdentityKey,
            telemetry, target.kind === 'local'
          )
          if (target.kind === 'local') observedLocalStorageIdentityKey = backup.storageIdentityKey
          await newManagers.storageConnections.attach(target, backup.provider, storageConfig, undefined, false, storageConfig.pendingOperation?.kind === 'set-primary')
        } catch (error: any) {
          const message = error?.message || String(error)
          providerErrors.set(walletStorageTargetId(target), message)
          reportDiagnosticError('wallet.storage.backup_unavailable', error, {
            surface: 'wallet-storage',
            context: { target: walletStorageTargetId(target) }
          })
        }
      }

      // Wallet Toolbox returns its currently persisted active provider first;
      // that is not necessarily the configured primary. Resolve by target and
      // require exactly one enabled active provider after reconciliation.
      const activePrimary = findStoreForTarget(storageManager.getStores(), storageConfig.primary)
      if (!storageManager.isActiveEnabled || !activePrimary?.isActive || !activePrimary.isEnabled) {
        throw new Error('Your configured main wallet location is not active. Reconcile the existing wallet locations before making new changes.')
      }

      let reconciledConfig = storageConfig
      if (
        observedLocalStorageIdentityKey &&
        observedLocalStorageIdentityKey !== storageConfig.localStorageIdentityKey
      ) {
        reconciledConfig = saveStorageConfig({
          ...reconciledConfig,
          localStorageIdentityKey: observedLocalStorageIdentityKey
        })
      }
      if (reconciledConfig.pendingOperation?.kind === 'set-primary') {
        const recoveredOperation = reconciledConfig.pendingOperation
        reconciledConfig = saveStorageConfig(recoverPendingWalletStorageOperation(reconciledConfig))
        reportDiagnosticEvent('wallet.storage.recovered_pending_operation', {
          surface: 'wallet-storage',
          severity: 'warn',
          context: {
            operation: recoveredOperation.kind,
            operationId: recoveredOperation.id
          }
        })
      }
      refreshStorageProviders(storageManager, reconciledConfig, providerErrors)

      if (reconciledConfig.primary.kind === 'remote') {
        storageConnectionWarmerRef.current = createStorageConnectionWarmer(reconciledConfig.primary.url, {
          report: event => {
            reportDiagnosticEvent('wallet.storage.connection_warmup', {
              surface: 'wallet-performance',
              severity: event.status === 'success' ? 'info' : 'warn',
              context: event
            })
          }
        })
      }

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

      storageScopeRef.current = { identityKey: keyDeriver.identityKey, network: chain }
      setStorageConfig(reconciledConfig)
      setStorageOperation({ busy: false, progress: [] })
      setManagers(m => ({ ...m, ...newManagers }));

      return permissionsManager;
    } catch (error: any) {
      storageConnectionWarmerRef.current?.clear()
      storageConnectionWarmerRef.current = undefined
      console.error("Error building wallet:", error);
      reportDiagnosticError('wallet.build_failed', error, {
        surface: 'wallet-lifecycle',
        context: { network: selectedNetwork }
      })
      toast.error("Failed to build wallet: " + error.message);
      throw error;
    } finally {
      storageProfileChangingRef.current = false
    }
  }, [
    createWalletStorageProvider,
    refreshStorageProviders,
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


  const addBackupStorage = useCallback(async (
    target: WalletStorageTarget,
    progress?: (message: string) => void
  ): Promise<void> => runStorageOperation('add-backup', async report => {
    const normalizedTarget = normalizeWalletStorageTarget(target)
    if (backupPreferences.mode === 'device' && !deviceBackupPreferences.backups.some(target => walletStorageTargetsEqual(target, normalizedTarget))) throw new Error('Edit device defaults or choose independent profile settings before adding this location')
    // Validate before writing the recovery marker.
    addBackupTarget(storageConfig, normalizedTarget)
    const connections = managers.storageConnections
    const storageManager = connections?.manager
    const wallet = managers.wallet
    if (!storageManager || !wallet || !connections) throw new Error('Wallet storage is not ready')

    const interruptedAdd = isMatchingPendingWalletStorageOperation(
      storageConfig,
      'add-backup',
      normalizedTarget
    )
    if (storageConfig.pendingOperation && !interruptedAdd) {
      throw new Error(
        `A different wallet storage recovery operation (${storageConfig.pendingOperation.kind}) is pending; restart the wallet before changing storage`
      )
    }

    let pendingConfig = storageConfig
    report(interruptedAdd ? 'Reconnecting to resume the saved backup...' : 'Checking the backup provider before starting setup...')
    try {
      const prepared = await prepareWalletBackupSetup(storageConfig, normalizedTarget, async () => {
        const discovered = await createWalletStorageProvider(
          wallet, normalizedTarget, selectedNetwork,
          pendingConfig.localStorageIdentityKey, createWalletTelemetryConfig()
        )
        throwIfStorageOperationCancelled()
        return discovered
      }, saveStorageConfig, createStorageOperationId)
      const { attached } = prepared
      pendingConfig = prepared.pendingConfig
      throwIfStorageOperationCancelled()
      report('Checking saved checkpoints and reconciling this backup in an isolated session...')
      await connections.attach(normalizedTarget, attached.provider, pendingConfig, report, true)
      throwIfStorageOperationCancelled()
      let finalConfig = addBackupTarget(pendingConfig, normalizedTarget)
      if (normalizedTarget.kind === 'local') finalConfig.localStorageIdentityKey = attached.storageIdentityKey
      finalConfig = markWalletStorageSynced(finalConfig, [normalizedTarget])
      finalConfig = saveStorageConfig(clearPendingWalletStorageOperation(finalConfig))
      storageProviderErrorsRef.current.delete(walletStorageTargetId(normalizedTarget))
      refreshStorageProviders(connections.manager, finalConfig)
      reportDiagnosticEvent('wallet.storage.backup_added', {
        surface: 'wallet-storage',
        context: { target: walletStorageTargetId(normalizedTarget) }
      })
      report('Backup attached and synchronized.')
    } catch (error: any) {
      if (error instanceof WalletStorageOperationCancelledError) {
        refreshStorageProviders(connections.manager, pendingConfig)
        throw error
      }
      storageProviderErrorsRef.current.set(
        walletStorageTargetId(normalizedTarget),
        error?.message || String(error)
      )
      refreshStorageProviders(connections.manager, pendingConfig)
      throw error
    }
  }, progress), [
    backupPreferences.mode,
    deviceBackupPreferences,
    createWalletStorageProvider,
    managers.storageConnections,
    managers.wallet,
    refreshStorageProviders,
    runStorageOperation,
    saveStorageConfig,
    selectedNetwork,
    storageConfig,
    throwIfStorageOperationCancelled
  ])

  const syncBackupStorage = useCallback(async (
    progress?: (message: string) => void,
    options?: { automatic?: boolean }
  ): Promise<void> => runStorageOperation('sync-backups', async report => {
    const connections = managers.storageConnections
    const storageManager = connections?.manager
    const wallet = managers.wallet
    if (!storageManager || !wallet || !connections) throw new Error('Wallet storage is not ready')
    if (storageConfig.pendingOperation) {
      throw new Error('Restart the wallet to recover the interrupted storage operation before syncing')
    }
    if (storageConfig.backups.length === 0) throw new Error('No backup storage providers are configured')

    // Retry providers that were unavailable during wallet startup. This makes
    // both the manual sync button and the online/periodic retry path self-healing
    // without requiring a restart.
    for (const target of storageConfig.backups) {
      throwIfStorageOperationCancelled()
      if (findStoreForTarget(connections.manager.getStores(), target)) continue
      try {
        report(`Reconnecting ${walletStorageTargetId(target)}...`)
        const attached = await createWalletStorageProvider(
          wallet,
          target,
          selectedNetwork,
          storageConfig.localStorageIdentityKey,
          createWalletTelemetryConfig(), target.kind === 'local'
        )
        await connections.attach(target, attached.provider, storageConfig, report, true)
        storageProviderErrorsRef.current.delete(walletStorageTargetId(target))
      } catch (error: any) {
        storageProviderErrorsRef.current.set(
          walletStorageTargetId(target),
          error?.message || String(error)
        )
      }
    }

    const result = await connections.sync(storageConfig, report)
    throwIfStorageOperationCancelled()
    for (const target of result.synced) storageProviderErrorsRef.current.delete(walletStorageTargetId(target))
    for (const [id, error] of result.errors) storageProviderErrorsRef.current.set(id, error.message)
    const attachedTargets = result.synced
    const next = saveStorageConfig(markWalletStorageSynced(storageConfig, attachedTargets))
    refreshStorageProviders(connections.manager, next)
    const unavailable = storageConfig.backups.filter(target =>
      !attachedTargets.some(synced => walletStorageTargetsEqual(synced, target))
    )
    if (unavailable.length > 0) {
      throw new Error(`${unavailable.length} backup${unavailable.length === 1 ? '' : 's'} could not finish. Other available copies were saved.`)
    }
    reportDiagnosticEvent('wallet.storage.backups_synced', {
      surface: 'wallet-storage',
      context: { backupCount: attachedTargets.length }
    })
  }, progress, options?.automatic), [
    createWalletStorageProvider,
    managers.storageConnections,
    managers.wallet,
    refreshStorageProviders,
    runStorageOperation,
    saveStorageConfig,
    selectedNetwork,
    storageConfig,
    throwIfStorageOperationCancelled
  ])

  const getArchiveSource = useCallback(async (
    synchronize: boolean, progress?: (message: string) => void
  ): Promise<ArchiveSource> => runStorageOperation('portable-data', async report => {
    const scope = storageScopeRef.current, connections = managers.storageConnections, wallet = managers.wallet
    if (!scope || !connections || !wallet) throw new PortabilityError('storage')
    let config = storageConfig
    const local: WalletStorageTarget = { kind: 'local' }
    if (config.primary.kind !== 'local' && synchronize) {
      const exists = config.backups.some(target => target.kind === 'local')
      if (config.pendingOperation && !isMatchingPendingWalletStorageOperation(config, 'add-backup', local)) throw new PortabilityError('busy')
      report('Synchronizing this device copy with the main wallet location… Wallet calls may wait.')
      if (!exists && !config.pendingOperation) {
        const copy = await createWalletStorageProvider(wallet, local, scope.network, config.localStorageIdentityKey, createWalletTelemetryConfig())
        try {
          await connections.copyForExport(copy.provider, config, report)
          throwIfStorageOperationCancelled()
          config = saveStorageConfig(markWalletStorageSynced({ ...config, localStorageIdentityKey: copy.storageIdentityKey }, [local]))
        } finally { await copy.provider.destroy() }
      } else {
        let attached
        if (exists && !config.pendingOperation) {
          attached = await createWalletStorageProvider(wallet, local, scope.network, config.localStorageIdentityKey, createWalletTelemetryConfig(), true)
        } else {
          const prepared = await prepareWalletBackupSetup(config, local, async () =>
            await createWalletStorageProvider(wallet, local, scope.network, config.localStorageIdentityKey, createWalletTelemetryConfig()),
          saveStorageConfig, createStorageOperationId)
          config = prepared.pendingConfig
          attached = prepared.attached
        }
        throwIfStorageOperationCancelled()
        await connections.attach(local, attached.provider, config, report, true)
        throwIfStorageOperationCancelled()
        config = saveStorageConfig(clearPendingWalletStorageOperation(markWalletStorageSynced({
          ...(config.backups.some(target => target.kind === 'local') ? config : addBackupTarget(config, local)), localStorageIdentityKey: attached.storageIdentityKey
        }, [local])))
        refreshStorageProviders(connections.manager, config)
      }
    }
    if (config.primary.kind !== 'local' && (!config.lastSuccessfulSyncAt.local || config.pendingOperation)) throw new PortabilityError('storage')
    const binding = await resolveLocalWalletDatabase(localStorage, scope.network, scope.identityKey, config.localStorageIdentityKey, true)
    return { databaseName: binding.name, identityKey: scope.identityKey, chain: scope.network,
      lastSyncedAt: config.lastSuccessfulSyncAt.local, copiedFrom: config.primary.kind === 'remote' ? config.primary.url : 'This device (main wallet location)' }
  }, progress), [createWalletStorageProvider, managers.storageConnections, managers.wallet, refreshStorageProviders,
    runStorageOperation, saveStorageConfig, storageConfig, throwIfStorageOperationCancelled])

  const mergeWalletArchive = useCallback(async (
    id: string, progress: (message: string) => void, signal?: AbortSignal
  ): Promise<ArchiveJob> => {
    const job = await loadArchiveJob(id)
    const source = await getArchiveSource(job.state !== 'merging', progress)
    return await runStorageOperation('portable-data', async report => {
      const connections = managers.storageConnections
      if (!connections || storageScopeRef.current?.identityKey !== source.identityKey || storageScopeRef.current.network !== source.chain) throw new PortabilityError('stale')
      const manager = connections.manager
      const target = `${walletStorageTargetId(storageConfig.primary)}:${manager.getActiveStore()}`
      return await manager.runAsSync(async active => {
        throwIfStorageOperationCancelled()
        const prepared = await runPortabilityWorker<ArchiveJob>({ operation: 'merge', id, source, target }, report, signal)
        throwIfStorageOperationCancelled()
        if (signal?.aborted) throw new PortabilityError('cancelled')
        const reader = await openArchiveStorage(prepared.mergeDatabaseName!, source.chain)
        const getChunk = reader.getSyncChunk.bind(reader)
        reader.getSyncChunk = async args => {
          throwIfStorageOperationCancelled()
          if (signal?.aborted) throw new PortabilityError('cancelled')
          const chunk = await getBoundedWalletStorageUploadChunk<sdk.RequestSyncChunkArgs, sdk.SyncChunk>(applyWalletStorageUploadChunkLimits(args), getChunk, true)
          report(encodeWalletStorageSyncProgress(summarizeWalletStorageSyncChunk(args, chunk)))
          return chunk
        }
        report('Merging into the current main location… Completed pages are retained if stopped; reopen this import to resume.')
        try {
          const checkedWriter = new Proxy(active, {
            get (target, property) {
              if (property === 'processSyncChunk') return async (...args: Parameters<sdk.WalletStorageSync['processSyncChunk']>) => {
                const result = await target.processSyncChunk(...args)
                if (!result || result.error || !Number.isSafeInteger(result.inserts) || !Number.isSafeInteger(result.updates)) throw new PortabilityError('storage')
                return result
              }
              const value = Reflect.get(target, property)
              return typeof value === 'function' ? value.bind(target) : value
            }
          })
          const result = await manager.syncFromReader(source.identityKey, reader, checkedWriter)
          return await updateArchiveJob(id, { state: 'merged', inserts: result.inserts, updates: result.updates, completedAt: new Date().toISOString() })
        } finally { await reader.destroy() }
      })
    }, progress)
  }, [getArchiveSource, managers.storageConnections, runStorageOperation, storageConfig.primary, throwIfStorageOperationCancelled])

  const activateWalletArchive = useCallback(async (
    id: string, progress: (message: string) => void, signal?: AbortSignal
  ): Promise<void> => runStorageOperation('portable-data', async report => {
    const job = await loadArchiveJob(id), scope = storageScopeRef.current
    if (!job.summary || job.summary.chain !== selectedNetwork || (scope && (scope.identityKey !== job.summary.identityKey || scope.network !== job.summary.chain))) throw new PortabilityError('identity')
    const prepared = await runPortabilityWorker<ArchiveJob>({ operation: 'activate', id }, report, signal)
    throwIfStorageOperationCancelled()
    if (signal?.aborted) throw new PortabilityError('cancelled')
    const commit = async () => {
      report('Selecting the restored working copy and restarting…')
      await invoke('set_wallet_bridge_accepts_requests', { accepts: false })
      commitArchiveActivation(localStorage, prepared)
      await updateArchiveJob(id, { state: 'active', completedAt: new Date().toISOString() })
      window.location.hash = '/'
      window.location.reload()
    }
    if (managers.storageConnections) await managers.storageConnections.manager.closeForRestore(commit)
    else await commit()
  }, progress), [managers.storageConnections, runStorageOperation, selectedNetwork, throwIfStorageOperationCancelled])

  const runLocalStorageBenchmark = useCallback(async (
    progress?: (message: string) => void,
    options?: { sourceUrl?: string; maxPages?: number }
  ): Promise<WalletStorageBenchmarkResult> => runStorageOperation('local-benchmark', async report => {
    const storageManager = managers.storageManager
    if (!storageManager) throw new Error('Wallet storage is not ready')
    if (storageConfig.primary.kind !== 'remote') {
      throw new Error('The isolated benchmark requires remote storage to remain primary')
    }
    if (!storageManager.isActiveEnabled) {
      throw new Error('The configured remote primary is not active and enabled')
    }

    const chain = selectedNetwork
    let source: sdk.WalletStorageProvider | undefined
    if (options?.sourceUrl) {
      const target = normalizeWalletStorageTarget({ kind: 'remote', url: options.sourceUrl })
      if (![storageConfig.primary, ...storageConfig.backups].some(configured => walletStorageTargetsEqual(configured, target))) {
        throw new Error('Select a configured remote provider for the benchmark')
      }
      const attached = await createWalletStorageProvider(
        managers.wallet, target, chain, storageConfig.localStorageIdentityKey, createWalletTelemetryConfig()
      )
      source = attached.provider
    }
    const benchmarkId = createStorageOperationId()
    const databaseName = `wallet-toolbox-benchmark-${chain}net-${benchmarkId}`
    const writer = new StorageIdb({
      chain,
      commissionSatoshis: 0,
      commissionPubKeyHex: undefined,
      feeModel: { model: 'sat/kb', value: 1 }
    })
    writer.dbName = databaseName
    setStorageBenchmark(undefined)
    report('Starting an isolated remote-to-local benchmark. Wallet storage configuration will not be changed.')

    let benchmark: Omit<WalletStorageBenchmarkResult, 'cleanupSucceeded'> | undefined
    let cleanupSucceeded = false
    try {
      await writer.migrate('Peacock isolated local benchmark', createLocalStorageIdentityKey())
      benchmark = await runWalletStorageBenchmark({
        manager: storageManager,
        writer,
        databaseName,
        source,
        maxPages: options?.maxPages,
        report,
        throwIfCancelled: throwIfStorageOperationCancelled
      })
    } finally {
      try {
        await writer.destroy()
        await writer.dropAllData()
        cleanupSucceeded = true
        report('Removed the isolated benchmark database.')
      } catch (cleanupError) {
        reportDiagnosticError('wallet.storage.benchmark_cleanup_failed', cleanupError, {
          surface: 'wallet-storage',
          context: { databaseName }
        })
        report(`Could not remove isolated benchmark database ${databaseName}.`)
      }
    }

    if (!benchmark) throw new Error('Wallet storage benchmark did not complete')
    const result: WalletStorageBenchmarkResult = { ...benchmark, cleanupSucceeded }
    setStorageBenchmark(result)
    report(
      `${result.complete ? 'Full copy complete' : 'Partial sample complete'}: ${result.totals.records.toLocaleString()} records in ` +
      `${(result.durationMs / 1000).toFixed(1)}s ` +
      `(${result.totals.recordsPerSecond.toFixed(1)} records/s overall).`
    )
    console.info('[wallet-storage-benchmark]', result)
    return result
  }, progress), [
    managers.storageManager,
    managers.wallet,
    createWalletStorageProvider,
    runStorageOperation,
    selectedNetwork,
    storageConfig,
    throwIfStorageOperationCancelled
  ])

  const setPrimaryStorage = useCallback(async (
    target: WalletStorageTarget,
    progress?: (message: string) => void
  ): Promise<void> => runStorageOperation('set-primary', async report => {
    const normalizedTarget = normalizeWalletStorageTarget(target)
    const storageManager = managers.storageManager
    if (!storageManager) throw new Error('Wallet storage is not ready')
    if (walletStorageTargetsEqual(storageConfig.primary, normalizedTarget)) return

    // Validate target membership before recording an operation that needs recovery.
    makePrimaryTarget(storageConfig, normalizedTarget)
    const targetStore = findStoreForTarget(storageManager.getStores(), normalizedTarget)
    if (!targetStore) throw new Error('The requested primary storage provider is unavailable')

    let pendingConfig = beginWalletStorageOperation(
      { ...storageConfig, backupMode: 'profile', automaticBackups: backupPreferences.automatic },
      'set-primary',
      normalizedTarget,
      createStorageOperationId()
    )
    pendingConfig = saveStorageConfig(pendingConfig)

    report('Synchronizing all providers before changing the primary...')
    await storageManager.setActive(targetStore.storageIdentityKey, message => {
      report(message)
      return message
    })
    throwIfStorageOperationCancelled()

    let finalConfig = makePrimaryTarget(pendingConfig, normalizedTarget)
    await enforceConfiguredPrimary(storageManager, finalConfig, report)
    throwIfStorageOperationCancelled()
    finalConfig = markWalletStorageSynced(finalConfig, finalConfig.backups)
    finalConfig = saveStorageConfig(clearPendingWalletStorageOperation(finalConfig))
    refreshStorageProviders(storageManager, finalConfig)

    storageConnectionWarmerRef.current?.clear()
    storageConnectionWarmerRef.current = finalConfig.primary.kind === 'remote'
      ? createStorageConnectionWarmer(finalConfig.primary.url)
      : undefined
    reportDiagnosticEvent('wallet.storage.primary_changed', {
      surface: 'wallet-storage',
      context: { target: walletStorageTargetId(normalizedTarget) }
    })
    report('Primary storage changed successfully.')
  }, progress), [
    backupPreferences.automatic,
    managers.storageManager,
    refreshStorageProviders,
    runStorageOperation,
    saveStorageConfig,
    storageConfig,
    throwIfStorageOperationCancelled
  ])

  const removeBackupStorage = useCallback(async (
    target: WalletStorageTarget,
    progress?: (message: string) => void
  ): Promise<void> => runStorageOperation('remove-backup', async report => {
    if (backupPreferences.mode === 'device') throw new Error('Change the shared backup destinations in device defaults, or choose independent profile settings')
    const normalizedTarget = normalizeWalletStorageTarget(target)
    if (!storageConfig.backups.some(backup => walletStorageTargetsEqual(backup, normalizedTarget))) return
    const storageManager = managers.storageManager
    if (!storageManager) throw new Error('Wallet storage is not ready')
    if (storageConfig.pendingOperation) {
      throw new Error('Restart the wallet to recover the interrupted storage operation before removing a backup')
    }

    if (findStoreForTarget(storageManager.getStores(), normalizedTarget)) {
      report('Synchronizing connected backups before disconnecting...')
      try {
        await storageManager.updateBackups(undefined, message => {
          report(message)
          return message
        })
      } catch (error: any) {
        if (error instanceof WalletStorageOperationCancelledError) throw error
        // A failed backup must remain removable. This is a disconnect, not a
        // deletion: its last durable copy remains available for later recovery.
        const message = error?.message || String(error)
        report(`Final synchronization failed; disconnecting the retained backup anyway: ${message}`)
        reportDiagnosticError('wallet.storage.backup_disconnect_sync_failed', error, {
          surface: 'wallet-storage',
          context: { target: walletStorageTargetId(normalizedTarget) }
        })
      }
    }

    throwIfStorageOperationCancelled()
    const next = saveStorageConfig(removeBackupTarget(storageConfig, normalizedTarget))
    storageProviderErrorsRef.current.delete(walletStorageTargetId(normalizedTarget))
    refreshStorageProviders(storageManager, next)
    reportDiagnosticEvent('wallet.storage.backup_removed', {
      surface: 'wallet-storage',
      context: { target: walletStorageTargetId(normalizedTarget) }
    })

    // The pinned Wallet Toolbox has no provider-detach API. Reload immediately after
    // the durable config update so the removed provider cannot receive writes in
    // this session. Local IndexedDB data is retained; this is a disconnect only.
    window.location.reload()
  }, progress), [
    backupPreferences.mode,
    managers.storageManager,
    refreshStorageProviders,
    runStorageOperation,
    saveStorageConfig,
    storageConfig,
    throwIfStorageOperationCancelled
  ])

  const cancelBackupSetup = useCallback(async (): Promise<void> => runStorageOperation('cancel-setup', async report => {
    if (storageConfig.pendingOperation?.kind !== 'add-backup') throw new Error('No unfinished backup setup to cancel')
    const connections = managers.storageConnections
    if (!connections) throw new Error('Wallet storage is not ready')
    report('Checking your main wallet location. Copied backup data will be kept.')
    const installPrimary = await connections.preparePrimary(storageConfig)
    const next = saveStorageConfig(clearPendingWalletStorageOperation(storageConfig))
    installPrimary()
    storageProviderErrorsRef.current.delete(walletStorageTargetId(storageConfig.pendingOperation.target))
    refreshStorageProviders(connections.manager, next)
    report('Setup cancelled. Your main wallet is ready; any copied data remains at the backup location.')
  }), [managers.storageConnections, refreshStorageProviders, runStorageOperation, saveStorageConfig, storageConfig])

  const saveBackupPreferences = useCallback(async (mode: 'device' | 'profile', preferences: DeviceBackupPreferences): Promise<void> =>
    runStorageOperation('portable-data', async report => {
      const scope = storageScopeRef.current, connections = managers.storageConnections
      if (!scope || !connections || storageConfig.pendingOperation) throw new PortabilityError('busy')
      report('Saving backup preferences and restarting this profile…')
      await connections.manager.closeForRestore(async () => {
        if (mode === 'device') saveDeviceBackupPreferences(localStorage, scope.network, preferences)
        const next = { ...storageConfig, backupMode: mode, automaticBackups: preferences.automatic }
        saveStorageConfig(reconcileBackupPreferences(next, preferences))
        await invoke('set_wallet_bridge_accepts_requests', { accepts: false })
        window.location.reload()
      })
    }), [managers.storageConnections, runStorageOperation, saveStorageConfig, storageConfig])

  const setUpPreferredBackup = useCallback(async (): Promise<void> => {
    const missing = missingPreferredBackups(storageConfig, backupPreferences)[0]
    if (missing) await addBackupStorage(missing)
  }, [addBackupStorage, backupPreferences, storageConfig])
  const setUpPreferredBackupRef = useRef(setUpPreferredBackup)
  useEffect(() => { setUpPreferredBackupRef.current = setUpPreferredBackup }, [setUpPreferredBackup])

  const syncBackupStorageRef = useRef(syncBackupStorage)
  useEffect(() => {
    syncBackupStorageRef.current = syncBackupStorage
  }, [syncBackupStorage])

  useEffect(() => {
    const missing = missingPreferredBackups(storageConfig, backupPreferences).length > 0
    if (!managers.storageConnections || !backupPreferences.automatic || (!missing && storageConfig.backups.length === 0) || storageConfig.pendingOperation) {
      return undefined
    }
    const retry = () => {
      if (storageOperationRef.current) return
      const operation = missing ? setUpPreferredBackupRef.current() : syncBackupStorageRef.current(undefined, { automatic: true })
      void operation.catch(() => {
        // The operation already records bounded diagnostics and provider status.
      })
    }
    const initialRetry = window.setTimeout(retry, 0)
    const interval = window.setInterval(retry, 5 * 60 * 1000)
    window.addEventListener('online', retry)
    return () => {
      window.clearTimeout(initialRetry)
      window.clearInterval(interval)
      window.removeEventListener('online', retry)
    }
  }, [managers.storageConnections, storageConfig.backups.length, storageConfig.pendingOperation, backupPreferences.mode, backupPreferences.automatic, deviceBackupPreferences])


  // Load snapshot function
  const loadWalletSnapshot = useCallback(async (walletManager: SimpleWalletManager) => {
    const savedSnapshot = getWalletEnvironmentStorageItem('snap')
    if (savedSnapshot) {
      try {
        const snapArr = Utils.toArray(savedSnapshot, 'base64');
        await walletManager.loadSnapshot(snapArr);
        // We'll handle setting snapshotLoaded in a separate effect watching authenticated state
      } catch (err: any) {
        console.error("Error loading snapshot", err);
        reportDiagnosticError('wallet.snapshot_load_failed', err, {
          surface: 'wallet-lifecycle'
        })
        // Provider outages must not erase the user's saved recovery snapshot.
        toast.error("Couldn't load saved data: " + err.message);
      }
    }
  }, []);

  // Watch for wallet authentication after snapshot is loaded
  useEffect(() => {
    if (managers?.walletManager?.authenticated && getWalletEnvironmentStorageItem('snap')) {
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
        reportDiagnosticEvent('wallet.manager_initialized', {
          surface: 'wallet-lifecycle',
          context: { network: selectedNetwork }
        })

        const hydrateFromStorage = async () => {
          setWalletHydrating(true)
          setWalletStartupError(undefined)
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
            setWalletStartupError(err?.message || 'Your saved wallet could not be opened. Retry or choose another network.')
            console.error('Error hydrating wallet from storage:', err);
            reportDiagnosticError('wallet.storage_hydration_failed', err, {
              surface: 'wallet-lifecycle'
            })
          } finally {
            setWalletHydrating(false)
          }
        };

        hydrateFromStorage();
      } catch (err: any) {
        setWalletHydrating(false)
        setWalletStartupError(err?.message || 'The wallet could not be initialized.')
        console.error("Error initializing wallet manager:", err);
        reportDiagnosticError('wallet.manager_initialization_failed', err, {
          surface: 'wallet-lifecycle',
          context: { network: selectedNetwork }
        })
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

  const logout = useCallback(async () => {
    storageProfileChangingRef.current = true
    if (storageOperationRef.current) {
      storageOperationCancelRequestedRef.current = true
      await storageOperationDoneRef.current
    }
    storageScopeRef.current = undefined
    storageConnectionWarmerRef.current?.clear()
    storageConnectionWarmerRef.current = undefined
    if (managers.storageConnections) await managers.storageConnections.manager.closeForRestore(async () => {})
    const activeEnvironmentPrefix = walletEnvironmentStoragePrefix()
    const preserveLegacyMainnetUnlock = ACTIVE_WALLET_ENVIRONMENT.name !== 'mainnet'
    // Remove session keys in place. Clearing and rewriting could lose retained
    // recovery bindings or other environments if a quota/write failure occurs.
    for (const key of Object.keys(localStorage)) {
      const belongsToAnotherEnvironment = key.startsWith('peacock:') &&
        key.includes(':wallet:v1:') && !key.startsWith(activeEnvironmentPrefix)
      const isLegacyMainnetUnlock = preserveLegacyMainnetUnlock &&
        ['snap', 'primaryKeyHex', 'mnemonic12'].includes(key)
      const keep = key.startsWith('peacock.wallet-') ||
        key.startsWith(DEVICE_BACKUP_PREFERENCES_KEY) ||
        key === WALLET_ENVIRONMENT_STORAGE_KEY ||
        key.startsWith('uw_region_currency_prompted_v1:') ||
        key.startsWith('uw_first_login_done_v1:') ||
        belongsToAnotherEnvironment || isLegacyMainnetUnlock
      if (!keep) localStorage.removeItem(key)
    }
    // Reset manager state
    setManagers({});

    setSettings(DEFAULT_SETTINGS)
    setSettingsLoaded(false)

    setSnapshotLoaded(false);
    storageProfileChangingRef.current = false
  }, [managers.storageConnections]);

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
  const walletQaStateRef = useRef({
    basketRequests,
    certificateRequests,
    protocolRequests,
    spendingRequests,
    groupPermissionRequests,
    counterpartyPermissionRequests
  })
  const DEBOUNCE_TIME_MS = 5000; // 5 seconds debounce

  useEffect(() => {
    walletQaStateRef.current = {
      basketRequests,
      certificateRequests,
      protocolRequests,
      spendingRequests,
      groupPermissionRequests,
      counterpartyPermissionRequests
    }
  }, [
    basketRequests,
    certificateRequests,
    protocolRequests,
    spendingRequests,
    groupPermissionRequests,
    counterpartyPermissionRequests
  ])

  const getActivePromptSummary = useCallback((): ActivePromptSummary | null => {
    const state = walletQaStateRef.current
    const grouped = state.groupPermissionRequests[0]
    if (grouped) {
      const permissions = (grouped as any).permissions ?? {}
      const categories = [
        permissions.protocolPermissions?.length ? 'protocol' : null,
        permissions.basketAccess?.length ? 'basket' : null,
        permissions.certificateAccess?.length ? 'certificate' : null,
        permissions.spendingAuthorization ? 'spending' : null
      ].filter(Boolean) as string[]

      return {
        kind: 'group',
        originator: grouped.originator,
        categories
      }
    }

    const counterparty = state.counterpartyPermissionRequests[0]
    if (counterparty) {
      return {
        kind: 'counterparty',
        originator: counterparty.originator,
        categories: ['protocol']
      }
    }

    const protocol = state.protocolRequests[0]
    if (protocol) {
      return {
        kind: 'protocol',
        originator: protocol.originator,
        categories: ['protocol']
      }
    }

    const basket = state.basketRequests[0]
    if (basket) {
      return {
        kind: 'basket',
        originator: basket.originator,
        categories: ['basket']
      }
    }

    const certificate = state.certificateRequests[0]
    if (certificate) {
      return {
        kind: 'certificate',
        originator: certificate.originator,
        categories: ['certificate']
      }
    }

    const spending = state.spendingRequests[0]
    if (spending) {
      return {
        kind: 'spending',
        originator: spending.originator,
        categories: ['spending']
      }
    }

    return null
  }, [])

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
        const inspector: WalletBridgeInspector = {
          getPermissionBaseline: async (originator: string) => {
            const permissionsManager = permissionsManagerRef.current
            if (!permissionsManager) {
              throw new Error('Permissions manager is not ready')
            }

            const [protocols, baskets, certificates, spending] = await Promise.all([
              permissionsManager.listProtocolPermissions({ originator }),
              permissionsManager.listBasketAccess({ originator }),
              permissionsManager.listCertificateAccess({ originator }),
              permissionsManager.listSpendingAuthorizations({ originator })
            ])

            return {
              protocols: protocols.length,
              baskets: baskets.length,
              certificates: certificates.length,
              spending: spending.length
            }
          },
          getActivePromptSummary,
          warmStorageConnection: () => warmStorageConnection('create-action')
        }
        const unlisten = await onWalletReady(interceptorWallet, inspector);

        if (disposed) {
          if (unlisten) {
            unlisten();
          }
          return;
        }

        walletListenerRef.current = unlisten ?? undefined;
        reportDiagnosticEvent('wallet.bridge_listener_ready', {
          surface: 'wallet-bridge'
        })
      } catch (error) {
        console.error('Failed to initialize wallet request listener:', error);
        reportDiagnosticError('wallet.bridge_listener_failed', error, {
          surface: 'wallet-bridge'
        })
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
  }, [
    managers?.walletManager,
    managers?.walletManager?.authenticated,
    activeProfile?.id,
    getActivePromptSummary,
    onWalletReady,
    warmStorageConnection
  ])

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
        if (didRequestPromptFocusRef.current || !wasOriginallyFocusedRef.current) {
          didRequestPromptFocusRef.current = false
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
        if (didRequestPromptFocusRef.current || !wasOriginallyFocusedRef.current) {
          didRequestPromptFocusRef.current = false
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
        if (didRequestPromptFocusRef.current || !wasOriginallyFocusedRef.current) {
          didRequestPromptFocusRef.current = false
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
        if (didRequestPromptFocusRef.current || !wasOriginallyFocusedRef.current) {
          didRequestPromptFocusRef.current = false
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
        pendingGroupFocusRequestIdRef.current = null
        setGroupPermissionModalOpen(false)
        if (groupDidRequestFocusRef.current) {
          groupDidRequestFocusRef.current = false
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
        if (didRequestPromptFocusRef.current || !wasOriginallyFocusedRef.current) {
          didRequestPromptFocusRef.current = false
          onFocusRelinquished()
        }
      }
      return newQueue
    })
  }

  const walletQaActionsRef = useRef({
    permissionsManager: managers.permissionsManager,
    advanceBasketQueue,
    advanceCertificateQueue,
    advanceProtocolQueue,
    advanceSpendingQueue
  })

  useEffect(() => {
    walletQaActionsRef.current = {
      permissionsManager: managers.permissionsManager,
      advanceBasketQueue,
      advanceCertificateQueue,
      advanceProtocolQueue,
      advanceSpendingQueue
    }
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined

    let disposed = false
    let cleanup: (() => void) | undefined

    const parseDecision = (payload: unknown): WalletQaPermissionDecision | null => {
      try {
        const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
        if (
          parsed &&
          typeof parsed === 'object' &&
          ['basket', 'certificate', 'protocol', 'spending'].includes((parsed as any).kind) &&
          ['grant', 'deny'].includes((parsed as any).decision)
        ) {
          return parsed as WalletQaPermissionDecision
        }
      } catch (error) {
        console.warn('[wallet-qa] Failed to parse permission decision:', error)
      }
      return null
    }

    const dispatchPermissionChange = (
      kind: WalletQaPermissionKind,
      decision: WalletQaPermissionDecision['decision'],
      request: any
    ) => {
      const op = decision === 'grant' ? 'grant' : 'deny'
      if (kind === 'protocol') {
        window.dispatchEvent(new CustomEvent('protocol-permissions-changed', {
          detail: {
            op,
            originator: request.originator,
            protocolID: request.protocolID,
            protocolSecurityLevel: request.protocolSecurityLevel,
            counterparty: request.counterparty
          }
        }))
      } else if (kind === 'spending') {
        window.dispatchEvent(new CustomEvent('spending-authorization-changed', {
          detail: { op, originator: request.originator }
        }))
      } else if (kind === 'basket') {
        window.dispatchEvent(new CustomEvent('basket-access-changed', {
          detail: { op, originator: request.originator }
        }))
      } else if (kind === 'certificate') {
        window.dispatchEvent(new CustomEvent('cert-access-changed', {
          detail: { op, originator: request.originator }
        }))
      }
    }

    const hasActivePermissionRequest = (permissionsManager: WalletPermissionsManager, requestID: string) => {
      const activeRequests = (permissionsManager as any).activeRequests
      if (!activeRequests || typeof activeRequests.has !== 'function') return true
      return activeRequests.has(requestID)
    }

    const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

    const getRequestForKind = (kind: WalletQaPermissionKind) => {
      const state = walletQaStateRef.current
      return {
        basket: state.basketRequests[0],
        certificate: state.certificateRequests[0],
        protocol: state.protocolRequests[0],
        spending: state.spendingRequests[0]
      }[kind] as any
    }

    const waitForActiveRequest = async (
      permissionsManager: WalletPermissionsManager,
      kind: WalletQaPermissionKind
    ) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const request = getRequestForKind(kind)
        if (request?.requestID && hasActivePermissionRequest(permissionsManager, request.requestID)) {
          return request
        }
        await sleep(250)
      }
      return null
    }

    const handleDecision = async (payload: unknown) => {
      const decision = parseDecision(payload)
      if (!decision) {
        console.warn('[wallet-qa] Ignoring invalid permission decision:', payload)
        return
      }

      const actions = walletQaActionsRef.current
      const permissionsManager = actions.permissionsManager
      if (!permissionsManager) {
        console.warn('[wallet-qa] No permissions manager is ready for permission decision')
        return
      }

      const advanceByKind = {
        basket: actions.advanceBasketQueue,
        certificate: actions.advanceCertificateQueue,
        protocol: actions.advanceProtocolQueue,
        spending: actions.advanceSpendingQueue
      }

      const request = await waitForActiveRequest(permissionsManager, decision.kind)
      if (!request?.requestID) {
        console.warn(`[wallet-qa] No active ${decision.kind} permission request to ${decision.decision}`)
        return
      }

      try {
        if (decision.decision === 'grant') {
          if (decision.kind === 'spending') {
            await permissionsManager.grantPermission({
              requestID: request.requestID,
              ephemeral: false,
              amount: request.authorizationAmount
            })
          } else {
            await permissionsManager.grantPermission({ requestID: request.requestID })
          }
        } else {
          await permissionsManager.denyPermission(request.requestID)
        }

        dispatchPermissionChange(decision.kind, decision.decision, request)
      } catch (error) {
        console.error(`[wallet-qa] Failed to ${decision.decision} ${decision.kind} permission:`, error)
      } finally {
        advanceByKind[decision.kind]()
      }
    }

    listen('wallet-qa-permission-decision', event => {
      void handleDecision(event.payload)
    }).then(unlisten => {
      if (disposed) {
        unlisten()
      } else {
        cleanup = unlisten
      }
    }).catch(error => {
      console.error('[wallet-qa] Failed to listen for permission decisions:', error)
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  const registryFromWallet = useMemo(
    () => getRegistryClient(managers.walletManager, {
      adminOriginator,
      networkPreset: ACTIVE_WALLET_ENVIRONMENT.networkPreset
    }),
    [managers.walletManager, adminOriginator, selectedNetwork]
  )
  const registryFromPermissions = useMemo(
    () => getRegistryClient(managers.permissionsManager, {
      adminOriginator,
      networkPreset: ACTIVE_WALLET_ENVIRONMENT.networkPreset
    }),
    [managers.permissionsManager, adminOriginator, selectedNetwork]
  )
  const identityClient = useMemo(
    () => getIdentityClient(managers.permissionsManager, {
      adminOriginator,
      networkPreset: ACTIVE_WALLET_ENVIRONMENT.networkPreset
    }),
    [managers.permissionsManager, adminOriginator, selectedNetwork]
  )

  const contextValue = useMemo<WalletContextValue>(() => ({
    managers,
    updateManagers: setManagers,
    settings,
    updateSettings,
    network: ACTIVE_WALLET_ENVIRONMENT.networkPreset,
    environment: ACTIVE_WALLET_ENVIRONMENT,
    storageConfig,
    storageProviders,
    storageOperation,
    storageBenchmark,
    addBackupStorage,
    removeBackupStorage,
    syncBackupStorage,
    setPrimaryStorage,
    runLocalStorageBenchmark,
    cancelBackupSetup,
    cancelStorageOperation,
    deviceBackupPreferences,
    backupPreferences,
    saveBackupPreferences,
    setUpPreferredBackup,
    walletDataIdentity: storageScopeRef.current?.identityKey,
    getArchiveSource,
    mergeWalletArchive,
    activateWalletArchive,
    activeProfile: activeProfile,
    setActiveProfile: setActiveProfile,
    logout,
    adminOriginator,
    setPasswordRetriever,
    setRecoveryKeySaver,
    snapshotLoaded,
    walletHydrating,
    walletStartupError,
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
    walletHydrating,
    walletStartupError,
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
    advanceCounterpartyPermissionQueue,
    storageConfig,
    storageProviders,
    storageOperation,
    storageBenchmark,
    addBackupStorage,
    removeBackupStorage,
    syncBackupStorage,
    setPrimaryStorage,
    runLocalStorageBenchmark,
    cancelBackupSetup,
    cancelStorageOperation,
    getArchiveSource,
    mergeWalletArchive,
    activateWalletArchive,
    deviceBackupPreferences,
    backupPreferences,
    saveBackupPreferences,
    setUpPreferredBackup
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
