import type { Metadata } from 'next';

// The accountant's own place: its own title, never indexed by search engines.
export const metadata: Metadata = {
  title: 'FAJ Accountant',
  robots: { index: false, follow: false },
};

export default function AccountantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
