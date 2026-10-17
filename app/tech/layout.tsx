import type { Metadata } from 'next';
import './fs.css';

// The tech portal installs as its OWN app, separate from the owner's.
// Without this the root layout's manifest wins and a tech who taps "Add to
// Home Screen" gets a "FAJ Business Manager" icon that opens the owner app's
// login — which is not their app and which they cannot sign into.
export const metadata: Metadata = {
  title: 'FAJ Tech Portal',
  manifest: '/tech-manifest.json',
  // iOS ignores the manifest's icons and uses this link instead, so without it
  // an iPhone home screen showed the owner app's icon for the tech portal —
  // two identical tiles, one of which a tech cannot sign into.
  icons: {
    icon: '/icons/faj-favicon-v2.png',
    apple: '/icons/tech-apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'FAJ Tech',
    statusBarStyle: 'black-translucent',
  },
  robots: { index: false, follow: false },
};

// The Field Service look (app/tech/fs.css). Its fonts (Barlow, Barlow
// Condensed, JetBrains Mono) come from the root layout's Google Fonts link:
// next/font fetched them at build time and a failed fetch broke the deploy.
export default function TechLayout({ children }: { children: React.ReactNode }) {
  return children;
}
