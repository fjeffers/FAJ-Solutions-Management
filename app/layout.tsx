import type { Metadata, Viewport } from 'next';
import './globals.css';
import './wf.css';

export const metadata: Metadata = {
  title: 'FAJ Business Manager',
  description: 'Contractor payment tracker for FAJ Solutions',
  manifest: '/manifest.json',
  // Fred's logo (2026-10-02: "the web app should have my logo").
  icons: { icon: '/icons/favicon-64.png', apple: '/icons/apple-touch-icon.png' },
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
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
          }}
        />
      </body>
    </html>
  );
}
