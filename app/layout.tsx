import { isPracticeCopy, isPreviewCopy, LIVE_APP_URL } from '@/lib/practice';
import PracticeGate from '@/components/PracticeGate';
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
        {/* The test site opens on a full screen that sends people to the real app (components/PracticeGate.tsx). */}
        {isPracticeCopy && <PracticeGate />}
        {isPreviewCopy && (
          <div role="note" style={{ background: '#B45309', color: '#fff', font: '600 11.5px/1.3 Inter, Arial, sans-serif', padding: '4px 10px', textAlign: 'center' }}>
            Preview copy · real FAJ data, but emails don&apos;t send from here ·{' '}
            <a href={LIVE_APP_URL} style={{ color: '#fff', textDecoration: 'underline' }}>Open app.fajsolutions.com</a>
          </div>
        )}
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
          }}
        />
      </body>
    </html>
  );
}
