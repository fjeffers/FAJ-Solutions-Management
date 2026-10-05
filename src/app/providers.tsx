'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

/**
 * Client providers for the App Router. Design tokens live entirely in
 * app/globals.css (single file, Tailwind v4). Dark mode is a `.dark` class on
 * <html> set pre-paint by the inline script in layout.tsx — no theme provider,
 * no competing style layer.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <Toaster />
        <div className="flex w-full flex-1 flex-col min-h-0">{children}</div>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
