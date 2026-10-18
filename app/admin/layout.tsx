import UpdateBar from '@/components/UpdateBar';

// The office app: offers the update when a newer version is live (components/UpdateBar.tsx).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<UpdateBar /></>;
}
