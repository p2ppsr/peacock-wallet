import { MessageBoxClient } from '@bsv/message-box-client';
import {
  IdentityClient,
  LookupResolver,
  RegistryClient,
  WalletInterface,
  type LookupNetworkPreset,
} from '@bsv/sdk';
import type { WalletPermissionsManager } from '@bsv/wallet-toolbox-client';

type RegistrySource =
  | WalletPermissionsManager
  | WalletInterface;

type OverlayClientConfig = {
  networkPreset: LookupNetworkPreset;
  adminOriginator?: string;
};

const registryClientCache = new WeakMap<object, Map<string, RegistryClient>>();
const identityClientCache = new WeakMap<
  WalletPermissionsManager,
  Map<string, IdentityClient>
>();
const messageBoxClientCache = new WeakMap<
  WalletPermissionsManager,
  Map<string, MessageBoxClient>
>();
const lookupResolverCache = new Map<string, LookupResolver>();

export const getRegistryClient = (
  source: RegistrySource | null | undefined,
  config: OverlayClientConfig
): RegistryClient | null => {
  if (!source) return null;
  const cacheKey = `${config.networkPreset}|${config.adminOriginator ?? ''}`;

  let bucket = registryClientCache.get(source);
  if (!bucket) {
    bucket = new Map();
    registryClientCache.set(source, bucket);
  }

  let client = bucket.get(cacheKey);
  if (!client) {
    client = new RegistryClient(
      source,
      { networkPreset: config.networkPreset },
      config.adminOriginator
    );
    bucket.set(cacheKey, client);
  }
  return client;
};

export const getIdentityClient = (
  manager: WalletPermissionsManager | null | undefined,
  config: OverlayClientConfig
): IdentityClient | null => {
  if (!manager) return null;
  const cacheKey = `${config.networkPreset}|${config.adminOriginator ?? ''}`;

  let bucket = identityClientCache.get(manager);
  if (!bucket) {
    bucket = new Map();
    identityClientCache.set(manager, bucket);
  }

  let client = bucket.get(cacheKey);
  if (!client) {
    client = new IdentityClient(
      manager,
      { networkPreset: config.networkPreset },
      config.adminOriginator
    );
    bucket.set(cacheKey, client);
  }
  return client;
};

type MessageBoxConfig = {
  walletClient?: WalletPermissionsManager | null;
  host: string;
  originator?: string;
  enableLogging?: boolean;
  networkPreset: LookupNetworkPreset;
};

type LookupResolverConfig = {
  networkPreset: LookupNetworkPreset;
}

export const getMessageBoxClient = ({
  walletClient,
  host,
  originator,
  enableLogging = false,
  networkPreset,
}: MessageBoxConfig): MessageBoxClient | null => {
  if (!walletClient) return null;
  const cacheKey = `${networkPreset}|${host}|${originator ?? ''}|${enableLogging ? '1' : '0'}`;

  let bucket = messageBoxClientCache.get(walletClient);
  if (!bucket) {
    bucket = new Map();
    messageBoxClientCache.set(walletClient, bucket);
  }

  let client = bucket.get(cacheKey);
  if (!client) {
    client = new MessageBoxClient({
      walletClient,
      host,
      originator,
      enableLogging,
      networkPreset,
    });
    bucket.set(cacheKey, client);
  }
  return client;
};

export const getLookupResolver = async ({
  networkPreset
}: LookupResolverConfig): Promise<LookupResolver | null> => {
  const cacheKey = networkPreset;

  let resolver = lookupResolverCache.get(cacheKey);
  if (!resolver) {
    resolver = new LookupResolver({
      networkPreset
    });
    lookupResolverCache.set(cacheKey, resolver);
  }

  return resolver;
}
