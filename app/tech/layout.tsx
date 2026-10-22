import type { Metadata, Viewport } from 'next';
import './fs.css';
import UpdateBar from '@/components/UpdateBar';

// The tech portal installs as its OWN app, separate from the owner's.
// Without this the root layout's manifest wins and a tech who taps "Add to
// Home Screen" gets a "FAJ Business Manager" icon that opens the owner app's
// login — which is not their app and which they cannot sign into.
export const metadata: Metadata = {
  title: 'FAJ Tech Portal',
  description: 'Your jobs, your schedule, your messages — FAJ Solutions',
  manifest: '/tech-manifest.json',
  // iOS ignores the manifest's icons and uses this link instead, so without it
  // an iPhone home screen showed the owner app's icon for the tech portal —
  // two identical tiles, one of which a tech cannot sign into.
  icons: {
    icon: '/icons/tech-icon-192.png',
    apple: '/icons/tech-apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'FAJ Tech',
    statusBarStyle: 'black-translucent',
  },
  robots: { index: false, follow: false },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#0E1B2E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
};

// The Field Service LIVE look (app/tech/fs.css): Inter, which the root
// layout's Google Fonts link already loads.
export default function TechLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <UpdateBar />
      <script
        dangerouslySetInnerHTML={{
          __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/tech-sw.js').catch(() => {})}`,
        }}
      />
    </>
  );
}
