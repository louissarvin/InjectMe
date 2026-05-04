import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
} from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'

import HeroUIProvider from '../providers/HeroUIProvider'
import LenisSmoothScrollProvider from '../providers/LenisSmoothScrollProvider'
import WagmiProvider from '../providers/WagmiProvider'
import { AuthProvider } from '../providers/AuthProvider'
import { ThemeProvider, useTheme } from '../providers/ThemeProvider'
import {
  FarcasterProvider,
  useFarcasterContext,
} from '../providers/FarcasterProvider'
import ErrorPage from '../components/ErrorPage'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

const ACCENT = '#AF69EE'

const rbkDark = darkTheme({
  accentColor: ACCENT,
  accentColorForeground: 'white',
  borderRadius: 'large',
})
const rbkLight = lightTheme({
  accentColor: ACCENT,
  accentColorForeground: 'white',
  borderRadius: 'large',
})

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  errorComponent: ({ error, reset }) => (
    <ErrorPage error={error} reset={reset} />
  ),
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'InjectMe - AI Adversarial Testing Arena',
      },
      {
        name: 'description',
        content:
          'Break the AI. Win the prize. InjectMe is an adversarial AI red-teaming arena built on 0G Chain.',
      },
      {
        property: 'og:title',
        content: 'InjectMe - AI Adversarial Testing Arena',
      },
      {
        property: 'og:description',
        content:
          'Break the AI. Win the prize. InjectMe is an adversarial AI red-teaming arena built on 0G Chain.',
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        httpEquiv: 'X-Frame-Options',
        content: 'DENY',
      },
      {
        httpEquiv: 'X-Content-Type-Options',
        content: 'nosniff',
      },
      {
        name: 'referrer',
        content: 'strict-origin-when-cross-origin',
      },
    ],
    links: [
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/assets/logo-index.svg',
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function AppShell({ children }: { children: React.ReactNode }) {
  const { isInMiniApp } = useFarcasterContext()

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#FDFDFF] dark:bg-[#0A0B0D] relative z-10 rounded-b-[2.5rem] pt-16">
        {children}
      </main>
      {!isInMiniApp && <Footer />}
    </>
  )
}

function ThemedRainbowKitProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <RainbowKitProvider theme={theme === 'dark' ? rbkDark : rbkLight}>
      {children}
    </RainbowKitProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-[#FDFDFF] dark:bg-[#0A0B0D] text-[#0A0B0D] dark:text-[#E5E7EB] antialiased">
        <ThemeProvider>
          <WagmiProvider>
            <ThemedRainbowKitProvider>
              <FarcasterProvider>
                <AuthProvider>
                  <HeroUIProvider>
                    <LenisSmoothScrollProvider />
                    <AppShell>{children}</AppShell>
                    <TanStackDevtools
                      config={{
                        position: 'bottom-right',
                      }}
                      plugins={[
                        {
                          name: 'Tanstack Router',
                          render: <TanStackRouterDevtoolsPanel />,
                        },
                        TanStackQueryDevtools,
                      ]}
                    />
                  </HeroUIProvider>
                </AuthProvider>
              </FarcasterProvider>
            </ThemedRainbowKitProvider>
          </WagmiProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
