import type { Metadata } from 'next';

// The assistant section is its own place, like the tech portal: its own title
// and never indexed by search engines.
export const metadata: Metadata = {
  title: 'FAJ Assistant',
  robots: { index: false, follow: false },
};

export default function AssistantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
