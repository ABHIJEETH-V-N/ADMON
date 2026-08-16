import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Web3Provider } from '../src/components/Web3Provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'ADmod — On-Chain RTB Exchange',
  description: 'Real-Time Bidding ad exchange on Monad Testnet',
  icons: {
    icon: '/icon.svg',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Web3Provider>
          {children}
        </Web3Provider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
