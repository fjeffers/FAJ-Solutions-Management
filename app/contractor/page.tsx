'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Sparkles } from 'lucide-react';
import type { Contractor, WorkOrder, Payment, DeliverableSubmission, TimeLog, Signature, WoTask, CustomQAItem } from '@/lib/types';
import { useInactivityLogout } from '@/lib/useInactivityLogout';
import ContractorPortal from '@/components/ContractorPortal';

export default function ContractorPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [contractor,   setContractor]   = useState<Contractor | null>(null);
  const [workOrders,   setWorkOrders]   = useState<WorkOrder[]>([]);
  const [payments,     setPayments]     = useState<Payment[]>([]);
  const [submissions,  setSubmissions]  = useState<DeliverableSubmission[]>([]);
  const [timeLogs,     setTimeLogs]     = useState<TimeLog[]>([]);
  const [signatures,   setSignatures]   = useState<Signature[]>([]);
  const [loading,      setLoading]      = useState(true);

  // ── Load all data ─────────────────────────────────────────────────────────

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }

    // Verify this is a contractor (not an admin)
    const { data: cRecord } = await supabase
      .from('contractors')
      .select('*')
      .eq('email', user.email ?? '')
      .maybeSingle();

    if (!cRecord) { router.replace('/'); return; }

    setContractor(cRecord);

    const [woRes, payRes, subRes, logRes, sigRes] = await Promise.all([
      supabase.from('work_orders').select('*').order('start_date', { ascending: true }),
      supabase.from('payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('deliverable_submissions').select('*').order('submitted_at', { ascending: false }),
      supabase.from('time_logs').select('*').order('checked_in_at', { ascending: false }),
      supabase.from('signatures').select('*').order('signed_at', { ascending: false }),
    ]);

    if (woRes.data)  setWorkOrders(woRes.data as WorkOrder[]);
    if (payRes.data) setPayments(payRes.data);
    if (subRes.data) setSubmissions(subRes.data as DeliverableSubmission[]);
    if (logRes.data) setTimeLogs(logRes.data as TimeLog[]);
    if (sigRes.data) setSignatures(sigRes.data as Signature[]);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const updateWoStatus = async (woId: string, newStatus: WorkOrder['wo_status']) => {
    await supabase.from('work_orders').update({ wo_status: newStatus }).eq('id', woId);
    loadData();
  };

  const checkIn = async (woId: string, woNumber: string) => {
    if (!contractor) return;
    await supabase.from('time_logs').insert({
      wo_id: woId,
      wo_number: woNumber,
      contractor_name: contractor.name,
      checked_in_at: new Date().toISOString(),
    });
    loadData();
  };

  const checkOut = async (woId: string) => {
    if (!contractor) return;
    await supabase
      .from('time_logs')
      .update({ checked_out_at: new Date().toISOString() })
      .eq('wo_id', woId)
      .eq('contractor_name', contractor.name)
      .is('checked_out_at', null);
    loadData();
  };

  const saveSignature = async (woId: string, woNumber: string, signerName: string, signatureData: string) => {
    if (!contractor) return;
    await supabase.from('signatures').insert({
      wo_id: woId,
      wo_number: woNumber,
      contractor_name: contractor.name,
      signer_name: signerName || null,
      signature_data: signatureData,
      signed_at: new Date().toISOString(),
    });
    loadData();
  };

  const saveTasks = async (woId: string, tasks: WoTask[]) => {
    await supabase.from('work_orders').update({ wo_tasks: tasks }).eq('id', woId);
    // No full reload needed — tasks state is already updated locally
  };

  const uploadFile = async (woId: string, file: File): Promise<string | null> => {
    const path = `${woId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('deliverables')
      .upload(path, file, { upsert: false });
    if (error || !data) {
      console.error('Upload error:', error);
      return null;
    }
    const { data: urlData } = supabase.storage
      .from('deliverables')
      .getPublicUrl(data.path);
    return urlData.publicUrl;
  };

  const saveCustomQA = async (woId: string, qa: CustomQAItem[]) => {
    await supabase.from('work_orders').update({ custom_qa: qa }).eq('id', woId);
    // Local state already updated in ContractorPortal — no full reload needed
  };

  const submitForReview = async (woId: string, woNumber: string, closeoutNotes: string, fileUrls: string[]) => {
    if (!contractor) return;
    const now = new Date().toISOString();
    await Promise.all([
      supabase.from('deliverable_submissions').insert({
        wo_id: woId,
        wo_number: woNumber,
        contractor_name: contractor.name,
        notes: closeoutNotes || null,
        file_urls: fileUrls,
        submitted_at: now,
      }),
      supabase.from('work_orders').update({
        wo_status: 'Work Done',
        closeout_notes: closeoutNotes || null,
        submitted_at: now,
      }).eq('id', woId),
    ]);
    loadData();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  useInactivityLogout(handleLogout);

  // ── Loading / guard ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Sparkles size={28} color="var(--gold)" style={{ marginBottom: 12 }} />
          <div className="serif" style={{ fontSize: 22, color: 'var(--teal)' }}>Loading your jobs...</div>
        </div>
      </div>
    );
  }

  if (!contractor) return null;

  return (
    <ContractorPortal
      contractor={contractor}
      workOrders={workOrders}
      payments={payments}
      submissions={submissions}
      timeLogs={timeLogs}
      signatures={signatures}
      onUpdateStatus={updateWoStatus}
      onCheckIn={checkIn}
      onCheckOut={checkOut}
      onSaveSignature={saveSignature}
      onSaveTasks={saveTasks}
      onUploadFile={uploadFile}
      onSubmitForReview={submitForReview}
      onSaveCustomQA={saveCustomQA}
      onLogout={handleLogout}
    />
  );
}
