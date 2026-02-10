import { WalletInterface } from '@bsv/sdk';
import { SatoshiShopClient, type StartShoppingResult } from 'satoshi-shop-client';
import { Services } from '@bsv/wallet-toolbox-client';

const IN_BROWSER =
  typeof window === 'object' &&
  typeof document === 'object' &&
  typeof document.createElement === 'function';

export interface FundingModalOptions {
  title?: string;
  introText?: string;
  postPurchaseText?: string;
  cancelText?: string;
  satoshiShopUrl?: string;
  satoshiShopPubKey?: string;
  marketSatoshisPerUSD?: number;
}

interface ResolvedFundingOptions {
  title: string;
  introText: string;
  postPurchaseText: string;
  cancelText: string;
  satoshiShopUrl: string;
  satoshiShopPubKey: string;
  marketSatoshisPerUSD?: number;
}

type PurchaseHistoryStatus =
  | 'initiated'
  | 'stripe-confirmed'
  | 'stripe-processing'
  | 'waiting-for-payment'
  | 'card-payment-received'
  | 'bitcoin-payment-processed'
  | 'bitcoin-payment-acknowledged'
  | 'card-payment-failed'
  | 'unknown';

interface PurchaseHistoryEntry {
  reference: string;
  sats?: number;
  usd?: number;
  createdAt?: number;
  updatedAt?: number;
  status?: PurchaseHistoryStatus | string;
  message?: string;
  txid?: string | null;
}

const PURCHASE_HISTORY_KEY = 'bgo_satoshi_shop_purchase_history_v1';

function loadPurchaseHistory(): PurchaseHistoryEntry[] {
  if (!IN_BROWSER) return [];
  try {
    const raw = window.localStorage.getItem(PURCHASE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x === 'object' && typeof x.reference === 'string');
  } catch {
    return [];
  }
}

function savePurchaseHistory(entries: PurchaseHistoryEntry[]): void {
  if (!IN_BROWSER) return;
  try {
    window.localStorage.setItem(PURCHASE_HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

function upsertPurchaseHistory(patch: PurchaseHistoryEntry): void {
  if (!patch.reference) return;
  const now = Date.now();
  const existing = loadPurchaseHistory();
  const idx = existing.findIndex((e) => e.reference === patch.reference);
  const merged: PurchaseHistoryEntry = {
    ...(idx >= 0 ? existing[idx] : {}),
    ...patch,
    reference: patch.reference,
    updatedAt: now,
    createdAt: patch.createdAt ?? (idx >= 0 ? existing[idx].createdAt : now),
  };
  if (idx >= 0) {
    existing[idx] = merged;
  } else {
    existing.unshift(merged);
  }
  savePurchaseHistory(existing);
}

function formatDateTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

type ButtonShape = 'soft' | 'pill' | 'sharp';

interface DesignTokens {
  overlayColor: string;
  overlayBlur: string;
  cardBackground: string;
  cardBorder: string;
  cardShadow: string;
  cardRadius: string;
  fontFamily: string;
  textPrimary: string;
  textMuted: string;
  accentBackground: string;
  accentText: string;
  accentHoverBackground: string;
  accentHoverText: string;
  accentBorder: string;
  secondaryBackground: string;
  secondaryText: string;
  secondaryHoverBackground: string;
  secondaryBorder: string;
  focusRing: string;
  focusGlow: string;
  smallLabelColor: string;
  buttonShadow: string;
  buttonShape: ButtonShape;
}

const DEFAULT_FUNDING: ResolvedFundingOptions = {
  title: 'Not enough sats',
  introText: 'Top up your wallet, then click “Retry” to finish the action.',
  postPurchaseText:
    'If you have bought sats, they will arrive shortly. You can then retry your action.',
  cancelText: 'Cancel',
  satoshiShopUrl: 'https://satoshi-shop.babbage.systems',
  satoshiShopPubKey:
    'pk_live_51KT9tpEUx5UhTr4kDuPQBpP5Sy8G5Xd4rsqWTQLVsXAeQGGrKhYZt8JgGCGSgi1NHnOWbxJNfCoMVh3a8F9iCYXf00U0lbWdDC',
};

const TOKENS: DesignTokens = {
  overlayColor: 'radial-gradient(80% 120% at 15% 15%, rgba(18,38,74,0.9), rgba(2,7,18,0.95))',
  overlayBlur: 'blur(22px)',
  cardBackground: 'rgba(2,7,18,0.92)',
  cardBorder: 'rgba(114,201,255,0.32)',
  cardShadow: '0 35px 90px rgba(2,6,24,0.85)',
  cardRadius: '26px',
  fontFamily:
    '"Space Grotesk", "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  textPrimary: 'rgba(255,255,255,0.96)',
  textMuted: 'rgba(228,243,255,0.82)',
  accentBackground: 'linear-gradient(135deg, #6BE7FF, #6F7DFF)',
  accentText: '#040c1b',
  accentHoverBackground: '#f4fbff',
  accentHoverText: '#021735',
  accentBorder: 'rgba(255,255,255,0.25)',
  secondaryBackground: 'rgba(255,255,255,0.08)',
  secondaryText: 'rgba(255,255,255,0.9)',
  secondaryHoverBackground: 'rgba(255,255,255,0.16)',
  secondaryBorder: 'rgba(255,255,255,0.24)',
  focusRing: '0 0 0 2px rgba(107,231,255,0.85)',
  focusGlow: '0 0 18px rgba(107,231,255,0.45)',
  smallLabelColor: 'rgba(255,255,255,0.68)',
  buttonShadow: '0 15px 35px rgba(15,100,175,0.45)',
  buttonShape: 'pill',
};

const BUTTON_RADIUS_BY_SHAPE: Record<ButtonShape, string> = {
  soft: '14px',
  pill: '999px',
  sharp: '6px',
};

function buildDesignCss(tokens: DesignTokens): string {
  const buttonRadius = BUTTON_RADIUS_BY_SHAPE[tokens.buttonShape] ?? BUTTON_RADIUS_BY_SHAPE.soft;
  return `
.bgo-overlay {
  --bgo-font-family: ${tokens.fontFamily};
  --bgo-card-radius: ${tokens.cardRadius};
  --bgo-button-radius: ${buttonRadius};
  --bgo-overlay-bg: ${tokens.overlayColor};
  --bgo-overlay-blur: ${tokens.overlayBlur};
  --bgo-card-bg: ${tokens.cardBackground};
  --bgo-card-border: ${tokens.cardBorder};
  --bgo-card-shadow: ${tokens.cardShadow};
  --bgo-text-primary: ${tokens.textPrimary};
  --bgo-text-muted: ${tokens.textMuted};
  --bgo-accent-bg: ${tokens.accentBackground};
  --bgo-accent-text: ${tokens.accentText};
  --bgo-accent-hover-bg: ${tokens.accentHoverBackground};
  --bgo-accent-hover-text: ${tokens.accentHoverText};
  --bgo-accent-border: ${tokens.accentBorder};
  --bgo-secondary-bg: ${tokens.secondaryBackground};
  --bgo-secondary-text: ${tokens.secondaryText};
  --bgo-secondary-hover-bg: ${tokens.secondaryHoverBackground};
  --bgo-secondary-border: ${tokens.secondaryBorder};
  --bgo-focus-ring: ${tokens.focusRing};
  --bgo-focus-glow: ${tokens.focusGlow};
  --bgo-small-text: ${tokens.smallLabelColor};
  --bgo-button-shadow: ${tokens.buttonShadow};
}
.bgo-overlay {
  position: fixed;
  z-index: 2147483647;
  inset: 0;
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bgo-overlay-bg);
  backdrop-filter: var(--bgo-overlay-blur);
  opacity: 0;
  transition: opacity .25s ease;
}
.bgo-overlay.bgo-open { opacity: 1; }
.bgo-card {
  width: min(92vw, 700px);
  max-height: 88vh;
  overflow: auto;
  background: var(--bgo-card-bg);
  color: var(--bgo-text-primary);
  border-radius: var(--bgo-card-radius);
  border: 1px solid var(--bgo-card-border);
  box-shadow: var(--bgo-card-shadow);
  padding: 28px 30px 24px;
  position: relative;
  font-family: var(--bgo-font-family, system-ui, -apple-system, sans-serif);
}
.bgo-close {
  position: absolute;
  top: 18px;
  right: 22px;
  background: transparent;
  border: 0;
  color: var(--bgo-text-muted);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
  transition: color .2s ease;
}
.bgo-close:hover,
.bgo-close:focus-visible {
  color: var(--bgo-text-primary);
  outline: none;
}
.bgo-title {
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 700;
  color: var(--bgo-text-primary);
}
.bgo-body {
  font-size: 16px;
  line-height: 1.7;
  color: var(--bgo-text-muted);
}
.bgo-body p { margin: 0 0 10px; }
.bgo-actions {
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.bgo-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 11px 18px;
  border-radius: var(--bgo-button-radius);
  font-weight: 700;
  text-decoration: none;
  border: 1px solid var(--bgo-accent-border);
  color: var(--bgo-accent-text);
  background: var(--bgo-accent-bg);
  cursor: pointer;
  transition: transform .15s ease, background .2s ease, color .2s ease;
  box-shadow: var(--bgo-button-shadow);
}
.bgo-button:hover {
  transform: translateY(-1px);
  background: var(--bgo-accent-hover-bg);
  color: var(--bgo-accent-hover-text);
}
.bgo-button:focus-visible {
  outline: none;
  box-shadow: var(--bgo-focus-ring), var(--bgo-focus-glow);
}
.bgo-button.secondary {
  background: var(--bgo-secondary-bg);
  color: var(--bgo-secondary-text);
  border-color: var(--bgo-secondary-border);
  box-shadow: none;
}
.bgo-button.secondary:hover {
  background: var(--bgo-secondary-hover-bg);
  color: var(--bgo-secondary-text);
}
.bgo-small {
  margin-top: 12px;
  font-size: 13px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--bgo-small-text);
}
.bgo-help {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.28);
  background: rgba(0,0,0,0.22);
  color: rgba(255,255,255,0.86);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  position: relative;
}
.bgo-help:hover {
  border-color: rgba(107,231,255,0.55);
}
.bgo-help::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  top: -8px;
  transform: translate(-50%, -100%);
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  color: rgba(255,255,255,0.92);
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(0,0,0,0.55);
  box-shadow: 0 10px 24px rgba(0,0,0,0.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s ease;
}
.bgo-help:hover::after {
  opacity: 1;
}
.bgo-limit-note {
  margin-top: -8px;
  font-size: 12px;
  color: rgba(255,255,255,0.68);
}
.bgo-payment-panel {
  margin: 18px auto 0;
  max-width: 520px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
}
.bgo-payment-title {
  margin: 14px 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: var(--bgo-text-primary);
}
.bgo-payment-subtitle {
  margin: 0 0 10px;
  font-size: 13px;
  color: rgba(255,255,255,0.72);
}
.bgo-payment-element {
  margin-top: 12px;
}
.bgo-field-label {
  display: block;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.72);
  margin: 14px 0 8px;
}
.bgo-field-label:first-child { margin-top: 0; }
.bgo-stripe-field {
  padding: 12px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(0,0,0,0.18);
}
.bgo-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.bgo-field-row .bgo-field-label {
  margin-top: 14px;
}
.bgo-stripe-field.bgo-focus {
  box-shadow: var(--bgo-focus-ring), var(--bgo-focus-glow);
  border-color: rgba(107,231,255,0.6);
}
.bgo-history {
  margin-top: 14px;
  display: grid;
  gap: 12px;
  text-align: left;
}
.bgo-history-item {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
}
.bgo-ptx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.bgo-ptx-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--bgo-text-primary);
}
.bgo-ptx-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.bgo-button.small {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
}
.bgo-muted {
  color: rgba(255,255,255,0.72);
}
.bgo-empty {
  margin: 6px 0 0;
  padding: 14px;
  border-radius: 14px;
  border: 1px dashed rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.04);
}
.bgo-ptx-list {
  display: grid;
  gap: 10px;
}
.bgo-ptx-item {
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
}
.bgo-ptx-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.bgo-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: rgba(255,255,255,0.86);
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(0,0,0,0.20);
}
.bgo-pill.good {
  border-color: rgba(46, 213, 115, 0.35);
  background: rgba(46, 213, 115, 0.12);
}
.bgo-pill.warn {
  border-color: rgba(255, 184, 108, 0.45);
  background: rgba(255, 184, 108, 0.14);
}
.bgo-pill.bad {
  border-color: rgba(255, 107, 107, 0.45);
  background: rgba(255, 107, 107, 0.14);
}
.bgo-ptx-title {
  font-weight: 900;
  color: var(--bgo-text-primary);
}
.bgo-ptx-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
.bgo-skeleton {
  position: relative;
  overflow: hidden;
}
.bgo-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
  animation: bgo-shimmer 1.2s infinite;
}
@keyframes bgo-shimmer {
  100% { transform: translateX(100%); }
}
.bgo-history-meta {
  font-size: 12px;
  color: rgba(255,255,255,0.68);
}
.bgo-history-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
.bgo-history-label {
  font-size: 12px;
  color: rgba(255,255,255,0.68);
  margin-bottom: 3px;
}
.bgo-history-value {
  font-weight: 700;
  color: var(--bgo-text-primary);
  word-break: break-word;
}
.bgo-history-span2 {
  grid-column: 1 / -1;
}
@media (max-width: 520px) {
  .bgo-card {
    padding: 22px 20px 20px;
    border-radius: calc(var(--bgo-card-radius) - 6px);
  }
  .bgo-field-row {
    grid-template-columns: 1fr;
  }
  .bgo-history-grid {
    grid-template-columns: 1fr;
  }
  .bgo-ptx-grid {
    grid-template-columns: 1fr;
  }
  .bgo-actions {
    flex-direction: column;
  }
  .bgo-button {
    width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bgo-overlay,
  .bgo-button {
    transition: none;
  }
}
`.trim();
}

let styleElement: HTMLStyleElement | null = null;
let styleInstalled = false;

function ensureStyle() {
  if (!IN_BROWSER || styleInstalled) return;
  const cssText = buildDesignCss(TOKENS);
  styleElement = document.createElement('style');
  styleElement.textContent = cssText;
  document.head.appendChild(styleElement);
  styleInstalled = true;
}

function overlayRoot(mount?: HTMLElement | null): HTMLDivElement {
  ensureStyle();
  const root = document.createElement('div') as HTMLDivElement;
  root.className = 'bgo-overlay';
  (mount || document.body).appendChild(root);
  requestAnimationFrame(() => root.classList.add('bgo-open'));
  return root;
}

function destroyOverlay(root: HTMLElement) {
  root.classList.remove('bgo-open');
  setTimeout(() => root.remove(), 200);
}

function renderCard(
  root: HTMLElement,
  title: string,
  bodyHTML: string,
  onClose?: () => void
): { body: HTMLDivElement; actions: HTMLDivElement } {
  const card = document.createElement('div');
  card.className = 'bgo-card';
  const close = document.createElement('button');
  close.className = 'bgo-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  const h = document.createElement('h2');
  h.className = 'bgo-title';
  h.textContent = title;
  const b = document.createElement('div');
  b.className = 'bgo-body';
  b.innerHTML = bodyHTML;
  const acts = document.createElement('div');
  acts.className = 'bgo-actions';
  card.appendChild(close);
  card.appendChild(h);
  card.appendChild(b);
  card.appendChild(acts);
  root.appendChild(card);
  root.addEventListener('click', (ev) => {
    if (ev.target === root) {
      destroyOverlay(root);
      if (onClose) onClose();
    }
  });
  close.addEventListener('click', () => {
    destroyOverlay(root);
    if (onClose) onClose();
  });
  return { body: b as HTMLDivElement, actions: acts as HTMLDivElement };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function showSatoshiShopPricingInfoModal(mount?: HTMLElement | null): Promise<void> {
  if (!IN_BROWSER) return;

  await new Promise<void>((resolve) => {
    const root = overlayRoot(mount);
    const { body, actions } = renderCard(
      root,
      'Pricing & Fees',
      `
        <div class="bgo-payment-panel" style="max-width: 560px;">
          <p style="margin-top: 0;">
            Card purchases include processing and network costs. To keep the experience smooth, the quoted rate includes these fees.
          </p>
          <div class="bgo-history" style="margin-top: 14px;">
            <div class="bgo-history-item">
              <div class="bgo-history-grid" style="grid-template-columns: 1fr 1fr;">
                <div>
                  <div class="bgo-history-label">Typical card processing fees</div>
                  <div class="bgo-history-value">~$0.33 per $1</div>
                </div>
                <div>
                  <div class="bgo-history-label">Typical network transaction fees</div>
                  <div class="bgo-history-value">~$0.20 per $1</div>
                </div>
              </div>
            </div>
          </div>
          <p class="bgo-muted" style="margin-top: 12px;">
            These costs can vary. The exact number of satoshis you receive depends on the current quote and network conditions.
          </p>
          <div class="bgo-empty" style="margin-top: 12px;">
            <div style="font-weight: 800; color: rgba(255,255,255,0.86); margin-bottom: 6px;">Important notes</div>
            <div style="font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.72);">
              <div>Purchases are subject to daily/monthly limits.</div>
              <div>BSV price and exchange rates can change quickly.</div>
              <div>If delivery is delayed, you can check “Pending Transactions” and refresh.</div>
            </div>
          </div>
        </div>
      `,
      () => resolve()
    );

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bgo-button secondary';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => {
      destroyOverlay(root);
      resolve();
    };
    actions.appendChild(closeBtn);
    body.scrollTop = 0;
  });
}

export async function showSatoshiShopPurchaseHistoryModal(
  wallet: WalletInterface,
  options?: FundingModalOptions,
  mount?: HTMLElement | null
): Promise<void> {
  await showSatoshiShopPendingTransactionsModal(wallet, options, mount);
}

export async function showSatoshiShopPendingTransactionsModal(
  wallet: WalletInterface,
  options?: FundingModalOptions,
  mount?: HTMLElement | null
): Promise<void> {
  if (!IN_BROWSER) return;

  const opts = resolveFundingOptions(options);
  const shopClient = new SatoshiShopClient(wallet as any, opts.satoshiShopUrl);

  await new Promise<void>((resolve) => {
    const root = overlayRoot(mount);
    const { body, actions } = renderCard(
      root,
      'Pending Transactions',
      `
        <div class="bgo-ptx-header">
          <h3>Pending Transactions</h3>
          <div class="bgo-ptx-actions" id="ptx-actions"></div>
        </div>
        <p class="bgo-muted" style="margin: 0 0 10px;">These are Satoshi Shop transactions that have not been acknowledged by your wallet yet.</p>
        <div id="purchase-history-content"></div>
      `,
      () => resolve()
    );

    const content = body.querySelector('#purchase-history-content') as HTMLDivElement;
    const ptxActions = body.querySelector('#ptx-actions') as HTMLDivElement;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bgo-button secondary';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => {
      destroyOverlay(root);
      resolve();
    };

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'bgo-button small';
    refreshBtn.textContent = 'Refresh';

    closeBtn.className = 'bgo-button small secondary';
    ptxActions.appendChild(refreshBtn);
    ptxActions.appendChild(closeBtn);
    actions.innerHTML = '';

    const statusToPill = (status: string): { label: string; className: string } => {
      const s = status.toLowerCase();
      if (s.includes('acknowledged')) return { label: 'Acknowledged', className: 'good' };
      if (s.includes('failed')) return { label: 'Failed', className: 'bad' };
      if (s.includes('processed')) return { label: 'Processing', className: 'warn' };
      if (s.includes('pending') || s.includes('initiated')) return { label: 'Pending', className: 'warn' };
      if (s.includes('unknown')) return { label: 'Pending', className: 'warn' };
      return { label: status, className: 'warn' };
    };

    const renderLoading = () => {
      content.innerHTML = `
        <div class="bgo-ptx-list">
          ${[0, 1, 2]
            .map(
              () => `
              <div class="bgo-ptx-item bgo-skeleton">
                <div class="bgo-ptx-top">
                  <div class="bgo-ptx-title">&nbsp;</div>
                  <div class="bgo-pill warn">&nbsp;</div>
                </div>
                <div class="bgo-ptx-grid">
                  <div><div class="bgo-history-label">Reference</div><div class="bgo-history-value">&nbsp;</div></div>
                  <div><div class="bgo-history-label">Updated</div><div class="bgo-history-value">&nbsp;</div></div>
                </div>
              </div>
            `
            )
            .join('')}
        </div>
      `;
    };

    const render = (entries: PurchaseHistoryEntry[]) => {
      if (entries.length === 0) {
        content.innerHTML = '<div class="bgo-empty">No pending transactions.</div>';
        return;
      }

      const sorted = [...entries].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      content.innerHTML = `
        <div class="bgo-ptx-list">
          ${sorted
            .map((e) => {
              const satsText = typeof e.sats === 'number' ? `${e.sats.toLocaleString()} sats` : '—';
              const usdText = typeof e.usd === 'number' ? `$${e.usd.toFixed(0)}` : '—';
              const statusText = escapeHtml(String(e.status || 'unknown'));
              const refText = escapeHtml(e.reference);
              const msgText = e.message ? escapeHtml(e.message) : '';
              const txidText = e.txid ? escapeHtml(String(e.txid)) : '—';
              const pill = statusToPill(statusText);
              return `
                <div class="bgo-ptx-item">
                  <div class="bgo-ptx-top">
                    <div class="bgo-ptx-title">${satsText}</div>
                    <div class="bgo-pill ${pill.className}">${escapeHtml(pill.label)}</div>
                  </div>
                  <div class="bgo-ptx-grid">
                    <div>
                      <div class="bgo-history-label">Paid</div>
                      <div class="bgo-history-value">${usdText}</div>
                    </div>
                    <div>
                      <div class="bgo-history-label">Updated</div>
                      <div class="bgo-history-value">${formatDateTime(e.updatedAt)}</div>
                    </div>
                    <div>
                      <div class="bgo-history-label">TXID</div>
                      <div class="bgo-history-value">${txidText}</div>
                    </div>
                    <div>
                      <div class="bgo-history-label">Reference</div>
                      <div class="bgo-history-value">${refText}</div>
                    </div>
                    ${
                      msgText
                        ? `<div class="bgo-history-span2">
                            <div class="bgo-history-label">Message</div>
                            <div class="bgo-history-value">${msgText}</div>
                          </div>`
                        : ''
                    }
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    };

    const getPendingRefs = async (): Promise<string[]> => {
      const refs = new Set<string>();
      try {
        const ssr = await shopClient.startShopping({});
        for (const ref of ssr.pendingTxs || []) refs.add(ref);
      } catch {
        // ignore
      }
      try {
        const unack = await shopClient.listUnacknowledgedBuys({});
        for (const ref of unack.references || []) refs.add(ref);
      } catch {
        // ignore
      }
      return [...refs];
    };

    const refresh = async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing…';
      try {
        renderLoading();
        const pendingRefs = await getPendingRefs();
        if (pendingRefs.length === 0) {
          render([]);
          return;
        }

        for (const ref of pendingRefs) {
          upsertPurchaseHistory({ reference: ref, status: 'unknown' });
        }

        const all = loadPurchaseHistory();
        const pendingOnly = all.filter((e) => pendingRefs.includes(e.reference));
        render(pendingOnly);

        for (const entry of pendingOnly) {
          try {
            const result = await shopClient.completeBuy({ reference: entry.reference });
            upsertPurchaseHistory({
              reference: entry.reference,
              status: String(result.status || 'unknown'),
              message: result.message ? String(result.message) : undefined,
              sats: typeof entry.sats === 'number' ? entry.sats : (typeof result.satoshis === 'number' ? result.satoshis : undefined),
              txid: (result as any).txid ?? null,
            });
          } catch (e: any) {
            upsertPurchaseHistory({
              reference: entry.reference,
              status: entry.status || 'unknown',
              message: e?.message ? String(e.message) : entry.message,
            });
          }
        }
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
        const pendingRefs = await getPendingRefs();
        const all = loadPurchaseHistory();
        render(all.filter((e) => pendingRefs.includes(e.reference)));
      }
    };

    refreshBtn.onclick = () => {
      void refresh();
    };

    renderLoading();
    void refresh();
  });
}

function resolveFundingOptions(overrides?: FundingModalOptions): ResolvedFundingOptions {
  return {
    title: overrides?.title ?? DEFAULT_FUNDING.title,
    introText: overrides?.introText ?? DEFAULT_FUNDING.introText,
    postPurchaseText: overrides?.postPurchaseText ?? DEFAULT_FUNDING.postPurchaseText,
    cancelText: overrides?.cancelText ?? DEFAULT_FUNDING.cancelText,
    satoshiShopUrl: overrides?.satoshiShopUrl ?? DEFAULT_FUNDING.satoshiShopUrl,
    satoshiShopPubKey: overrides?.satoshiShopPubKey ?? DEFAULT_FUNDING.satoshiShopPubKey,
    marketSatoshisPerUSD: overrides?.marketSatoshisPerUSD,
  };
}

interface FundingModalContext {
  root: HTMLDivElement;
  desc: string;
  body: HTMLDivElement;
  content: HTMLDivElement;
  stripe: any;
  elements: any;
  setContent: (html: string) => void;
  ssr: StartShoppingResult | null;
  currentReference: string;
  needed: number;
  marketSatoshisPerUSD: number | null;
  cancelBtn: HTMLButtonElement;
  cancel: () => void;
  retry: () => void;
  delay: () => Promise<void>;
  buyOptions: Array<{ usd: number; sats: number }>;
}

export async function showSatoshiShopFundingModal(
  wallet: WalletInterface,
  satoshisNeeded: number,
  options?: FundingModalOptions,
  actionDescription?: string,
  mount?: HTMLElement | null
): Promise<'cancel' | 'retry'> {
  if (!IN_BROWSER) return 'cancel';

  const shouldAutoRetry = satoshisNeeded > 0;

  const opts = resolveFundingOptions(options);
  const shopClient = new SatoshiShopClient(wallet as any, opts.satoshiShopUrl);

  return await new Promise<'cancel' | 'retry'>((resolve) => {
    const ctx = setupContext();

    void shop();

    function setupContext(): FundingModalContext {
      const root = overlayRoot(mount);
      const cancel = () => {
        destroyOverlay(root);
        resolve('cancel');
      };
      const retry = () => {
        destroyOverlay(root);
        resolve('retry');
      };

      const desc = actionDescription
        ? `<p class="bgo-small">Action: <strong>${escapeHtml(actionDescription)}</strong></p>`
        : '';

      const { body, actions } = renderCard(
        root,
        opts.title,
        `${desc}<div id="funding-content"></div>`,
        () => {
          resolve('cancel');
        }
      );

      const content = body.querySelector('#funding-content') as HTMLDivElement;

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'bgo-button secondary';
      cancelBtn.textContent = opts.cancelText;
      cancelBtn.onclick = cancel;

      actions.appendChild(cancelBtn);

      const context: FundingModalContext = {
        root,
        cancel,
        retry,
        delay: () => new Promise((res) => setTimeout(res, 2000)),
        desc,
        body,
        content,
        cancelBtn,
        setContent: (html: string) => {
          content.innerHTML = html;
        },
        stripe: null,
        elements: null,
        ssr: null,
        currentReference: '',
        needed: satoshisNeeded,
        marketSatoshisPerUSD: null,
        buyOptions: [],
      };

      return context;
    }

    async function resolveMarketSatoshisPerUSD(): Promise<number | null> {
      if (typeof opts.marketSatoshisPerUSD === 'number' && Number.isFinite(opts.marketSatoshisPerUSD)) {
        return opts.marketSatoshisPerUSD;
      }

      try {
        const services = new Services('main');
        const usdPerBsv = await services.getBsvExchangeRate();
        const satoshisPerUSD = 100000000 / usdPerBsv;
        if (!Number.isFinite(satoshisPerUSD) || satoshisPerUSD <= 0) return null;
        return satoshisPerUSD;
      } catch (e) {
        console.warn('Unable to fetch market exchange rate for Satoshi Shop modal', e);
        return null;
      }
    }

    async function shop(): Promise<void> {
      const loadStripePromise = loadStripe();

      try {
        ctx.setContent(`<p>${opts.introText}</p><p>Contacting the Satoshi Shop…</p>`);

        ctx.ssr = await shopClient.startShopping({});

        ctx.marketSatoshisPerUSD = await resolveMarketSatoshisPerUSD();

        if (shouldAutoRetry) {
          await processPendingTxs(true);
        }

        if (ctx.needed <= 0) {
          ctx.needed = ctx.ssr?.minimumSatoshis ?? 0;
        }

        await determineBuyOptions();

        if (ctx.buyOptions.length < 1) return;

        await loadStripePromise;

        await renderAmountSelector();

        // Do not show or process purchase history in buy mode. Purchase history is
        // only shown in the dedicated Purchase History modal.
      } catch (e: any) {
        ctx.setContent(`<p style="color:#ff6b6b">An error occurred: ${escapeHtml(e.message)}</p>`);
        await ctx.delay();
        ctx.cancel();
      }
    }

    async function loadStripe(): Promise<void> {
      const setStripe = () => {
        ctx.stripe = (window as any).Stripe(opts.satoshiShopPubKey);
        ctx.elements = ctx.stripe.elements();
      };

      if ((window as any).Stripe) {
        setStripe();
        return;
      }

      await new Promise<void>((resolveLoad, reject) => {
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.onerror = () => {
          reject(new Error(`Failed to load ${script.src}`));
        };
        script.onload = () => {
          setStripe();
          resolveLoad();
        };
        document.head.appendChild(script);
      });
    }

    async function processPendingTxs(blockingUi: boolean): Promise<void> {
      if (!ctx.ssr?.pendingTxs?.length) return;

      if (blockingUi) {
        ctx.setContent('<p>Processing previous purchases…</p>');
      }

      let recovered = 0;
      for (const ref of ctx.ssr.pendingTxs) {
        try {
          const result = await shopClient.completeBuy({ reference: ref });
          upsertPurchaseHistory({
            reference: ref,
            status: String(result.status || 'unknown'),
            message: result.message ? String(result.message) : undefined,
            sats: typeof result.satoshis === 'number' ? result.satoshis : undefined,
            txid: (result as any).txid ?? null,
          });
          if (result.status === 'bitcoin-payment-acknowledged' && result.satoshis) {
            ctx.needed -= result.satoshis;
            recovered += result.satoshis;
          } else if (result.status === 'card-payment-failed') {
            // no-op (shown only in Purchase History)
          } else {
            // no-op (shown only in Purchase History)
          }
        } catch (e) {
          console.warn('Failed to complete pending purchase', ref, e);
          upsertPurchaseHistory({
            reference: ref,
            status: 'unknown',
            message: (e as any)?.message ? String((e as any).message) : undefined,
          });
        }
      }

      if (shouldAutoRetry && ctx.needed <= 0) {
        ctx.setContent(
          `${ctx.content.innerHTML}<p style="color:#4caf50">Your sats are up to date.</p>`
        );
        await ctx.delay();
        ctx.retry();
      } else if (blockingUi && recovered > 0) {
        ctx.setContent(`${ctx.content.innerHTML}<p style="color:#4caf50">Recovered ${recovered.toLocaleString()} sats from previous purchases.</p>`);
      }
    }

    async function determineBuyOptions(): Promise<void> {
      if (!ctx.ssr) return;

      const rate = ctx.ssr.satoshisPerUSD;

      const bos = [
        { usd: 1, sats: Math.round(1 * rate) },
        { usd: 2, sats: Math.round(2 * rate) },
        { usd: 5, sats: Math.round(5 * rate) },
        { usd: 10, sats: Math.round(10 * rate) },
      ].filter(
        (o) =>
          o.sats >= (ctx.ssr as StartShoppingResult).minimumSatoshis &&
          o.sats <= (ctx.ssr as StartShoppingResult).maximumSatoshis
      )

      while (bos.length > 1 && bos[0].sats < ctx.needed) bos.shift();

      ctx.buyOptions = bos;

      if (ctx.buyOptions.length === 0) {
        ctx.setContent(
          '<p>You have reached your current purchase limits.</p>' +
            '<p>Please try again tomorrow or seek other funding options.</p>'
        );
        await ctx.delay();
        ctx.cancel();
      }
    }

    async function renderAmountSelector(): Promise<void> {
      if (!ctx.ssr) return;

      // const validMillis = ctx.ssr.quoteValidUntil?.getTime() ?? Date.now();
      // const validMinutes = Math.floor((validMillis - Date.now()) / 60000);
      const shopSatoshisPerUSD = Number(ctx.ssr.satoshisPerUSD);
      const displayedShopSats = Number.isFinite(shopSatoshisPerUSD)
        ? Math.round(shopSatoshisPerUSD).toLocaleString()
        : '...';
      const marketSatoshisPerUSD = ctx.marketSatoshisPerUSD;
      const usdValuePerDollar =
        typeof marketSatoshisPerUSD === 'number' && Number.isFinite(marketSatoshisPerUSD) && marketSatoshisPerUSD > 0
          ? shopSatoshisPerUSD / marketSatoshisPerUSD
          : NaN;
      const formattedUsdValuePerDollar = Number.isFinite(usdValuePerDollar)
        ? (Math.round(usdValuePerDollar * 1000) / 1000).toFixed(3)
        : null;

      ctx.setContent(`
        <div style="text-align:center;">
          <div id="buy-options">
            <p><strong>Choose an amount (rate of $1 for ${displayedShopSats} satoshis):</strong></p>
            ${
              formattedUsdValuePerDollar
                ? `<p style="margin-top:-10px;margin-bottom:0;font-size:13px;font-style:italic;"> (~$${formattedUsdValuePerDollar} of sats per $1)
                    <button type="button" id="pricing-help" class="bgo-help" data-tooltip="Learn more" aria-label="Learn more">?</button>
                  </p>`
                : ''
            }
            <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:24px 0;">
              ${ctx.buyOptions
                .map(
                  (o) => `
                <button class="amount-btn" data-sats="${o.sats}" data-usd="${o.usd}"
                  style="padding:14px 20px;font-size:16px;border:2px solid #635BFF;background:transparent;color:#635BFF;border-radius:12px;cursor:pointer;min-width:100px;transition:all .2s;">
                  $${o.usd}
                </button>
              `
                )
                .join('')}
            </div>
            <div class="bgo-limit-note">Limit: $10/day and $35/month.</div>
          </div>

          <div id="payment-info" style="display:none;">
            <div id="purchase-details" class="bgo-payment-title">Buying xxx satoshis</div>
            <div id="purchase-value" class="bgo-payment-subtitle"></div>
            <div id="card-element" class="bgo-payment-panel">
              <div class="bgo-payment-element">
                <div class="bgo-field-label">Card number</div>
                <div id="card-number-field" class="bgo-stripe-field"><div id="card-number-element"></div></div>

                <div class="bgo-field-row">
                  <div>
                    <div class="bgo-field-label">Expiration date</div>
                    <div id="card-expiry-field" class="bgo-stripe-field"><div id="card-expiry-element"></div></div>
                  </div>
                  <div>
                    <div class="bgo-field-label">Security code</div>
                    <div id="card-cvc-field" class="bgo-stripe-field"><div id="card-cvc-element"></div></div>
                  </div>
                </div>
              </div>
              <div id="card-errors" role="alert" style="color:#ff6b6b;margin-top:12px;min-height:24px;text-align:left;"></div>
            </div>
            <div id="payment-status" style="margin-top:20px;min-height:32px;font-size:16px;"></div>
          </div>
        </div>
      `);

      ctx.content.querySelectorAll<HTMLButtonElement>('.amount-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sats = Number(btn.dataset.sats);
          const usd = Number(btn.dataset.usd);

          void clickBuyOption(sats, usd);
        });
      });

      const pricingHelp = ctx.content.querySelector('#pricing-help') as HTMLButtonElement | null;
      if (pricingHelp) {
        pricingHelp.addEventListener('click', () => {
          void showSatoshiShopPricingInfoModal();
        });
      }
    }

    async function clickBuyOption(sats: number, usd: number): Promise<void> {
      const buyOptionsDiv = ctx.content.querySelector('#buy-options') as HTMLDivElement | null;
      if (buyOptionsDiv) {
        buyOptionsDiv.style.display = 'none';
      }

      const purchaseDetails = ctx.content.querySelector('#purchase-details') as HTMLElement | null;
      if (purchaseDetails) {
        purchaseDetails.textContent = `Buying ${sats.toLocaleString()} satoshis`;
      }

      const purchaseValue = ctx.content.querySelector('#purchase-value') as HTMLElement | null;
      if (purchaseValue) {
        const marketSatoshisPerUSD = ctx.marketSatoshisPerUSD;
        const estUsdValue =
          typeof marketSatoshisPerUSD === 'number' && Number.isFinite(marketSatoshisPerUSD) && marketSatoshisPerUSD > 0
            ? sats / marketSatoshisPerUSD
            : NaN;
        const formattedEst = Number.isFinite(estUsdValue)
          ? (Math.round(estUsdValue * 1000) / 1000).toFixed(3)
          : null;
        purchaseValue.textContent = formattedEst
          ? `Estimated value: ~$${formattedEst} of sats (market rate). You pay $${usd.toFixed(0)}.`
          : `You pay $${usd.toFixed(0)}.`;
      }

      await initiatePurchase(sats, usd);
    }

    async function initiatePurchase(sats: number, usd: number): Promise<void> {
      const statusEl = ctx.content.querySelector('#payment-status') as HTMLElement;
      const cardErrorsEl = ctx.content.querySelector('#card-errors') as HTMLElement;
      statusEl.textContent = 'Preparing payment…';

      try {
        const init = await shopClient.initiateBuy({
          numberOfSatoshis: sats,
          quoteId: Number(ctx.ssr?.quoteId ?? 0),
          customerAcceptsPaymentTerms: 'I Accept',
        });

        ctx.currentReference = init.reference;
        upsertPurchaseHistory({
          reference: init.reference,
          sats,
          usd,
          createdAt: Date.now(),
          status: 'initiated',
        });

        const cardEl = ctx.content.querySelector('#card-element') as HTMLElement;
        const cardNumberMount = ctx.content.querySelector('#card-number-element') as HTMLElement;
        const cardExpiryMount = ctx.content.querySelector('#card-expiry-element') as HTMLElement;
        const cardCvcMount = ctx.content.querySelector('#card-cvc-element') as HTMLElement;
        const cardNumberField = ctx.content.querySelector('#card-number-field') as HTMLElement | null;
        const cardExpiryField = ctx.content.querySelector('#card-expiry-field') as HTMLElement | null;
        const cardCvcField = ctx.content.querySelector('#card-cvc-field') as HTMLElement | null;

        cardNumberMount.innerHTML = '';
        cardExpiryMount.innerHTML = '';
        cardCvcMount.innerHTML = '';

        cardEl.style.display = 'block';
        statusEl.textContent = 'Enter payment details above.';

        ctx.elements = ctx.stripe.elements({
          appearance: {
            theme: 'night',
            variables: {
              fontFamily: TOKENS.fontFamily,
              colorText: 'rgba(255,255,255,0.92)',
              colorDanger: '#ff6b6b',
              colorBackground: 'transparent',
              colorPrimary: '#6BE7FF',
              borderRadius: '12px',
            },
            rules: {
              '.Input': {
                backgroundColor: 'rgba(0,0,0,0.18)',
                border: '1px solid rgba(255,255,255,0.14)',
              },
              '.Input:focus': {
                border: '1px solid rgba(107,231,255,0.6)',
              },
              '.Label': {
                color: 'rgba(255,255,255,0.72)',
              },
            },
          },
        });

        const commonOptions = {
          style: {
            base: {
              color: 'rgba(255,255,255,0.92)',
              fontFamily: TOKENS.fontFamily,
              fontSize: '14px',
              '::placeholder': {
                color: 'rgba(255,255,255,0.55)',
              },
            },
            invalid: {
              color: '#ff6b6b',
            },
          },
        };

        const cardNumberElement = ctx.elements.create('cardNumber', {
          ...commonOptions,
          showIcon: true,
        });
        const cardExpiryElement = ctx.elements.create('cardExpiry', commonOptions);
        const cardCvcElement = ctx.elements.create('cardCvc', commonOptions);

        const attachFocus = (el: any, field: HTMLElement | null) => {
          if (!field) return;
          el.on('focus', () => field.classList.add('bgo-focus'));
          el.on('blur', () => field.classList.remove('bgo-focus'));
        };

        attachFocus(cardNumberElement, cardNumberField);
        attachFocus(cardExpiryElement, cardExpiryField);
        attachFocus(cardCvcElement, cardCvcField);

        cardNumberElement.mount(cardNumberMount);
        cardExpiryElement.mount(cardExpiryMount);
        cardCvcElement.mount(cardCvcMount);

        const submitBtn = document.createElement('button');

        const updateButton = () => {
          submitBtn.disabled = !isComplete;
        };

        let isComplete = false;
        let completeNumber = false;
        let completeExpiry = false;
        let completeCvc = false;
        const updateCompletion = () => {
          isComplete = completeNumber && completeExpiry && completeCvc;
          updateButton();
        };

        const onElementChange = (which: 'number' | 'expiry' | 'cvc') => (event: any) => {
          if (which === 'number') completeNumber = !!event.complete;
          if (which === 'expiry') completeExpiry = !!event.complete;
          if (which === 'cvc') completeCvc = !!event.complete;
          if (event.error) {
            cardErrorsEl.textContent = event.error.message;
          } else {
            cardErrorsEl.textContent = '';
          }
          updateCompletion();
        };

        cardNumberElement.on('change', onElementChange('number'));
        cardExpiryElement.on('change', onElementChange('expiry'));
        cardCvcElement.on('change', onElementChange('cvc'));

        const existingSubmitBtn = cardEl.querySelector('#submit-payment') as HTMLButtonElement | null;
        if (existingSubmitBtn) existingSubmitBtn.remove();

        submitBtn.id = 'submit-payment';
        submitBtn.textContent = `Pay $${usd.toFixed(0)}`;
        submitBtn.disabled = true;
        submitBtn.className = 'bgo-button';
        submitBtn.style.cssText = 'margin-top:16px;width:100%;font-size:16px;';
        cardEl.appendChild(submitBtn);

        updateButton();

        submitBtn.onclick = async () => {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Processing…';
          statusEl.textContent = 'Confirming payment…';

          let error: any;
          let paymentIntent: any;
          try {
            const result = await ctx.stripe.confirmCardPayment(init.clientSecret, {
              payment_method: {
                card: cardNumberElement,
              },
            });
            error = result?.error;
            paymentIntent = result?.paymentIntent;
          } catch (e: any) {
            error = e;
          }

          if (error) {
            cardEl.style.display = 'block';
            cardErrorsEl.textContent = error.message || 'Payment failed.';
            statusEl.textContent = '';
            submitBtn.disabled = false;
            submitBtn.textContent = `Pay $${usd.toFixed(0)}`;
            return;
          }

          const waitForSucceeded = async (): Promise<boolean> => {
            const cs = init.clientSecret;
            for (let i = 0; i < 90; i++) {
              try {
                const res = await ctx.stripe.retrievePaymentIntent(cs);
                const pi = res?.paymentIntent;
                const st = String(pi?.status || 'unknown');
                if (st === 'succeeded') return true;
                if (st === 'requires_payment_method' || st === 'canceled') {
                  cardErrorsEl.textContent = 'Payment did not complete. Please try again.';
                  return false;
                }
                statusEl.textContent = 'Waiting for payment confirmation…';
              } catch (e: any) {
                statusEl.textContent = 'Waiting for payment confirmation…';
              }
              await new Promise((res) => setTimeout(res, 2000));
            }
            cardErrorsEl.textContent = 'Payment is still processing. Please try again shortly.';
            return false;
          };

          const status = String(paymentIntent?.status || 'unknown');
          if (status !== 'succeeded') {
            upsertPurchaseHistory({ reference: init.reference, status: 'stripe-processing' });
            const ok = await waitForSucceeded();
            if (!ok) {
              statusEl.textContent = '';
              submitBtn.disabled = false;
              submitBtn.textContent = `Pay $${usd.toFixed(0)}`;
              return;
            }
          }

          upsertPurchaseHistory({ reference: init.reference, status: 'stripe-confirmed' });
          statusEl.innerHTML = '<span style="color:#4caf50;">Payment confirmed! Delivering satoshis…</span>';
          cardEl.style.display = 'none';
          await finalizePurchase(ctx.currentReference);
        };

        const paymentInfoDiv = ctx.content.querySelector('#payment-info') as HTMLDivElement | null;
        if (paymentInfoDiv) {
          paymentInfoDiv.style.display = 'block';
        }
      } catch (e: any) {
        statusEl.innerHTML = `<span style="color:#e74c3c;">Error: ${escapeHtml(e.message)}</span>`;
      }
    }

    async function finalizePurchase(reference: string): Promise<void> {
      const statusEl = ctx.content.querySelector('#payment-status') as HTMLElement;

      let attempts = 0;
      const poll = async () => {
        attempts++;
        try {
          const result = await shopClient.completeBuy({ reference });
          try {
            console.debug('[SatoshiShopFundingModal] completeBuy', { reference, result });
          } catch {
            // ignore console errors
          }

          upsertPurchaseHistory({
            reference,
            status: String(result.status || 'unknown'),
            message: result.message ? String(result.message) : undefined,
            sats: typeof result.satoshis === 'number' ? result.satoshis : undefined,
            txid: (result as any).txid ?? null,
          });

          const messageText = String(result.message || '');
          const txCreateFailure =
            /unable to create bitcoin payment transaction/i.test(messageText) ||
            /try again later/i.test(messageText);

          if (result.acknowledgeBuyResult && result.acknowledgeBuyResult.acknowledged === false) {
            statusEl.innerHTML = `<span style="color:#e74c3c;">Delivery could not be acknowledged: ${escapeHtml(
              result.acknowledgeBuyResult.message || 'Unknown error'
            )}</span>`;
            return;
          }

          if (
            result.internalizeActionResult &&
            (result.internalizeActionResult as any).accepted !== true
          ) {
            statusEl.innerHTML =
              '<span style="color:#e74c3c;">Wallet rejected delivery. Please reopen the modal to retry delivery.</span>';
            return;
          }

          if (result.status === 'card-payment-failed') {
            statusEl.innerHTML = `<span style="color:#e74c3c;">Payment failed: ${escapeHtml(
              result.message || 'Please try again.'
            )}</span>`;
            return;
          }

          if (txCreateFailure) {
            statusEl.innerHTML = `<span style="color:#e74c3c;">Payment received but delivery could not be created right now: ${escapeHtml(
              messageText || 'Try again later.'
            )} (Reference: ${escapeHtml(reference)})</span>`;
            return;
          }

          if (result.status === 'bitcoin-payment-acknowledged' && result.satoshis) {
            ctx.needed = Math.max(0, ctx.needed - result.satoshis);

            statusEl.innerHTML = `<p style="color:#4caf50;font-weight:600;">
              Success! +${result.satoshis.toLocaleString()} satoshis added
            </p>`;

            if (ctx.needed <= 0) {
              await new Promise((res) => setTimeout(res, 2000));
              destroyOverlay(ctx.root);
              resolve('retry');
            } else {
              ctx.setContent(`
                <p style="color:#4caf50;font-weight:600;">
                  Success! ${result.satoshis.toLocaleString()} satoshis added
                </p>
                <p>You now need <strong>${ctx.needed.toLocaleString()}</strong> more satoshis.</p>
              `);
              await renderAmountSelector();
            }
            return;
          }

          const msg = result.message ? ` (${escapeHtml(result.message)})` : '';
          const labelByStatus: Record<string, string> = {
            'waiting-for-payment': 'Waiting for payment confirmation…',
            'card-payment-received': 'Payment received. Preparing satoshis delivery…',
            'bitcoin-payment-processed': 'Delivering satoshis…',
            'bitcoin-payment-acknowledged': 'Finalizing…',
          };
          statusEl.textContent = `${labelByStatus[result.status] || 'Delivering satoshis…'}${msg}`;

          if (attempts > 180) {
            statusEl.innerHTML = `<span style="color:#e74c3c;">Delivery is taking longer than expected. Close this modal and try again in a minute. (Reference: ${escapeHtml(
              reference
            )})</span>`;
            return;
          }

          setTimeout(poll, 2000);
        } catch (e: any) {
          statusEl.innerHTML = `<span style="color:#e74c3c;">Delivery failed: ${escapeHtml(
            e.message || String(e)
          )}</span>`;
        }
      };

      void poll();
    }
  });
}
