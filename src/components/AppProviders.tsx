'use client'

import {useState} from 'react'
import {WagmiProvider} from 'wagmi'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {wagmiConfig} from '@/config/wagmi'

/**
 * Client providers.
 *
 * `staleTime` is generous because Arc settles sub-second but token metadata does not change:
 * re-reading a registry entry on every focus would hammer a public RPC for nothing. Spin
 * state uses its own short interval where it matters.
 */
export function AppProviders({children}: {children: React.ReactNode}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
