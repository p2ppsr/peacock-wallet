const localeDefault = Intl.NumberFormat().resolvedOptions().locale?.split('-u-')[0] || 'en-US'
const groupDefault = Intl.NumberFormat(localeDefault).formatToParts(10234.56).filter(p => p.type === 'group')[0].value
const decimalDefault = Intl.NumberFormat(localeDefault).formatToParts(1234.56).filter(p => p.type === 'decimal')[0].value

export const satoshisOptions = {
  fiatFormats: [
    {
      name: 'USD',
      // value suitable as first arg for Intl.NumberFormat or null for default locale
      locale: 'en-US',
      // value suitable as currency property of second arg for Intl.NumberFormat
      currency: 'USD'
    },
    {
      name: 'USD_locale',
      locale: null,
      currency: 'USD'
    },
    {
      name: 'EUR',
      locale: null,
      currency: 'EUR'
    },
    {
      name: 'GBP',
      locale: null,
      currency: 'GBP'
    },
    {
      name: 'JPY',
      locale: null,
      currency: 'JPY'
    },
    {
      name: 'CNY',
      locale: null,
      currency: 'CNY'
    },
    {
      name: 'INR',
      locale: null,
      currency: 'INR'
    },
    {
      name: 'AUD',
      locale: null,
      currency: 'AUD'
    },
    {
      name: 'CAD',
      locale: null,
      currency: 'CAD'
    },
    {
      name: 'CHF',
      locale: null,
      currency: 'CHF'
    },
    {
      name: 'HKD',
      locale: null,
      currency: 'HKD'
    },
    {
      name: 'SGD',
      locale: null,
      currency: 'SGD'
    },
    {
      name: 'NZD',
      locale: null,
      currency: 'NZD'
    },
    {
      name: 'SEK',
      locale: null,
      currency: 'SEK'
    },
    {
      name: 'NOK',
      locale: null,
      currency: 'NOK'
    },
    {
      name: 'MXN',
      locale: null,
      currency: 'MXN'
    }
  ],
  satsFormats: [
    {
      // Format name for settings choice lookup
      name: 'SATS',
      // One of: 'SATS', 'BSV', 'mBSV'
      // 100,000,000 SATS === 1000 mBSV === 1 BSV
      unit: 'SATS',
      // string to insert between integer and fraction parts, null for locale default
      decimal: null,
      // string to insert every three digits from decimal, null for locale default
      group: null,
      // full unit label
      label: 'satoshis',
      // abbreviated unit label
      abbrev: 'sats'
    },
    {
      name: 'SATS_Tone',
      unit: 'SATS',
      decimal: '.',
      group: '_',
      label: 'satoshis',
      abbrev: 'sats'
    },
    {
      name: 'mBSV',
      unit: 'mBSV',
      decimal: null,
      group: null,
      label: 'mBSV',
      abbrev: ''
    },
    {
      name: 'mBSV_Tone',
      unit: 'mBSV',
      decimal: '.',
      group: '_',
      label: 'mBSV',
      abbrev: ''
    },
    {
      name: 'BSV',
      unit: 'BSV',
      decimal: null,
      group: null,
      label: 'BSV',
      abbrev: ''
    },
    {
      name: 'BSV_Tone',
      unit: 'BSV',
      decimal: '.',
      group: '_',
      label: 'BSV',
      abbrev: ''
    }
  ],
  isFiatPreferred: false // If true, fiat format is preferred, else satsFormat
}

type FiatFormatOption = (typeof satoshisOptions.fiatFormats)[number] | null
type SatsFormatOption = (typeof satoshisOptions.satsFormats)[number] | null

export const formatSatoshisAsFiat = (
  satoshis: number = NaN,
  satoshisPerUSD: number | null = null,
  format: FiatFormatOption = null,
  settingsCurrency: string = 'SATS',
  fiatPerUSD: Record<string, number> = { USD: 1 },
  showFiatAsInteger = false
): string => {
  if (settingsCurrency) {
    // See if requested currency matches a known fiat format, if not use 'USD'
    let fiatFormat = satoshisOptions.fiatFormats.find(f => f.name === settingsCurrency)
    if (!fiatFormat) fiatFormat = satoshisOptions.fiatFormats.find(f => f.name === 'USD')
    format = fiatFormat
  }
  format ??= satoshisOptions.fiatFormats[0]
  const locale = format.locale ?? localeDefault

  const usd = (satoshisPerUSD && Number.isInteger(Number(satoshis))) ? satoshis / satoshisPerUSD : NaN

  if (isNaN(usd)) return '...'

  let minDigits = 2
  let maxDigits
  const v = Math.abs(usd)
  if (v < 0.001) minDigits = 6
  else if (v < 0.01) minDigits = 5
  else if (v < 0.1) minDigits = 4
  else if (v < 1) minDigits = 3

  if (showFiatAsInteger) {
    minDigits = 0
    maxDigits = 0
  }

  const requested = (settingsCurrency || '').toUpperCase()
  const formatCurrency = (format?.currency || 'USD').toUpperCase()
  const targetCurrency = typeof fiatPerUSD[requested] === 'number' || requested === 'USD' ? requested : formatCurrency
  const rate = targetCurrency === 'USD' ? 1 : fiatPerUSD[targetCurrency]
  const value = typeof rate === 'number' ? usd * rate : usd
  if (isNaN(value)) return '...'
  const fmt = new Intl.NumberFormat(locale, {
    currency: targetCurrency,
    style: 'currency',
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits
  })
  return fmt.format(value)
}
export const formatSatoshis = (
  satoshis: number | string,
  showPlus = false,
  abbreviate = false,
  format: SatsFormatOption = null,
  settingsCurrency: string = 'SATS'
) => {
  if (settingsCurrency) {
    // See if requested currency matches a known satoshis format, if not use 'SATS'
    let satsFormat = satoshisOptions.satsFormats.find(f => f.name === settingsCurrency)
    if (!satsFormat) satsFormat = satoshisOptions.satsFormats.find(f => f.name === 'SATS')
    format = satsFormat
  }
  const resolvedFormat = (format ?? satoshisOptions.satsFormats[0]) as NonNullable<SatsFormatOption>
  let s: any = (Number.isInteger(Number(satoshis))) ? Number(satoshis) : null
  if (s === null) { return '---' }
  const sign = s < 0 ? '-' : showPlus ? '+' : ''
  s = Math.abs(s).toFixed(0)
  // There are at most 21 some odd million hundred million satoshis.
  // We format this with the following separators.
  // Note that the decimal only appears after a hundred million satoshis.
  // 21_000_000.000_000_00
  const g = resolvedFormat.group ?? groupDefault
  const d = resolvedFormat.decimal ?? decimalDefault
  let p: Array<[number, string]>
  let sMinLen: number
  switch (resolvedFormat.unit) {
    case 'BSV': sMinLen = 9; p = [[2, g], [3, g], [3, d], [3, g], [3, g]]; break
    case 'mBSV': sMinLen = 6; p = [[2, g], [3, d], [3, g], [3, g], [3, g]]; break
    default:
      sMinLen = 0; p = [[3, g], [3, g], [3, g], [3, g], [3, g]]; break
  }
  let r = ''
  while (s.length < sMinLen) s = '0' + s
  while (s.length > 0) {
    if (p.length === 0) {
      r = s + r
      s = ''
    } else {
      const q = p.shift()!
      r = s.substring(s.length - q[0]) + r
      if (s.length > q[0]) {
        r = q[1] + r
        s = s.substring(0, s.length - q[0])
      } else {
        s = ''
      }
    }
  }
  r = `${sign}${r}`
  const label = abbreviate ? resolvedFormat.abbrev : resolvedFormat.label
  if (label && label.length > 0) { r = `${r} ${label}` }
  return r
}
