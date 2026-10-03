import type { Metadata } from 'next';

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

export default function TechLayout({ children }: { children: React.ReactNode }) {
  return children;
}
