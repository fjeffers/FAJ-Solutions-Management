'use client';
import { ClipboardList } from 'lucide-react';
import StaffLogin from '@/components/StaffLogin';

export default function AssistantLoginPage() {
  return (
    <StaffLogin
      title="Assistant" home="/assistant"
      tagline="Your to-do list, the schedule and the team."
      icon={<ClipboardList size={22} color="var(--gold)" />}
    />
  );
}
