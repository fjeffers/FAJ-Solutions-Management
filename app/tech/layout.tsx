import type { Metadata } from 'next';

// The tech portal installs as its OWN app, separate from the owner's.
// Without this the root layout's manifest wins and a tech who taps "Add to
// Home Screen" gets a "FAJ Business Manager" icon that opens the owner app's
// login — which is not their app and which they cannot sign into.
export const metadata: Metadata = {
  title: 'FAJ Tech Portal',
  manifest: '/tech-manifest.json',
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
