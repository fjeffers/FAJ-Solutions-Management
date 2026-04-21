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
  { id: 'prep-1',    category: 'Prep',    label: 'Review work order details',            completed: false, completed_at: null },
  { id: 'prep-2',    category: 'Prep',    label: 'Confirm schedule with site contact',   completed: false, completed_at: null },
  { id: 'prep-3',    category: 'Prep',    label: 'Gather required tools and materials',  completed: false, completed_at: null },
  { id: 'onsite-1',  category: 'On Site', label: 'Check in with site contact',           completed: false, completed_at: null },
  { id: 'onsite-2',  category: 'On Site', label: 'Complete scope of work',               completed: false, completed_at: null },
  { id: 'onsite-3',  category: 'On Site', label: 'Test all installed equipment',         completed: false, completed_at: null },
  { id: 'onsite-4',  category: 'On Site', label: 'Clean up work area',                  completed: false, completed_at: null },
  { id: 'post-1',    category: 'Post',    label: 'Document all work completed',          completed: false, completed_at: null },
  { id: 'post-2',    category: 'Post',    label: 'Collect customer signature',           completed: false, completed_at: null },
  { id: 'post-3',    category: 'Post',    label: 'Submit deliverables',                  completed: false, completed_at: null },
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
  const [tasks, setTasks]                 = useState<WoTask[]>(() =>
    wo.wo_tasks && wo.wo_tasks.length > 0 ? wo.wo_tasks : DEFAULT_TASKS
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
    Prep: '#b45309', 'On Site': '#0D7377', Post: '#4338ca',
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
        style={{ background: 'linear-gradient(135deg, #0d2d4a 0%, #1a5276 100%)', cursor: 'pointer', padding: '14px 16px' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#c8a84b', fontFamily: 'monospace', letterSpacing: 0.5 }}>{wo.wo_number}</span>
              <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
              {activeLog && (
                <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(249,115,22,0.25)', color: '#fb8c00' }}>
                  ● Clocked In
                </span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'white', lineHeight: 1.3, marginBottom: 7 }}>
              {wo.title || wo.service_type || 'Work Order'}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {(wo.site_city || wo.site_state) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                  <MapPin size={10} color="rgba(255,255,255,0.4)" />
                  {[wo.site_name, wo.site_city, wo.site_state].filter(Boolean).join(', ')}
                </span>
              )}
              {wo.start_date && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                  <Clock size={10} color="rgba(255,255,255,0.4)" />
                  {fmtDate(wo.start_date)}{wo.start_time && ` · ${wo.start_time}`}
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'white' }}>{fmtMoney(Number(wo.total_amount))}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>{wo.pay_type}</div>
            {tasks.length > 0 && (
              <div style={{ marginTop: 6, display: 'inline-block', background: 'rgba(255,255,255,0.12)', borderRadius: 20, padding: '2px 9px', fontSize: 10, fontWeight: 700, color: completedCt === tasks.length ? '#86efac' : 'rgba(255,255,255,0.65)' }}>
                {completedCt}/{tasks.length} tasks
              </div>
            )}
            <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.35)', display: 'flex', justifyContent: 'flex-end' }}>
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </div>
          </div>
        </div>
      </div>

      {/* ── STATUS STRIP ── */}
      {expanded && (
        <div style={{ background: 'white', borderLeft: `4px solid ${cfg.border}`, borderBottom: '1px solid #e0e4ea', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
            {cfg.label}
          </span>
          {activeLog && (
            <span style={{ fontSize: 11, color: '#c2410c', fontWeight: 600 }}>
              ● Clocked in since {fmtDateTime(activeLog.checked_in_at!)}
            </span>
          )}
          {tasks.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 70, height: 4, background: '#e8ecf0', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${taskProgress}%`, background: taskProgress === 100 ? '#43a047' : '#0D7377', borderRadius: 10, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 11, color: '#546e7a', fontWeight: 700 }}>{taskProgress}%</span>
            </div>
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
            <div>
              {/* Schedule + Location row */}
              {(wo.start_date || wo.site_address) && (
                <div style={{ display: 'grid', gridTemplateColumns: (wo.start_date && wo.site_address) ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 10 }}>
                  {wo.start_date && (
                    <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 4, background: '#e3f2fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>📅</span>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Schedule</span>
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0d2d4a' }}>{fmtDate(wo.start_date)}</div>
                        {wo.start_time && <div style={{ fontSize: 13, color: '#1a5276', fontWeight: 600, marginTop: 2 }}>{wo.start_time}</div>}
                      </div>
                    </div>
                  )}
                  {wo.site_address && (
                    <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 4, background: '#e0f2f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>📍</span>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Location</span>
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        {wo.site_name && <div style={{ fontSize: 13, fontWeight: 700, color: '#0d2d4a', marginBottom: 2 }}>{wo.site_name}</div>}
                        <div style={{ fontSize: 12, color: '#37474f' }}>{wo.site_address}</div>
                        {(wo.site_city || wo.site_state) && (
                          <div style={{ fontSize: 12, color: '#546e7a' }}>{[wo.site_city, wo.site_state, wo.site_zip].filter(Boolean).join(', ')}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pay card */}
              <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: '#fffde7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>💰</span>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Pay</span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#90a4ae', marginBottom: 2 }}>{wo.pay_type || 'Pay type'}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#2e7d32' }}>{fmtMoney(Number(wo.total_amount))}</div>
                  </div>
                  <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                </div>
              </div>

              {/* Scope of work */}
              {wo.description && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: '#e3f2fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>📋</span>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Scope of Work</span>
                  </div>
                  <div style={{ padding: '10px 12px', fontSize: 13, color: '#37474f', lineHeight: 1.6 }}>{wo.description}</div>
                </div>
              )}

              {/* Required skills */}
              {wo.required_skills && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Required Skills</span>
                  </div>
                  <div style={{ padding: '10px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {wo.required_skills.split(',').map((s) => s.trim()).filter(Boolean).map((skill) => (
                      <span key={skill} style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, background: '#e3f2fd', color: '#1565c0', fontWeight: 600 }}>{skill}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Deliverables */}
              {deliverableLines.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Deliverables</span>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    {deliverableLines.map((line, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                        <CheckCircle2 size={14} color={isComplete ? '#43a047' : '#ccc'} style={{ marginTop: 2, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: '#37474f' }}>{line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Submissions */}
              {submissions.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Your Submissions</span>
                  </div>
                  <div style={{ padding: '8px 12px' }}>
                    {submissions.map((sub) => (
                      <div key={sub.id} style={{ padding: '8px 10px', background: '#f0fdf4', borderRadius: 6, marginBottom: 6, borderLeft: '3px solid #43a047' }}>
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
              )}

              {!wo.description && !wo.site_address && !wo.required_skills && deliverableLines.length === 0 && submissions.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#b0bec5', fontSize: 13 }}>No details added yet</div>
              )}
            </div>
          )}

          {/* ── TASKS ── */}
          {activeSection === 'tasks' && (
            <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✅</span>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Task Checklist</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: completedCt === tasks.length ? '#2e7d32' : '#90a4ae' }}>
                  {completedCt} / {tasks.length} complete
                </span>
              </div>
              <div style={{ padding: '8px 12px 12px' }}>
                {(['Prep', 'On Site', 'Post'] as const).map((cat) => {
                  const catTasks = tasks.filter((t) => t.category === cat);
                  const catDone  = catTasks.filter((t) => t.completed).length;
                  return (
                    <div key={cat} style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: catColor[cat], letterSpacing: 0.5, textTransform: 'uppercase' as const }}>{cat}</span>
                        <span style={{ fontSize: 10, color: '#90a4ae' }}>{catDone}/{catTasks.length}</span>
                      </div>
                      {catTasks.map((task) => (
                        <button
                          key={task.id}
                          onClick={() => handleTaskToggle(task.id)}
                          disabled={!isEditable}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '8px 10px', marginBottom: 4, borderRadius: 8, textAlign: 'left',
                            background: task.completed ? 'rgba(67,160,71,0.06)' : '#fafafa',
                            border: `1px solid ${task.completed ? 'rgba(67,160,71,0.2)' : '#e8ecf0'}`,
                            cursor: isEditable ? 'pointer' : 'default',
                          }}
                        >
                          {/* FN-style circle dot */}
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                            border: task.completed ? 'none' : '2px solid #cfd8dc',
                            background: task.completed ? '#43a047' : 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {task.completed && <Check size={11} color="white" strokeWidth={3} />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: task.completed ? '#90a4ae' : '#1a1a2e', textDecoration: task.completed ? 'line-through' : 'none', fontWeight: 500 }}>
                              {task.label}
                            </div>
                            {task.completed && task.completed_at && (
                              <div style={{ fontSize: 10, color: '#b0bec5', marginTop: 1 }}>{fmtDateTime(task.completed_at)}</div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── TIME LOG ── */}
          {activeSection === 'timelog' && (
            <div>
              {activeLog ? (
                <div style={{ background: 'white', border: '1px solid #ffd180', borderLeft: '4px solid #fb8c00', borderRadius: 8, padding: '14px', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e65100', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 4 }}>Currently Clocked In</div>
                  <div style={{ fontSize: 14, color: '#333', marginBottom: 12 }}>Since {fmtDateTime(activeLog.checked_in_at!)}</div>
                  <button onClick={handleCheckOut} disabled={clocking}
                    style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#e65100', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    {clocking ? 'Clocking Out...' : 'Clock Out'}
                  </button>
                </div>
              ) : isEditable ? (
                <button onClick={handleCheckIn} disabled={clocking} className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginBottom: 12, fontSize: 14 }}>
                  <Timer size={14} />{clocking ? 'Clocking In...' : 'Clock In'}
                </button>
              ) : null}

              {pastLogs.length > 0 ? (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Time Log</span>
                  </div>
                  <div style={{ padding: '6px 12px 10px' }}>
                    {pastLogs.map((log) => (
                      <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f4f8' }}>
                        <div>
                          <div style={{ fontSize: 12, color: '#333', fontWeight: 600 }}>{fmtDateTime(log.checked_in_at!)}</div>
                          <div style={{ fontSize: 11, color: '#90a4ae', marginTop: 1 }}>to {fmtDateTime(log.checked_out_at!)}</div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0D7377' }}>{calcDuration(log.checked_in_at!, log.checked_out_at!)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : !activeLog && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#b0bec5', fontSize: 13 }}>No time logged yet</div>
              )}
            </div>
          )}

          {/* ── FILES ── */}
          {activeSection === 'files' && (
            <div>
              {isEditable && (
                <>
                  {/* hidden inputs — camera, vendor docs */}
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileChange} />
                  <input ref={fileInputRef}   type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={handleFileChange} />
                  <input ref={vendorInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={handleFileChange} />
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button onClick={() => cameraInputRef.current?.click()} disabled={uploading}
                      style={{ flex: 1, padding: '12px 8px', border: '2px dashed #0D7377', borderRadius: 8, background: 'rgba(13,115,119,0.04)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#0D7377', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Camera size={15} />{uploading ? 'Uploading…' : 'Take Site Photo'}
                    </button>
                    <button onClick={() => vendorInputRef.current?.click()} disabled={uploading}
                      style={{ flex: 1, padding: '12px 8px', border: '2px dashed #cfd8dc', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#546e7a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Upload size={14} />Vendor Doc
                    </button>
                  </div>
                </>
              )}
              {uploadedFiles.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #c8e6c9', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ background: '#f0fdf4', borderBottom: '1px solid #c8e6c9', padding: '7px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#2e7d32' }}>Ready to Submit ({uploadedFiles.length})</span>
                  </div>
                  <div style={{ padding: '8px 12px' }}>
                    {uploadedFiles.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, background: '#f0fdf4', marginBottom: 4, fontSize: 12, color: '#1565c0', textDecoration: 'none' }}>
                        <Paperclip size={11} /> File {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {allPrevFiles.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Previously Submitted</span>
                  </div>
                  <div style={{ padding: '8px 12px' }}>
                    {allPrevFiles.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, background: '#fafafa', marginBottom: 4, fontSize: 12, color: '#546e7a', textDecoration: 'none' }}>
                        <Paperclip size={11} color="#90a4ae" /> Submission File {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {uploadedFiles.length === 0 && allPrevFiles.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#b0bec5', fontSize: 13 }}>No files uploaded yet</div>
              )}
            </div>
          )}

          {/* ── CONTACTS / Q&A ── */}
          {activeSection === 'qa' && (
            <div>
              {wo.attachment_url && (
                <a href={wo.attachment_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, padding: '12px', borderRadius: 8, textDecoration: 'none', background: 'white', border: '1px solid rgba(200,168,75,0.4)', borderLeft: '4px solid #c8a84b' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(200,168,75,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Paperclip size={16} color="#b8944a" />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b8944a', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 1 }}>Vendor Paperwork</div>
                    <div style={{ fontSize: 13, color: '#333', fontWeight: 600 }}>Tap to open & download →</div>
                  </div>
                </a>
              )}

              {(wo.poc_name || wo.poc_phone || wo.poc_email || wo.support_contact) && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: '#f3e5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>📞</span>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Site Contacts</span>
                  </div>
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {wo.poc_name && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e8ecf0' }}>
                        <span style={{ fontSize: 10, color: '#90a4ae', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>POC Name</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{wo.poc_name}</span>
                      </div>
                    )}
                    {wo.poc_phone && (
                      <a href={`tel:${wo.poc_phone}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: '#f0f9ff', border: '1px solid #bfdbfe', textDecoration: 'none' }}>
                        <span style={{ fontSize: 10, color: '#90a4ae', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Phone</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1565c0' }}>{wo.poc_phone} →</span>
                      </a>
                    )}
                    {wo.poc_email && (
                      <a href={`mailto:${wo.poc_email}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: '#f0f9ff', border: '1px solid #bfdbfe', textDecoration: 'none' }}>
                        <span style={{ fontSize: 10, color: '#90a4ae', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Email</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1565c0' }}>{wo.poc_email} →</span>
                      </a>
                    )}
                    {wo.support_contact && (
                      <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(200,168,75,0.08)', border: '1px solid rgba(200,168,75,0.25)' }}>
                        <div style={{ fontSize: 10, color: '#b8944a', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 3 }}>Support Contact</div>
                        <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5 }}>{wo.support_contact}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {qaItems.length > 0 && (
                <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Questions — fill in on site</span>
                  </div>
                  <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {qaItems.map((q) => (
                      <div key={q.id}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>{q.label}</div>
                        {q.type === 'yes_no' ? (
                          <div style={{ display: 'flex', gap: 8 }}>
                            {(['Yes', 'No'] as const).map((opt) => (
                              <button key={opt} onClick={() => handleQAAnswer(q.id, opt)}
                                style={{ flex: 1, padding: '11px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                                  background: q.answer === opt ? (opt === 'Yes' ? '#2e7d32' : '#b91c1c') : '#f5f5f5',
                                  color: q.answer === opt ? 'white' : '#666' }}>
                                {opt}
                              </button>
                            ))}
                          </div>
                        ) : q.type === 'textarea' ? (
                          <textarea value={q.answer ?? ''} onChange={(e) => setQaItems((qs) => qs.map((item) => item.id === q.id ? { ...item, answer: e.target.value } : item))} onBlur={(e) => handleQAAnswer(q.id, e.target.value)} placeholder="Enter answer..."
                            style={{ width: '100%', minHeight: 80, padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e0e4ea', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                        ) : q.type === 'photo' ? (
                          <>
                            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleQAPhoto} />
                            {q.answer ? (
                              <div style={{ position: 'relative' }}>
                                <img src={q.answer} alt="Site photo" style={{ width: '100%', borderRadius: 8, border: '1px solid #e0e4ea', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
                                <button onClick={() => { activePhotoQaId.current = q.id; photoInputRef.current?.click(); }}
                                  style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 6, color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}>
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
                <div style={{ textAlign: 'center', padding: '28px 0', color: '#b0bec5', fontSize: 13 }}>No contacts on this work order</div>
              )}
            </div>
          )}

          {/* ── SIGN OFF ── */}
          {activeSection === 'signoff' && (
            <div style={{ background: 'white', border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e0e4ea', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✍️</span>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#546e7a' }}>Customer Sign Off</span>
                {woSignature && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#2e7d32' }}>✓ Signed</span>}
              </div>
              <div style={{ padding: '12px' }}>
                {woSignature ? (
                  <div>
                    <div style={{ border: '1px solid #e0e4ea', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                      <img src={woSignature.signature_data} alt="Signature" style={{ width: '100%', display: 'block' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#546e7a' }}>
                      <span>{woSignature.signer_name || 'Signed'}</span>
                      <span style={{ color: '#90a4ae' }}>{fmtDateTime(woSignature.signed_at)}</span>
                    </div>
                  </div>
                ) : isEditable ? (
                  showSigPad ? (
                    <SignaturePad onSave={handleSaveSignature} onCancel={() => setShowSigPad(false)} />
                  ) : (
                    <div>
                      <div style={{ fontSize: 13, color: '#546e7a', marginBottom: 12, lineHeight: 1.5 }}>
                        Capture a customer or supervisor signature to confirm work completion.
                      </div>
                      <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Signer name (optional)" className="input" style={{ marginBottom: 10 }} />
                      <button onClick={() => setShowSigPad(true)} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}>
                        <PenLine size={13} /> Open Signature Pad
                      </button>
                    </div>
                  )
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#b0bec5', fontSize: 13 }}>No signature collected</div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── FOOTER ACTIONS ── */}
      {expanded && isEditable && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid #e0e4ea', background: 'white' }}>
          {wo.wo_status === 'Assigned' && (
            <button onClick={handleStartJob} disabled={updating} className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', fontSize: 14 }}>
              {updating ? 'Updating...' : 'Start Job'}
            </button>
          )}
          {wo.wo_status === 'In Progress' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#90a4ae', letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8 }}>Closeout Notes</div>
              <textarea value={closeoutNotes} onChange={(e) => setCloseoutNotes(e.target.value)}
                placeholder="Summarize work completed, issues found, equipment installed..."
                style={{ width: '100%', minHeight: 72, padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e0e4ea', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 10 }} />
              <button onClick={handleSubmitForReview} disabled={submitting} className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: 14 }}>
                <Send size={14} />{submitting ? 'Submitting...' : 'Submit for Review'}
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

      {/* ── Content ── */}
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
