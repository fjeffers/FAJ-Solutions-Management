import type { Metadata } from 'next';
import UpdateBar from '@/components/UpdateBar';

// The office app installs from the office pages only (it used to come from the
// root layout, so every page offered it; app/layout.tsx).
export const metadata: Metadata = {
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    // 'black', not 'black-translucent': the page starts below the iPhone's
    // clock instead of under it.
    statusBarStyle: 'black',
    title: 'FAJ',
  },
  // The old apple- tag iPhones still read (Next 16 writes only the new one).
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

// The office app: offers the update when a newer version is live (components/UpdateBar.tsx).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<UpdateBar /></>;
}
