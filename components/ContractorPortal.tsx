'use client';
import { useState, useRef } from 'react';
import {
  MapPin, Clock, DollarSign, ChevronDown, ChevronUp,
  LogOut, Sparkles, AlertCircle, Timer,
  Paperclip, PenLine, FileText, Upload, CheckCircle2,
  Send, Check, ListChecks, Camera,
} from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { Contractor, WorkOrder, Payment, DeliverableSubmission, TimeLog, Signature, WoTask, CustomQAItem } from '@/lib/types';
import SignaturePad from './SignaturePad';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string; border: string }> = {
  'Open':        { bg: 'rgba(13,115,119,0.12)',  color: '#0D7377', label: 'Open',        border: '#0D7377' },
  'Assigned':    { bg: 'rgba(245,158,11,0.15)',  color: '#b45309', label: 'Assigned',    border: '#f59e0b' },
  'In Progress': { bg: 'rgba(249,115,22,0.15)',  color: '#c2410c', label: 'In Progress', border: '#f97316' },
  'Work Done':   { bg: 'rgba(99,102,241,0.15)',  color: '#4338ca', label: 'Work Done',   border: '#6366f1' },
  'Approved':    { bg: 'rgba(16,185,129,0.15)',  color: '#047857', label: 'Approved',    border: '#10b981' },
  'Paid':        { bg: 'rgba(5,150,105,0.2)',    color: '#065f46', label: 'Paid',        border: '#059669' },
};

const DEFAULT_TASKS: WoTask[] = [
  { id: 'prep-1',    category: 'Pre Visit', label: 'Review work order details',            completed: false, completed_at: null },
  { id: 'prep-2',    category: 'Pre Visit', label: 'Confirm schedule with site contact',   completed: false, completed_at: null },
  { id: 'prep-3',    category: 'Pre Visit', label: 'Gather required tools and materials',  completed: false, completed_at: null },
  { id: 'onsite-1',  category: 'On Site',   label: 'Check in with site contact',           completed: false, completed_at: null },
  { id: 'onsite-2',  category: 'On Site',   label: 'Complete scope of work',               completed: false, completed_at: null },
  { id: 'onsite-3',  category: 'On Site',   label: 'Test all installed equipment',         completed: false, completed_at: null },
  { id: 'onsite-4',  category: 'On Site',   label: 'Clean up work area',                  completed: false, completed_at: null },
  { id: 'post-1',    category: 'Post Site', label: 'Document all work completed',          completed: false, completed_at: null },
  { id: 'post-2',    category: 'Post Site', label: 'Collect customer signature',           completed: false, completed_at: null },
  { id: 'post-3',    category: 'Post Site', label: 'Submit deliverables',                  completed: false, completed_at: null },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(dt: string) {
  return new Date(dt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function calcDuration(inAt: string, outAt: string): string {
  const ms = new Date(outAt).getTime() - new Date(inAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type WOSection = 'overview' | 'qa' | 'tasks' | 'timelog' | 'files' | 'signoff';

// ─── WOCard ───────────────────────────────────────────────────────────────────

function WOCard({
  wo,
  submissions,
  woTimeLogs,
  woSignature,
  onUpdateStatus,
  onCheckIn,
  onCheckOut,
  onSaveSignature,
  onSaveTasks,
  onUploadFile,
  onSubmitForReview,
  onSaveCustomQA,
}: {
  wo: WorkOrder;
  submissions: DeliverableSubmission[];
  woTimeLogs: TimeLog[];
  woSignature: Signature | undefined;
  onUpdateStatus: (id: string, status: WorkOrder['wo_status']) => Promise<void>;
  onCheckIn: (woId: string, woNumber: string) => Promise<void>;
  onCheckOut: (woId: string) => Promise<void>;
  onSaveSignature: (woId: string, woNumber: string, signerName: string, data: string) => Promise<void>;
  onSaveTasks: (woId: string, tasks: WoTask[]) => Promise<void>;
  onUploadFile: (woId: string, file: File) => Promise<string | null>;
  onSubmitForReview: (woId: string, woNumber: string, notes: string, fileUrls: string[]) => Promise<void>;
  onSaveCustomQA: (woId: string, qa: CustomQAItem[]) => Promise<void>;
}) {
  const [expanded, setExpanded]           = useState(false);
  const [activeSection, setActiveSection] = useState<WOSection>('overview');
  // Normalize legacy category names ('Prep'→'Pre Visit', 'Post'→'Post Site')
  const normalizeTasks = (raw: WoTask[]): WoTask[] =>
    raw.map((t) => ({
      ...t,
      category: t.category === 'Prep' ? 'Pre Visit' : t.category === 'Post' ? 'Post Site' : t.category,
    }));

  const [tasks, setTasks]                 = useState<WoTask[]>(() =>
    wo.wo_tasks && wo.wo_tasks.length > 0 ? normalizeTasks(wo.wo_tasks) : DEFAULT_TASKS
  );
  const [signerName, setSignerName]       = useState('');
  const [showSigPad, setShowSigPad]       = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [uploading, setUploading]         = useState(false);
  const [closeoutNotes, setCloseoutNotes] = useState('');
  const [updating, setUpdating]           = useState(false);
  const [submitting, setSubmitting]       = useState(false);
  const [clocking, setClocking]           = useState(false);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const cameraInputRef  = useRef<HTMLInputElement>(null);   // site photo (camera)
  const vendorInputRef  = useRef<HTMLInputElement>(null);   // vendor docs
  const photoInputRef   = useRef<HTMLInputElement>(null);   // Q&A photo questions
  const activePhotoQaId = useRef<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState<string | null>(null);
  const [qaItems, setQaItems] = useState<CustomQAItem[]>(() => wo.custom_qa ?? []);

  const cfg          = STATUS_CONFIG[wo.wo_status] ?? STATUS_CONFIG['Open'];
  const isEditable   = !['Approved', 'Paid'].includes(wo.wo_status);
  const isComplete   = ['Work Done', 'Approved', 'Paid'].includes(wo.wo_status);
  const activeLog    = woTimeLogs.find((l) => l.checked_in_at && !l.checked_out_at);
  const pastLogs     = woTimeLogs.filter((l) => l.checked_out_at);
  const completedCt  = tasks.filter((t) => t.completed).length;
  const taskProgress = tasks.length > 0 ? Math.round((completedCt / tasks.length) * 100) : 0;
  const allPrevFiles = submissions.flatMap((s) => s.file_urls ?? []);
  const deliverableLines = wo.deliverables
    ? wo.deliverables.split('\n').map((l) => l.trim()).filter(Boolean)
    : [];

  const catColor: Record<string, string> = {
    'Pre Visit': '#b45309', 'On Site': '#0D7377', 'Post Site': '#4338ca',
  };
  const catBg: Record<string, string> = {
    'Pre Visit': 'rgba(180,83,9,0.08)', 'On Site': 'rgba(13,115,119,0.08)', 'Post Site': 'rgba(67,56,202,0.08)',
  };

  const hasSiteInfo = !!(wo.poc_name || wo.poc_phone || wo.poc_email || wo.support_contact || wo.attachment_url || (wo.custom_qa && wo.custom_qa.length > 0));
  const SECTIONS_DATA: { id: WOSection; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(hasSiteInfo ? [{ id: 'qa' as WOSection, label: 'Contacts' }] : []),
    { id: 'tasks',    label: `Tasks ${completedCt}/${tasks.length}` },
    { id: 'timelog',  label: 'Time' },
    { id: 'files',    label: uploadedFiles.length + allPrevFiles.length > 0 ? `Files (${uploadedFiles.length + allPrevFiles.length})` : 'Files' },
    { id: 'signoff',  label: woSignature ? 'Signed ✓' : 'Sign Off' },
  ];

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleTaskToggle = async (taskId: string) => {
    if (!isEditable) return;
    const updated = tasks.map((t) =>
      t.id === taskId
        ? { ...t, completed: !t.completed, completed_at: !t.completed ? new Date().toISOString() : null }
        : t
    );
    setTasks(updated);
    await onSaveTasks(wo.id, updated);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await onUploadFile(wo.id, file);
    if (url) setUploadedFiles((prev) => [...prev, url]);
    setUploading(false);
    const ref = e.target;
    if (ref) ref.value = '';
  };

  const handleQAPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const qId = activePhotoQaId.current;
    if (!file || !qId) return;
    setPhotoUploading(qId);
    const url = await onUploadFile(wo.id, file);
    if (url) {
      const updated = qaItems.map((item) => item.id === qId ? { ...item, answer: url } : item);
      setQaItems(updated);
      await onSaveCustomQA(wo.id, updated);
    }
    setPhotoUploading(null);
    activePhotoQaId.current = null;
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const handleStartJob = async () => {
    setUpdating(true);
    await onUpdateStatus(wo.id, 'In Progress');
    setUpdating(false);
  };

  const handleSubmitForReview = async () => {
    setSubmitting(true);
    await onSubmitForReview(wo.id, wo.wo_number, closeoutNotes, uploadedFiles);
    setCloseoutNotes('');
    setSubmitting(false);
  };

  const handleSaveSignature = async (dataUrl: string) => {
    await onSaveSignature(wo.id, wo.wo_number, signerName, dataUrl);
    setShowSigPad(false);
  };

  const handleCheckIn = async () => {
    setClocking(true);
    await onCheckIn(wo.id, wo.wo_number);
    setClocking(false);
  };

  const handleCheckOut = async () => {
    setClocking(true);
    await onCheckOut(wo.id);
    setClocking(false);
  };

  const handleQAAnswer = async (id: string, answer: string) => {
    const updated = qaItems.map((q) => (q.id === id ? { ...q, answer } : q));
    setQaItems(updated);
    await onSaveCustomQA(wo.id, updated);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 14, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', border: '1px solid #e0e4ea' }}>

      {/* ── DARK HEADER (always visible, tap to expand) ── */}
      <div
        style={{ background: 'linear-gradient(160deg, #0d2d4a 0%, #163a5e 60%, #1a5276 100%)', cursor: 'pointer', padding: '14px 16px 0' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, paddingBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* WO number + status badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#c8a84b', fontFamily: 'monospace', letterSpacing: 1, background: 'rgba(200,168,75,0.12)', padding: '2px 7px', borderRadius: 4 }}>{wo.wo_number}</span>
              <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>{cfg.label}</span>
              {activeLog && (
                <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(249,115,22,0.3)', color: '#ffcc80', border: '1px solid rgba(249,115,22,0.5)' }}>
                  ● Clocked In
                </span>
              )}
            </div>
            {/* Title */}
            <div style={{ fontSize: 15, fontWeight: 800, color: 'white', lineHeight: 1.35, marginBottom: 8, letterSpacing: -0.2 }}>
              {wo.title || wo.service_type || 'Work Order'}
            </div>
            {/* Location + schedule */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
              {(wo.site_name || wo.site_city) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                  <MapPin size={11} color="#c8a84b" />
                  {[wo.site_name, wo.site_city, wo.site_state].filter(Boolean).join(' · ')}
                </span>
              )}
              {wo.start_date && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                  <Clock size={11} color="#c8a84b" />
                  {fmtDate(wo.start_date)}{wo.start_time && ` at ${wo.start_time}`}
                </span>
              )}
            </div>
          </div>
          {/* Pay + expand */}
          <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'white', letterSpacing: -0.5 }}>{fmtMoney(Number(wo.total_amount))}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{wo.pay_type}</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </div>
        </div>
        {/* Task progress bar — always visible in header */}
        {tasks.length > 0 && (
          <div style={{ paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>Tasks</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: completedCt === tasks.length ? '#86efac' : 'rgba(255,255,255,0.65)' }}>{completedCt} / {tasks.length}</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${taskProgress}%`, background: taskProgress === 100 ? '#86efac' : '#c8a84b', borderRadius: 4, transition: 'width 0.4s' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── STATUS STRIP ── */}
      {expanded && (
        <div style={{ background: 'white', borderLeft: `4px solid ${cfg.border}`, borderBottom: '1px solid #e0e4ea', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
            {cfg.label}
          </span>
          {activeLog && (
            <span style={{ fontSize: 11, color: '#c2410c', fontWeight: 600 }}>
              ● Clocked in {fmtDateTime(activeLog.checked_in_at!)}
            </span>
          )}
        </div>
      )}

      {/* ── SECTION TABS ── */}
      {expanded && (
        <div style={{ display: 'flex', background: '#f8fafc', borderBottom: '1px solid #e0e4ea', overflowX: 'auto' }}>
          {SECTIONS_DATA.map((sec) => (
            <button
              key={sec.id}
              onClick={(e) => { e.stopPropagation(); setActiveSection(sec.id); }}
              style={{
                flex: '0 0 auto', padding: '10px 14px', border: 'none', cursor: 'pointer',
                background: activeSection === sec.id ? 'white' : 'transparent',
                fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                color: activeSection === sec.id ? '#0d2d4a' : '#90a4ae',
                borderBottom: activeSection === sec.id ? '2px solid #0d2d4a' : '2px solid transparent',
              }}
            >
              {sec.label}
            </button>
          ))}
        </div>
      )}

      {/* ── SECTION CONTENT ── */}
      {expanded && (
        <div style={{ background: '#f4f6f9', padding: '12px' }}>

          {/* ── OVERVIEW ── */}
          {activeSection === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>

              {/* Location card — full width, FN style */}
              {wo.site_address && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  {/* Map placeholder strip */}
                  <div style={{ height: 72, background: 'linear-gradient(135deg, #1a5276 0%, #0d2d4a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' as const }}>
                    <MapPin size={28} color="rgba(200,168,75,0.8)" />
                    <div style={{ position: 'absolute' as const, inset: 0, background: 'repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(255,255,255,0.03) 18px,rgba(255,255,255,0.03) 19px),repeating-linear-gradient(90deg,transparent,transparent 18px,rgba(255,255,255,0.03) 18px,rgba(255,255,255,0.03) 19px)' }} />
                  </div>
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 4 }}>Location</div>
                    {wo.site_name && <div style={{ fontSize: 14, fontWeight: 800, color: '#0d2d4a', marginBottom: 3 }}>{wo.site_name}</div>}
                    <div style={{ fontSize: 13, color: '#37474f', lineHeight: 1.5 }}>
                      {wo.site_address}
                      {(wo.site_city || wo.site_state) && (
                        <span>{'\n'}{[wo.site_city, wo.site_state, wo.site_zip].filter(Boolean).join(', ')}</span>
                      )}
                    </div>
                    {wo.site_address && (
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent([wo.site_address, wo.site_city, wo.site_state, wo.site_zip].filter(Boolean).join(' '))}`}
                        target="_blank" rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 11, fontWeight: 700, color: '#1565c0', textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MapPin size={11} /> Get Directions →
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Schedule card */}
              {wo.start_date && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 4 }}>Schedule</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#0d2d4a' }}>{fmtDate(wo.start_date)}</div>
                      {wo.start_time && <div style={{ fontSize: 13, color: '#1a5276', fontWeight: 600, marginTop: 2 }}>{wo.start_time}</div>}
                    </div>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: '#e3f2fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📅</div>
                  </div>
                </div>
              )}

              {/* Pay card — FN blended pay style */}
              <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f0f4f8' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 8 }}>Pay</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                      <div style={{ fontSize: 26, fontWeight: 900, color: '#2e7d32', letterSpacing: -0.5 }}>{fmtMoney(Number(wo.total_amount))}</div>
                      <div style={{ fontSize: 11, color: '#90a4ae', marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{wo.pay_type || 'Fixed'}</div>
                    </div>
                    <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>{cfg.label}</span>
                  </div>
                </div>
                {/* Pay line items — shown for blended/hourly */}
                {(wo.blended_base || wo.hourly_rate) && (
                  <div style={{ padding: '8px 14px 10px' }}>
                    {wo.blended_base && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f5f5f5' }}>
                        <span style={{ fontSize: 12, color: '#546e7a' }}>Base pay</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#333' }}>{fmtMoney(Number(wo.blended_base))}</span>
                      </div>
                    )}
                    {wo.hourly_rate && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                        <span style={{ fontSize: 12, color: '#546e7a' }}>Hourly rate</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#333' }}>{fmtMoney(Number(wo.hourly_rate))}/hr</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Scope of work */}
              {wo.description && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px 4px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 8 }}>Scope of Work</div>
                    <div style={{ fontSize: 13, color: '#37474f', lineHeight: 1.7, paddingBottom: 12 }}>{wo.description}</div>
                  </div>
                </div>
              )}

              {/* Required skills */}
              {wo.required_skills && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 8 }}>Required Skills</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {wo.required_skills.split(',').map((s) => s.trim()).filter(Boolean).map((skill) => (
                      <span key={skill} style={{ padding: '4px 11px', borderRadius: 20, fontSize: 11, background: '#e3f2fd', color: '#1565c0', fontWeight: 700, border: '1px solid #bfdbfe' }}>{skill}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Deliverables */}
              {deliverableLines.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 14px 4px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 8 }}>Deliverables</div>
                    <div style={{ paddingBottom: 10 }}>
                      {deliverableLines.map((line, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
                          <CheckCircle2 size={15} color={isComplete ? '#43a047' : '#cfd8dc'} style={{ marginTop: 1, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: '#37474f', lineHeight: 1.4 }}>{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Submissions */}
              {submissions.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #c8e6c9', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px 4px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#2e7d32', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 8 }}>Your Submissions</div>
                    <div style={{ paddingBottom: 8 }}>
                      {submissions.map((sub) => (
                        <div key={sub.id} style={{ padding: '8px 10px', background: '#f0fdf4', borderRadius: 8, marginBottom: 6, borderLeft: '3px solid #43a047' }}>
                          <div style={{ fontSize: 10, color: '#90a4ae', marginBottom: 3 }}>{fmtDateTime(sub.submitted_at)}</div>
                          {sub.notes && <div style={{ fontSize: 12, color: '#333', marginBottom: sub.file_urls?.length ? 4 : 0 }}>{sub.notes}</div>}
                          {sub.file_urls?.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#1565c0', marginTop: 3, textDecoration: 'none' }}>
                              <Paperclip size={10} /> File {i + 1}
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {!wo.description && !wo.site_address && !wo.required_skills && deliverableLines.length === 0 && submissions.length === 0 && (
                <div style={{ textAlign: 'center', padding: '28px 0', color: '#b0bec5', fontSize: 13 }}>No details added yet</div>
              )}
            </div>
          )}

          {/* ── TASKS ── */}
          {activeSection === 'tasks' && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {/* Summary bar */}
              <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0d2d4a' }}>Task Checklist</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: completedCt === tasks.length ? '#2e7d32' : '#546e7a' }}>{completedCt} / {tasks.length}</span>
                  </div>
                  <div style={{ height: 6, background: '#e8ecf0', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${taskProgress}%`, background: taskProgress === 100 ? '#43a047' : '#0D7377', borderRadius: 6, transition: 'width 0.4s' }} />
                  </div>
                </div>
              </div>

              {/* Category groups */}
              {(['Pre Visit', 'On Site', 'Post Site'] as const).map((cat) => {
                const catTasks = tasks.filter((t) => t.category === cat);
                if (catTasks.length === 0) return null;
                const catDone = catTasks.filter((t) => t.completed).length;
                const allDone = catDone === catTasks.length;
                return (
                  <div key={cat} style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                    {/* Category header */}
                    <div style={{ padding: '10px 14px 8px', background: catBg[cat], borderBottom: `2px solid ${catColor[cat]}22` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: catColor[cat] }} />
                          <span style={{ fontSize: 12, fontWeight: 800, color: catColor[cat], textTransform: 'uppercase' as const, letterSpacing: 0.8 }}>{cat}</span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? '#2e7d32' : catColor[cat], background: allDone ? 'rgba(46,125,50,0.1)' : `${catColor[cat]}18`, padding: '2px 9px', borderRadius: 20 }}>
                          {allDone ? '✓ Complete' : `${catDone}/${catTasks.length}`}
                        </span>
                      </div>
                    </div>
                    {/* Tasks in this category */}
                    <div style={{ padding: '6px 10px 8px' }}>
                      {catTasks.map((task, idx) => (
                        <button
                          key={task.id}
                          onClick={() => handleTaskToggle(task.id)}
                          disabled={!isEditable}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12,
                            padding: '10px 6px', textAlign: 'left', background: 'transparent',
                            border: 'none', borderBottom: idx < catTasks.length - 1 ? '1px solid #f0f4f8' : 'none',
                            cursor: isEditable ? 'pointer' : 'default',
                          }}
                        >
                          {/* Circle checkbox */}
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 0,
                            border: task.completed ? 'none' : `2px solid ${catColor[cat]}66`,
                            background: task.completed ? catColor[cat] : 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s',
                            boxShadow: task.completed ? `0 2px 6px ${catColor[cat]}44` : 'none',
                          }}>
                            {task.completed && <Check size={12} color="white" strokeWidth={3} />}
                          </div>
                          <div style={{ flex: 1, paddingTop: 2 }}>
                            <div style={{ fontSize: 13, color: task.completed ? '#90a4ae' : '#1a1a2e', textDecoration: task.completed ? 'line-through' : 'none', fontWeight: task.completed ? 400 : 600, lineHeight: 1.35 }}>
                              {task.label}
                            </div>
                            {task.completed && task.completed_at && (
                              <div style={{ fontSize: 10, color: '#b0bec5', marginTop: 2 }}>Done {fmtDateTime(task.completed_at)}</div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── TIME LOG ── */}
          {activeSection === 'timelog' && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              {/* Active clock-in banner */}
              {activeLog ? (
                <div style={{ background: 'white', border: '1px solid #ffcc80', borderLeft: '4px solid #fb8c00', borderRadius: 10, padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#fb8c00', boxShadow: '0 0 0 3px rgba(251,140,0,0.2)' }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#e65100', textTransform: 'uppercase' as const, letterSpacing: 0.8 }}>Currently Clocked In</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#546e7a', marginBottom: 12 }}>Since {fmtDateTime(activeLog.checked_in_at!)}</div>
                  <button onClick={handleCheckOut} disabled={clocking}
                    style={{ width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: '#e65100', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Timer size={14} />{clocking ? 'Clocking Out...' : 'Clock Out'}
                  </button>
                </div>
              ) : isEditable ? (
                <button onClick={handleCheckIn} disabled={clocking}
                  style={{ width: '100%', padding: '14px', borderRadius: 10, border: '2px solid #0D7377', background: 'rgba(13,115,119,0.05)', color: '#0D7377', fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Timer size={16} />{clocking ? 'Clocking In...' : 'Clock In'}
                </button>
              ) : null}

              {/* Past time logs */}
              {pastLogs.length > 0 ? (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px 4px', borderBottom: '1px solid #f0f4f8' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.8, color: '#90a4ae' }}>Time Log</span>
                  </div>
                  <div style={{ padding: '4px 14px 8px' }}>
                    {pastLogs.map((log, idx) => (
                      <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: idx < pastLogs.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                        <div>
                          <div style={{ fontSize: 13, color: '#1a1a2e', fontWeight: 700 }}>{fmtDateTime(log.checked_in_at!)}</div>
                          <div style={{ fontSize: 11, color: '#90a4ae', marginTop: 2 }}>→ {fmtDateTime(log.checked_out_at!)}</div>
                        </div>
                        <div style={{ textAlign: 'right' as const }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#0D7377' }}>{calcDuration(log.checked_in_at!, log.checked_out_at!)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : !activeLog && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#b0bec5', fontSize: 13 }}>No time logged yet</div>
              )}
            </div>
          )}

          {/* ── FILES ── */}
          {activeSection === 'files' && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              {isEditable && (
                <>
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileChange} />
                  <input ref={fileInputRef}   type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={handleFileChange} />
                  <input ref={vendorInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={handleFileChange} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button onClick={() => cameraInputRef.current?.click()} disabled={uploading}
                      style={{ padding: '16px 10px', border: '2px dashed #0D7377', borderRadius: 10, background: 'rgba(13,115,119,0.04)', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#0D7377', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6 }}>
                      <Camera size={20} color="#0D7377" />
                      {uploading ? 'Uploading…' : 'Take Site Photo'}
                    </button>
                    <button onClick={() => vendorInputRef.current?.click()} disabled={uploading}
                      style={{ padding: '16px 10px', border: '2px dashed #cfd8dc', borderRadius: 10, background: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#546e7a', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6 }}>
                      <Upload size={20} color="#90a4ae" />
                      Vendor Doc
                    </button>
                  </div>
                </>
              )}
              {uploadedFiles.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #c8e6c9', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px 4px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.8, color: '#2e7d32' }}>Ready to Submit ({uploadedFiles.length})</span>
                  </div>
                  <div style={{ padding: '4px 14px 10px' }}>
                    {uploadedFiles.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f0fdf4', fontSize: 12, color: '#1565c0', textDecoration: 'none' }}>
                        <Paperclip size={12} color="#43a047" /> File {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {allPrevFiles.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px 4px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.8, color: '#90a4ae' }}>Previously Submitted</span>
                  </div>
                  <div style={{ padding: '4px 14px 10px' }}>
                    {allPrevFiles.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f8fafc', fontSize: 12, color: '#546e7a', textDecoration: 'none' }}>
                        <Paperclip size={12} color="#90a4ae" /> Submission File {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {uploadedFiles.length === 0 && allPrevFiles.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#b0bec5', fontSize: 13 }}>No files uploaded yet</div>
              )}
            </div>
          )}

          {/* ── CONTACTS / Q&A ── */}
          {activeSection === 'qa' && (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
              {/* Vendor paperwork attachment */}
              {wo.attachment_url && (
                <a href={wo.attachment_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderRadius: 10, textDecoration: 'none', background: 'white', border: '1px solid rgba(200,168,75,0.4)', borderLeft: '4px solid #c8a84b' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(200,168,75,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FileText size={18} color="#b8944a" />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#b8944a', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 2 }}>Vendor Paperwork</div>
                    <div style={{ fontSize: 13, color: '#333', fontWeight: 600 }}>Tap to open & download →</div>
                  </div>
                </a>
              )}

              {/* Site contacts */}
              {(wo.poc_name || wo.poc_phone || wo.poc_email || wo.support_contact) && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px 6px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8 }}>Site Contacts</div>
                  </div>
                  <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                    {wo.poc_name && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e8ecf0' }}>
                        <span style={{ fontSize: 11, color: '#90a4ae', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Contact</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{wo.poc_name}</span>
                      </div>
                    )}
                    {wo.poc_phone && (
                      <a href={`tel:${wo.poc_phone}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: '#f0f9ff', border: '1px solid #bfdbfe', textDecoration: 'none' }}>
                        <span style={{ fontSize: 11, color: '#90a4ae', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Phone</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#1565c0' }}>{wo.poc_phone}</span>
                      </a>
                    )}
                    {wo.poc_email && (
                      <a href={`mailto:${wo.poc_email}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: '#f0f9ff', border: '1px solid #bfdbfe', textDecoration: 'none' }}>
                        <span style={{ fontSize: 11, color: '#90a4ae', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Email</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1565c0' }}>{wo.poc_email}</span>
                      </a>
                    )}
                    {wo.support_contact && (
                      <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(200,168,75,0.07)', border: '1px solid rgba(200,168,75,0.25)' }}>
                        <div style={{ fontSize: 10, color: '#b8944a', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 }}>Support</div>
                        <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5 }}>{wo.support_contact}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Q&A items */}
              {qaItems.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px 6px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase' as const, letterSpacing: 0.8 }}>Questions — fill in on site</div>
                  </div>
                  <div style={{ padding: '4px 14px 14px', display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
                    {qaItems.map((q, idx) => (
                      <div key={q.id} style={{ paddingTop: idx > 0 ? 16 : 0, borderTop: idx > 0 ? '1px solid #f0f4f8' : 'none' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 8, lineHeight: 1.4 }}>{q.label}</div>
                        {q.type === 'yes_no' ? (
                          <div style={{ display: 'flex', gap: 8 }}>
                            {(['Yes', 'No'] as const).map((opt) => (
                              <button key={opt} onClick={() => handleQAAnswer(q.id, opt)}
                                style={{ flex: 1, padding: '12px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 14,
                                  background: q.answer === opt ? (opt === 'Yes' ? '#2e7d32' : '#b91c1c') : '#f5f5f5',
                                  color: q.answer === opt ? 'white' : '#666',
                                  boxShadow: q.answer === opt ? '0 2px 8px rgba(0,0,0,0.15)' : 'none' }}>
                                {opt}
                              </button>
                            ))}
                          </div>
                        ) : q.type === 'textarea' ? (
                          <textarea value={q.answer ?? ''} onChange={(e) => setQaItems((qs) => qs.map((item) => item.id === q.id ? { ...item, answer: e.target.value } : item))} onBlur={(e) => handleQAAnswer(q.id, e.target.value)} placeholder="Enter answer..."
                            style={{ width: '100%', minHeight: 80, padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e0e4ea', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' as const }} />
                        ) : q.type === 'photo' ? (
                          <>
                            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleQAPhoto} />
                            {q.answer ? (
                              <div style={{ position: 'relative' as const }}>
                                <img src={q.answer} alt="Site photo" style={{ width: '100%', borderRadius: 8, border: '1px solid #e0e4ea', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
                                <button onClick={() => { activePhotoQaId.current = q.id; photoInputRef.current?.click(); }}
                                  style={{ position: 'absolute' as const, top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 6, color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}>
                                  Retake
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { activePhotoQaId.current = q.id; photoInputRef.current?.click(); }} disabled={photoUploading === q.id}
                                style={{ width: '100%', padding: '22px 12px', border: '2px dashed #b0bec5', borderRadius: 10, background: '#fafafa', cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6, color: '#546e7a' }}>
                                <Camera size={26} color="#90a4ae" />
                                <span style={{ fontSize: 13, fontWeight: 700 }}>{photoUploading === q.id ? 'Uploading…' : 'Tap to Take Photo'}</span>
                                <span style={{ fontSize: 11, color: '#b0bec5' }}>Opens camera · also accepts gallery</span>
                              </button>
                            )}
                          </>
                        ) : (
                          <input type={q.type === 'number' ? 'number' : 'text'} value={q.answer ?? ''} onChange={(e) => setQaItems((qs) => qs.map((item) => item.id === q.id ? { ...item, answer: e.target.value } : item))} onBlur={(e) => handleQAAnswer(q.id, e.target.value)} placeholder="Enter answer..."
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e0e4ea', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }} />
                        )}
                        {q.answer && q.type !== 'photo' && <div style={{ fontSize: 10, color: '#2e7d32', marginTop: 4, fontWeight: 700 }}>✓ Saved</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasSiteInfo && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#b0bec5', fontSize: 13 }}>No contacts on this work order</div>
              )}
            </div>
          )}

          {/* ── SIGN OFF ── */}
          {activeSection === 'signoff' && (
            <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid #f0f4f8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.8, color: '#90a4ae' }}>Customer Sign Off</span>
                {woSignature && <span style={{ fontSize: 11, fontWeight: 700, color: '#2e7d32', background: 'rgba(46,125,50,0.1)', padding: '2px 9px', borderRadius: 20 }}>✓ Signed</span>}
              </div>
              <div style={{ padding: '14px' }}>
                {woSignature ? (
                  <div>
                    <div style={{ border: '1px solid #e0e4ea', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
                      <img src={woSignature.signature_data} alt="Signature" style={{ width: '100%', display: 'block' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#546e7a' }}>
                      <span style={{ fontWeight: 600 }}>{woSignature.signer_name || 'Signed'}</span>
                      <span style={{ color: '#90a4ae' }}>{fmtDateTime(woSignature.signed_at)}</span>
                    </div>
                  </div>
                ) : isEditable ? (
                  showSigPad ? (
                    <SignaturePad onSave={handleSaveSignature} onCancel={() => setShowSigPad(false)} />
                  ) : (
                    <div>
                      <div style={{ fontSize: 13, color: '#546e7a', marginBottom: 14, lineHeight: 1.6 }}>
                        Capture a customer or supervisor signature to confirm work completion.
                      </div>
                      <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Signer name (optional)" className="input" style={{ marginBottom: 10 }} />
                      <button onClick={() => setShowSigPad(true)}
                        style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: '#0d2d4a', color: 'white', fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <PenLine size={15} /> Open Signature Pad
                      </button>
                    </div>
                  )
                ) : (
                  <div style={{ textAlign: 'center', padding: '28px 0', color: '#b0bec5', fontSize: 13 }}>No signature collected</div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── FOOTER ACTIONS ── */}
      {expanded && isEditable && (
        <div style={{ padding: '14px 14px', borderTop: '2px solid #f0f4f8', background: 'white' }}>
          {wo.wo_status === 'Assigned' && (
            <button onClick={handleStartJob} disabled={updating}
              style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #0d2d4a 0%, #1a5276 100%)', color: 'white', fontWeight: 800, fontSize: 15, cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, letterSpacing: 0.3 }}>
              <ListChecks size={16} />
              {updating ? 'Updating...' : 'Start Job'}
            </button>
          )}
          {wo.wo_status === 'In Progress' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8 }}>Closeout Notes</div>
              <textarea value={closeoutNotes} onChange={(e) => setCloseoutNotes(e.target.value)}
                placeholder="Summarize work completed, issues found, equipment installed..."
                style={{ width: '100%', minHeight: 72, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e0e4ea', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 10 }} />
              <button onClick={handleSubmitForReview} disabled={submitting}
                style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #0d2d4a 0%, #1a5276 100%)', color: 'white', fontWeight: 800, fontSize: 15, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Send size={15} />{submitting ? 'Submitting...' : 'Submit for Review'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ContractorPortal ─────────────────────────────────────────────────────────

export default function ContractorPortal({
  contractor, workOrders, payments, submissions, timeLogs, signatures,
  onUpdateStatus, onCheckIn, onCheckOut, onSaveSignature, onSaveTasks,
  onUploadFile, onSubmitForReview, onLogout, onSaveCustomQA,
}: {
  contractor: Contractor;
  workOrders: WorkOrder[];
  payments: Payment[];
  submissions: DeliverableSubmission[];
  timeLogs: TimeLog[];
  signatures: Signature[];
  onUpdateStatus: (id: string, status: WorkOrder['wo_status']) => Promise<void>;
  onCheckIn: (woId: string, woNumber: string) => Promise<void>;
  onCheckOut: (woId: string) => Promise<void>;
  onSaveSignature: (woId: string, woNumber: string, signerName: string, data: string) => Promise<void>;
  onSaveTasks: (woId: string, tasks: WoTask[]) => Promise<void>;
  onUploadFile: (woId: string, file: File) => Promise<string | null>;
  onSubmitForReview: (woId: string, woNumber: string, notes: string, fileUrls: string[]) => Promise<void>;
  onSaveCustomQA: (woId: string, qa: CustomQAItem[]) => Promise<void>;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<'jobs' | 'payments'>('jobs');

  const activeJobs    = workOrders.filter((w) => !['Approved', 'Paid'].includes(w.wo_status));
  const completedJobs = workOrders.filter((w) => ['Approved', 'Paid'].includes(w.wo_status));
  const totalPaid     = payments.reduce((s, p) => s + Number(p.amount), 0);
  const totalBilled   = workOrders.reduce((s, w) => s + Number(w.total_amount), 0);

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', maxWidth: 640, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg, #0d2d4a 0%, #1a5276 100%)', padding: '20px 20px 24px', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="#c8a84b" />
            <span style={{ fontSize: 11, color: '#c8a84b', fontWeight: 700, letterSpacing: 2 }}>FAJ SOLUTIONS</span>
          </div>
          <button
            onClick={onLogout}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            <LogOut size={12} /> Sign Out
          </button>
        </div>

        <div style={{ fontSize: 26, fontWeight: 700, color: 'white', marginBottom: 2 }}>
          {contractor.name}
        </div>
        {contractor.business_name && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{contractor.business_name}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 2 }}>Active</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'white' }}>{activeJobs.length}</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 2 }}>Total Billed</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>{fmtMoney(totalBilled)}</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 2 }}>Paid Out</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#86efac' }}>{fmtMoney(totalPaid)}</div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', background: 'white', borderBottom: '1px solid #e0e4ea', position: 'sticky', top: 0, zIndex: 10 }}>
        {(['jobs', 'payments'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ flex: 1, padding: '14px 0', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, border: 'none', cursor: 'pointer', background: 'none', color: tab === t ? '#0d2d4a' : '#90a4ae', borderBottom: tab === t ? '2px solid #0d2d4a' : '2px solid transparent', textTransform: 'uppercase' as const }}
          >
            {t === 'jobs' ? `Jobs (${workOrders.length})` : `Payments (${payments.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 14px 40px' }}>

        {/* JOBS TAB */}
        {tab === 'jobs' && (
          <>
            {activeJobs.length === 0 && completedJobs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#90a4ae' }}>
                <AlertCircle size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No jobs assigned yet</div>
                <div style={{ fontSize: 13 }}>{"You'll see your work orders here once FAJ Solutions assigns them."}</div>
              </div>
            )}

            {activeJobs.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 2, textTransform: 'uppercase' as const, marginBottom: 12 }}>Active Jobs</div>
                {activeJobs.map((wo) => (
                  <WOCard
                    key={wo.id}
                    wo={wo}
                    submissions={submissions.filter((s) => s.wo_id === wo.id)}
                    woTimeLogs={timeLogs.filter((l) => l.wo_id === wo.id)}
                    woSignature={signatures.find((s) => s.wo_id === wo.id)}
                    onUpdateStatus={onUpdateStatus}
                    onCheckIn={onCheckIn}
                    onCheckOut={onCheckOut}
                    onSaveSignature={onSaveSignature}
                    onSaveTasks={onSaveTasks}
                    onUploadFile={onUploadFile}
                    onSubmitForReview={onSubmitForReview}
                    onSaveCustomQA={onSaveCustomQA}
                  />
                ))}
              </>
            )}

            {completedJobs.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 2, textTransform: 'uppercase' as const, margin: '24px 0 12px' }}>Completed</div>
                {completedJobs.map((wo) => (
                  <WOCard
                    key={wo.id}
                    wo={wo}
                    submissions={submissions.filter((s) => s.wo_id === wo.id)}
                    woTimeLogs={timeLogs.filter((l) => l.wo_id === wo.id)}
                    woSignature={signatures.find((s) => s.wo_id === wo.id)}
                    onUpdateStatus={onUpdateStatus}
                    onCheckIn={onCheckIn}
                    onCheckOut={onCheckOut}
                    onSaveSignature={onSaveSignature}
                    onSaveTasks={onSaveTasks}
                    onUploadFile={onUploadFile}
                    onSubmitForReview={onSubmitForReview}
                    onSaveCustomQA={onSaveCustomQA}
                  />
                ))}
              </>
            )}
          </>
        )}

        {/* PAYMENTS TAB */}
        {tab === 'payments' && (
          <div>
            {payments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#90a4ae' }}>
                <DollarSign size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No payments recorded</div>
                <div style={{ fontSize: 13 }}>Payments will appear here once processed.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {payments.map((p) => (
                  <div key={p.id} style={{ background: 'white', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0e4ea' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e' }}>WO #{p.wo_number}</div>
                        <div style={{ fontSize: 11, color: '#90a4ae', marginTop: 2 }}>{fmtDate(p.payment_date)} · {p.method}</div>
                        {p.notes && <div style={{ fontSize: 11, color: '#546e7a', marginTop: 2 }}>{p.notes}</div>}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#2e7d32' }}>{fmtMoney(Number(p.amount))}</div>
                    </div>
                  </div>
                ))}
                <div style={{ background: 'white', borderRadius: 10, border: '1px solid #c8e6c9', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#2e7d32', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Total Paid</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#2e7d32' }}>{fmtMoney(totalPaid)}</span>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
