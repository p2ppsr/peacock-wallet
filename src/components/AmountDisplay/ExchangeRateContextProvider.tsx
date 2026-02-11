import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Services } from '@bsv/wallet-toolbox-client'
import { WalletContext } from '../../WalletContext'
import { isSupportedFiatCurrency } from '../../utils/currency'

const services = new Services('main')

const EXCHANGE_RATE_UPDATE_INTERVAL = 5 * 60 * 1000

type ExchangeRateState = {
  satoshisPerUSD: number
  eurPerUSD: number
  gbpPerUSD: number
  fiatPerUSD: Record<string, number>
  selectedFiatCurrency: string
  whenUpdated: Date | null
  isFiatPreferred: boolean
  fiatFormatIndex: number
  satsFormatIndex: number
}

type ExchangeRateContextValue = ExchangeRateState & {
  toggleIsFiatPreferred: () => void
  cycleFiatFormat: () => void
  cycleSatsFormat: () => void
}

const defaultState: ExchangeRateState = {
  satoshisPerUSD: NaN,
  eurPerUSD: 0.93, // TODO: must tie to external service
  gbpPerUSD: 0.79, // TODO: must tie to external service
  fiatPerUSD: { USD: 1, EUR: 0.93, GBP: 0.79 },
  selectedFiatCurrency: 'USD',
  whenUpdated: null,
  isFiatPreferred: false,
  fiatFormatIndex: 0,
  satsFormatIndex: 0
}

const defaultContextValue: ExchangeRateContextValue = {
  ...defaultState,
  toggleIsFiatPreferred: () => void 0,
  cycleFiatFormat: () => void 0,
  cycleSatsFormat: () => void 0
}

// Create the exchange rate context and provider to use in the amount component
export const ExchangeRateContext = createContext<ExchangeRateContextValue>(defaultContextValue)

export const ExchangeRateContextProvider: React.FC<{
  children: ReactNode
}> = ({ children }) => {
  const [state, setState] = useState<ExchangeRateState>(defaultState)
  const { settings } = useContext(WalletContext)
  const settingsCurrency = useMemo(() => (settings?.currency || '').toString().toUpperCase(), [settings?.currency])

  // The function instances are created here and included in the state to ensure they have stable references
  const contextValue: ExchangeRateContextValue = {
    ...state,
    toggleIsFiatPreferred: () => {
      setState(oldState => ({ ...oldState, isFiatPreferred: !oldState.isFiatPreferred }))
    },
    cycleFiatFormat: () => {
      setState(oldState => ({ ...oldState, fiatFormatIndex: oldState.fiatFormatIndex + 1 }))
    },
    cycleSatsFormat: () => {
      setState(oldState => ({ ...oldState, satsFormatIndex: oldState.satsFormatIndex + 1 }))
    }
  }

  useEffect(() => {
    const tick = async () => {
      try {
        const usdPerBsv = await services.getBsvExchangeRate()
        const selectedFiat = isSupportedFiatCurrency(settingsCurrency) ? settingsCurrency : 'USD'

        const fiatToFetch = Array.from(new Set(['EUR', 'GBP', selectedFiat].filter(Boolean)))
        const bulk = (services as any).getFiatExchangeRates

        let fiatPerUSD: Record<string, number> = { USD: 1 }
        if (typeof bulk === 'function') {
          const r = await bulk.call(services, fiatToFetch)
          fiatPerUSD = { ...fiatPerUSD, ...(r?.rates || {}) }
        } else {
          const pairs = await Promise.all(
            fiatToFetch.map(async c => [c, await (services as any).getFiatExchangeRate(c)] as const)
          )
          for (const [c, v] of pairs) fiatPerUSD[c] = v
        }

        const gbpPerUSD = typeof fiatPerUSD.GBP === 'number' ? fiatPerUSD.GBP : NaN
        const eurPerUSD = typeof fiatPerUSD.EUR === 'number' ? fiatPerUSD.EUR : NaN
        const satoshisPerUSD = 100000000 / usdPerBsv // satsPerBsv * bsvPerUSD => satsPerUSD
        setState(oldState => ({
          ...oldState,
          satoshisPerUSD,
          gbpPerUSD,
          eurPerUSD,
          fiatPerUSD,
          selectedFiatCurrency: selectedFiat,
          whenUpdated: new Date()
        }))
      } catch (error) {
        console.error('Error fetching data: ', error)
        // You can check for error.response.status here if using a library like axios
        // and implement specific behavior for rate limiting errors (typically 429)
      }
    }

    tick() // Invoke the function immediately to perform the initial data fetch

    const timerID = setInterval(() => tick(), EXCHANGE_RATE_UPDATE_INTERVAL)

    // This is the cleanup function to clear the interval when the component unmounts
    return () => clearInterval(timerID)
  }, [settingsCurrency]) // re-evaluate when currency preference changes

  return (
    <ExchangeRateContext.Provider value={contextValue}>
      {children}
    </ExchangeRateContext.Provider>
  )
}
