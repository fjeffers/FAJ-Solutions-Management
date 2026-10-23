import { isPracticeCopy } from '@/lib/practice';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import './wf.css';

export const metadata: Metadata = {
  title: 'FAJ Business Manager',
  description: 'Contractor payment tracker for FAJ Solutions',
  manifest: '/manifest.json',
  // Fred's logo (2026-10-02: "the web app should have my logo").
  // New file names (…-v2) so browsers drop the old cached teal icons.
  icons: { icon: '/icons/faj-favicon-v2.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FAJ',
  },
};

export const viewport: Viewport = {
  themeColor: '#0E1B2E',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Cinzel:wght@500;600;700&family=Lato:wght@300;400;700&family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=Playfair+Display:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        {isPracticeCopy && (
          <div role="note" style={{ position: 'fixed', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 10000, pointerEvents: 'none', background: '#B45309', color: '#fff', font: '600 12px/1.3 Inter, Arial, sans-serif', padding: '6px 12px', borderRadius: 999, boxShadow: '0 2px 8px rgba(0,0,0,0.25)', maxWidth: '92vw', textAlign: 'center' }}>
            Test site · a copy of real FAJ data · changes here don&apos;t reach the live app
          </div>
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
          }}
        />
      </body>
    </html>
  );
}
