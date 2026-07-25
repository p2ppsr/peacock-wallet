import './fetchProxy'
import React from 'react'
import { createRoot } from 'react-dom/client'
import UserInterface from './UserInterface'
import { onWalletReady } from './onWalletReady'
import type { WalletBridgeInspector } from './onWalletReady'
import ErrorBoundary from './ErrorBoundary'
import { tauriFunctions } from './tauriFunctions'
import packageJson from '../package.json'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import { registerPreLoginRoutes } from './preLoginRoutes'
import { initializeDiagnostics } from './diagnostics'

// Define a theme that includes the custom structure expected by the components
const theme = createTheme({
  // Add any standard theme overrides here
  templates: {
    page_wrap: {
      // This is needed to prevent the error, define specific styles here if required
    }
  }
})

initializeDiagnostics()
const preLoginUnlistenPromise = registerPreLoginRoutes()

// Create the root and render:
const rootElement = document.getElementById('root')
if (rootElement) {
  const root = createRoot(rootElement)

  root.render(
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <ErrorBoundary>
          <UserInterface
            onWalletReady={async (wallet, inspector?: WalletBridgeInspector) => {
              try {
                const unlisten = await preLoginUnlistenPromise
                if (typeof unlisten === 'function') {
                  unlisten()
                }
              } catch (e) {
                console.warn('Failed to unlisten pre-login routes:', e)
              }
              return onWalletReady(wallet, inspector)
            }}
            nativeHandlers={tauriFunctions}
            appVersion={packageJson.version}
            appName="User Wallet"
          />
        </ErrorBoundary>
      </ThemeProvider>
    </React.StrictMode>
  )
}
