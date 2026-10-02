'use client';
import { Calculator } from 'lucide-react';
import StaffLogin from '@/components/StaffLogin';

export default function AccountantLoginPage() {
  return (
    <StaffLogin
      title="Accountant" home="/accountant"
      tagline="1099s, W-9s, payouts and income, read-only."
      icon={<Calculator size={22} color="var(--gold)" />}
    />
  );
}
