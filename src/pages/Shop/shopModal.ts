import { RampInstantSDK } from '@ramp-network/ramp-instant-sdk';
import { WalletInterface } from '@bsv/sdk';

const USE_RAMP_DEMO = true;
const RAMP_HOST_API_KEY = ''; // TODO: ADD API KEY HERE!
const RAMP_DEMO_URL = 'https://app.demo.rampnetwork.com';

export interface RampModalOptions {
  hostAppName?: string;
  hostLogoUrl?: string;
  hostApiKey?: string;
  userAddress?: string;
  demo?: boolean;
}

function watchForWidgetRemoval(onGone: () => void): () => void {
  let interval: ReturnType<typeof setInterval> | null = null;
  let widgetSeen = false;
  const timeout = setTimeout(() => {
    interval = setInterval(() => {
      const overlay =
        document.querySelector('iframe[src*="ramp"]') ||
        document.querySelector('[class*="ramp"]') ||
        document.querySelector('iframe[title*="Ramp"]');
      if (overlay) {
        widgetSeen = true;
      } else if (widgetSeen) {
        if (interval) clearInterval(interval);
        onGone();
      }
    }, 500);
  }, 1500);
  return () => {
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  };
}

function resolveRampConfig(options?: RampModalOptions) {
  const isDemo = options?.demo ?? USE_RAMP_DEMO;
  const apiKey = options?.hostApiKey || RAMP_HOST_API_KEY;
  return {
    hostAppName: options?.hostAppName ?? 'BSV Wallet',
    hostLogoUrl: options?.hostLogoUrl ?? '',
    hostApiKey: apiKey || 'unavailable',
    ...(isDemo ? { url: RAMP_DEMO_URL } : {}),
  };
}

export function showRampBuyModal(
  _wallet: WalletInterface,
  options?: RampModalOptions,
): Promise<'purchased' | 'closed'> {
  return new Promise((resolve) => {
    let didPurchase = false;
    let resolved = false;
    const safeResolve = (val: 'purchased' | 'closed') => {
      if (resolved) return;
      resolved = true;
      stopWatching();
      resolve(val);
    };

    const ramp = new RampInstantSDK({
      ...resolveRampConfig(options),
      swapAsset: 'BSV_BSV',
      userAddress: options?.userAddress ?? '',
      variant: 'auto',
    });

    ramp
      .on('*', (event) => {
        if (event.type === 'PURCHASE_CREATED') {
          didPurchase = true;
          console.log('[Ramp] Purchase created', event);
        }
        if (event.type === 'WIDGET_CLOSE') {
          safeResolve(didPurchase ? 'purchased' : 'closed');
        }
      })
      .show();

    const stopWatching = watchForWidgetRemoval(() => {
      safeResolve(didPurchase ? 'purchased' : 'closed');
    });
  });
}

export function showRampSellModal(
  _wallet: WalletInterface,
  options?: RampModalOptions,
): Promise<'closed'> {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = () => {
      if (resolved) return;
      resolved = true;
      stopWatching();
      resolve('closed');
    };

    const ramp = new RampInstantSDK({
      ...resolveRampConfig(options),
      offrampAsset: 'BSV_BSV',
      userAddress: options?.userAddress ?? '',
      variant: 'auto',
    } as any);

    ramp
      .on('*', (event) => {
        if (event.type === 'WIDGET_CLOSE') {
          safeResolve();
        }
      })
      .show();

    // Fallback: detect widget removal from DOM (e.g. "Continue to Ramp Network")
    const stopWatching = watchForWidgetRemoval(() => {
      safeResolve();
    });
  });
}

export async function showFundingModal(
  wallet: WalletInterface,
  _satoshisNeeded: number,
  options?: RampModalOptions,
): Promise<'cancel' | 'retry'> {
  const result = await showRampBuyModal(wallet, options);
  return result === 'purchased' ? 'retry' : 'cancel';
}

export interface FundingModalOptions {
  title?: string;
  introText?: string;
  postPurchaseText?: string;
  cancelText?: string;
  satoshiShopUrl?: string;
  satoshiShopPubKey?: string;
  marketSatoshisPerUSD?: number;
}

export async function showSatoshiShopFundingModal(
  wallet: WalletInterface,
  satoshisNeeded: number,
  _options?: FundingModalOptions,
  _actionDescription?: string,
  _mount?: HTMLElement | null,
): Promise<'cancel' | 'retry'> {
  return showFundingModal(wallet, satoshisNeeded);
}

export async function showSatoshiShopPendingTransactionsModal(
  wallet: WalletInterface,
  _options?: FundingModalOptions,
  _mount?: HTMLElement | null,
): Promise<void> {
  await showRampBuyModal(wallet);
}

export async function showSatoshiShopPurchaseHistoryModal(
  wallet: WalletInterface,
  options?: FundingModalOptions,
  mount?: HTMLElement | null,
): Promise<void> {
  await showSatoshiShopPendingTransactionsModal(wallet, options, mount);
}
