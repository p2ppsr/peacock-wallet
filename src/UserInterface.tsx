import React, { Suspense, lazy } from 'react'
import { WalletContextProvider } from './WalletContext'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import 'react-toastify/dist/ReactToastify.css'
import { BreakpointProvider } from './utils/useBreakpoints'
import { ExchangeRateContextProvider } from './components/AmountDisplay/ExchangeRateContextProvider'
const Greeter = lazy(() => import('./pages/Greeter'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
import BasketAccessHandler from './components/BasketAccessHandler'
import CertificateAccessHandler from './components/CertificateAccessHandler'
import ProtocolPermissionHandler from './components/ProtocolPermissionHandler'
import RecoveryKeyHandler from './components/RecoveryKeyHandler'
import FundingHandler from './components/FundingHandler'
import SpendingAuthorizationHandler from './components/SpendingAuthorizationHandler'
import AuthRedirector from './navigation/AuthRedirector'
import ThemedToastContainer from './components/ThemedToastContainer'
import { WalletInterface } from '@bsv/sdk'
import { AppThemeProvider } from './components/Theme'
import UpdateManager from './components/UpdateManager'
import PageLoading from './components/PageLoading'

// Define queries for responsive design
const queries = {
  xs: '(max-width: 500px)',
  sm: '(max-width: 720px)',
  md: '(max-width: 1024px)',
  or: '(orientation: portrait)'
}

// Import NativeHandlers from UserContext to avoid circular dependency
import { NativeHandlers, UserContextProvider } from './UserContext'
import GroupPermissionHandler from './components/GroupPermissionHandler'
import CounterpartyPermissionHandler from './components/CounterpartyPermissionHandler'

interface UserInterfaceProps {
  onWalletReady: (wallet: WalletInterface) => Promise<(() => void) | undefined>;
  /**
   * Native handlers that can be injected to provide platform-specific functionality.
   * Includes:
   * - isFocused: Check if the application window is focused
   * - onFocusRequested: Request focus for the application window
   * - onFocusRelinquished: Relinquish focus from the application window
   * - onDownloadFile: Download a file (works across browser, Tauri, extensions)
   */
  nativeHandlers?: NativeHandlers;
  appVersion?: string;
  appName?: string;
}

const UserInterface: React.FC<UserInterfaceProps> = ({ onWalletReady, nativeHandlers, appVersion, appName }) => {
  return (
    <UserContextProvider nativeHandlers={nativeHandlers} appVersion={appVersion} appName={appName}>
      <WalletContextProvider onWalletReady={onWalletReady}>
        <AppThemeProvider>
          <ExchangeRateContextProvider>
            <Router>
              <AuthRedirector />
              <BreakpointProvider queries={queries}>
                <RecoveryKeyHandler />
                <FundingHandler />
                <BasketAccessHandler />
                <CertificateAccessHandler />
                <ProtocolPermissionHandler />
                <SpendingAuthorizationHandler />
                <ThemedToastContainer />
                <GroupPermissionHandler />
                <CounterpartyPermissionHandler />
                <UpdateManager checkOnMount={true} interval={3600000} />
                <Suspense fallback={<PageLoading />}>
                  <Routes>
                    <Route path='/' element={<Greeter />} />
                    <Route path='/dashboard/*' element={<Dashboard />} />
                  </Routes>
                </Suspense>
              </BreakpointProvider>
            </Router>
          </ExchangeRateContextProvider>
        </AppThemeProvider>
      </WalletContextProvider>
    </UserContextProvider>
  )
}

export default UserInterface
