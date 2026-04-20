'use client';
import { useState, useRef } from 'react';
import {
  MapPin, Clock, DollarSign, ChevronDown, ChevronUp,
  LogOut, Sparkles, AlertCircle, ListChecks, Timer,
  Paperclip, PenLine, FileText, Upload, CheckCircle2,
  Send, Check,
} from 'lucide-react';
import { fmtMoney, fmtDate } from '@/lib/utils';
import type { Contractor, WorkOrder, Payment, DeliverableSubmission, TimeLog, Signature, WoTask, CustomQAItem } from '@/lib/types';
import SignaturePad from './SignaturePad';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string }> = {
  'Open':        { bg: 'rgba(13,115,119,0.12)', color: '#0D7377', label: 'Open' },
  'Assigned':    { bg: 'rgba(245,158,11,0.15)', color: '#b45309', label: 'Assigned' },
  'In Progress': { bg: 'rgba(249,115,22,0.15)', color: '#c2410c', label: 'In Progress' },
  'Work Done':   { bg: 'rgba(99,102,241,0.15)', color: '#4338ca', label: 'Work Done' },
  'Approved':    { bg: 'rgba(16,185,129,0.15)', color: '#047857', label: 'Approved' },
  'Paid':        { bg: 'rgba(5,150,105,0.2)',   color: '#065f46', label: 'Paid' },
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
  const [expanded, setExpanded]         = useState(false);
  const [activeSection, setActiveSection] = useState<WOSection>('overview');
  const [tasks, setTasks]               = useState<WoTask[]>(() =>
    wo.wo_tasks && wo.wo_tasks.length > 0 ? wo.wo_tasks : DEFAULT_TASKS
  );
  const [signerName, setSignerName]     = useState('');
  const [showSigPad, setShowSigPad]     = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [uploading, setUploading]       = useState(false);
  const [closeoutNotes, setCloseoutNotes] = useState('');
  const [updating, setUpdating]         = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [clocking, setClocking]         = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    Prep: '#b45309', 'On Site': 'var(--teal)', Post: '#4338ca',
  };

  // Section tab labels
  const hasSiteInfo = !!(wo.poc_name || wo.poc_phone || wo.poc_email || wo.support_contact || (wo.custom_qa && wo.custom_qa.length > 0));
  const SECTIONS_DATA: { id: WOSection; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(hasSiteInfo ? [{ id: 'qa' as WOSection, label: 'Questions' }] : []),
    { id: 'tasks',    label: `Tasks ${completedCt}/${tasks.length}` },
    { id: 'timelog',  label: 'Time' },
    { id: 'files',    label: uploadedFiles.length + allPrevFiles.length > 0 ? `Files (${uploadedFiles.length + allPrevFiles.length})` : 'Files' },
    { id: 'signoff',  label: woSignature ? 'Signed \u2713' : 'Sign Off' },
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
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    <div style={{
      background: 'white', borderRadius: 16, overflow: 'hidden', marginBottom: 16,
      boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
      border: isComplete ? '1.5px solid rgba(16,185,129,0.25)' : '1.5px solid rgba(13,115,119,0.1)',
    }}>

      {/* ── Card Header (always visible, tap to expand) ── */}
      <div style={{ padding: '16px 18px 14px', cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', fontFamily: 'monospace' }}>{wo.wo_number}</span>
              <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
              {activeLog && (
                <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(249,115,22,0.15)', color: '#c2410c' }}>
                  {'\u25cf'} Clocked In
                </span>
              )}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.3 }}>
              {wo.title || wo.service_type || 'Work Order'}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              {(wo.site_city || wo.site_state) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#666' }}>
                  <MapPin size={11} color="#bbb" />
                  {[wo.site_name, wo.site_city, wo.site_state].filter(Boolean).join(', ')}
                </span>
              )}
              {wo.start_date && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#666' }}>
                  <Clock size={11} color="#bbb" />
                  {fmtDate(wo.start_date)}
                  {wo.start_time && <span style={{ color: '#aaa' }}>{'\u00b7'} {wo.start_time}</span>}
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>{fmtMoney(Number(wo.total_amount))}</div>
            <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>{wo.pay_type}</div>
            <div style={{ marginTop: 8, color: '#bbb', display: 'flex', justifyContent: 'flex-end' }}>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </div>
        </div>
      </div>

      {/* ── Task Progress Bar (shown when expanded) ── */}
      {expanded && (
        <div style={{ padding: '0 18px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#aaa', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Task Progress</span>
            <span style={{ fontWeight: 700 }}>{taskProgress}%</span>
          </div>
          <div style={{ height: 5, background: '#f0f0f0', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${taskProgress}%`,
              background: taskProgress === 100 ? '#047857' : 'var(--teal)',
              borderRadius: 10, transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {/* ── Section Tabs ── */}
      {expanded && (
        <div style={{ display: 'flex', borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0', overflowX: 'auto', background: '#fafafa' }}>
          {SECTIONS_DATA.map((sec) => (
            <button
              key={sec.id}
              onClick={(e) => { e.stopPropagation(); setActiveSection(sec.id); }}
              style={{
                flex: '0 0 auto', padding: '10px 14px', border: 'none', cursor: 'pointer',
                background: activeSection === sec.id ? 'white' : 'transparent',
                fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                color: activeSection === sec.id ? 'var(--teal)' : '#999',
                borderBottom: activeSection === sec.id ? '2px solid var(--teal)' : '2px solid transparent',
              }}
            >
              {sec.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Section Content ── */}
      {expanded && (
        <div style={{ padding: '16px 18px' }}>

          {/* OVERVIEW */}
          {activeSection === 'overview' && (
            <div>
              {wo.description && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Scope of Work</div>
                  <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{wo.description}</div>
                </div>
              )}
              {wo.site_address && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Site Address</div>
                  <div style={{ fontSize: 13, color: '#444' }}>
                    {wo.site_address}<br />
                    {[wo.site_city, wo.site_state, wo.site_zip].filter(Boolean).join(', ')}
                  </div>
                </div>
              )}
              {wo.required_skills && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Required Skills</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {wo.required_skills.split(',').map((s) => s.trim()).filter(Boolean).map((skill) => (
                      <span key={skill} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: 'rgba(13,115,119,0.08)', color: 'var(--teal)', fontWeight: 600 }}>{skill}</span>
                    ))}
                  </div>
                </div>
              )}
              {deliverableLines.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Deliverables</div>
                  {deliverableLines.map((line, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                      <CheckCircle2 size={14} color={isComplete ? '#047857' : '#ccc'} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#444' }}>{line}</span>
                    </div>
                  ))}
                </div>
              )}
              {submissions.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Your Submissions</div>
                  {submissions.map((sub) => (
                    <div key={sub.id} style={{ padding: '10px 12px', background: 'rgba(13,115,119,0.04)', borderRadius: 8, marginBottom: 6, borderLeft: '3px solid var(--teal)' }}>
                      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>{fmtDateTime(sub.submitted_at)}</div>
                      {sub.notes && <div style={{ fontSize: 13, color: '#333', marginBottom: sub.file_urls?.length ? 6 : 0 }}>{sub.notes}</div>}
                      {sub.file_urls?.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--teal)', marginTop: 4, textDecoration: 'none' }}>
                          <Paperclip size={10} /> File {i + 1}
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {!wo.description && !wo.site_address && !wo.required_skills && deliverableLines.length === 0 && submissions.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#ccc', fontSize: 13 }}>No details added yet</div>
              )}
            </div>
          )}

          {/* TASKS */}
          {activeSection === 'tasks' && (
            <div>
              {(['Prep', 'On Site', 'Post'] as const).map((cat) => {
                const catTasks   = tasks.filter((t) => t.category === cat);
                const catDone    = catTasks.filter((t) => t.completed).length;
                return (
                  <div key={cat} style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: catColor[cat], letterSpacing: 0.5, textTransform: 'uppercase' }}>{cat}</span>
                      <span style={{ fontSize: 11, color: '#aaa' }}>{catDone}/{catTasks.length}</span>
                    </div>
                    {catTasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => handleTaskToggle(task.id)}
                        disabled={!isEditable}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '10px 12px', marginBottom: 4, borderRadius: 8, textAlign: 'left',
                          background: task.completed ? 'rgba(4,120,87,0.06)' : '#fafafa',
                          border: task.completed ? '1px solid rgba(4,120,87,0.15)' : '1px solid #f0f0f0',
                          cursor: isEditable ? 'pointer' : 'default',
                        }}
                      >
                        <div style={{
                          width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                          border: task.completed ? '2px solid #047857' : '2px solid #ddd',
                          background: task.completed ? '#047857' : 'white',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {task.completed && <Check size={11} color="white" strokeWidth={3} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: task.completed ? '#999' : '#333', textDecoration: task.completed ? 'line-through' : 'none' }}>
                            {task.label}
                          </div>
                          {task.completed && task.completed_at && (
                            <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{fmtDateTime(task.completed_at)}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* TIME LOG */}
          {activeSection === 'timelog' && (
            <div>
              {activeLog ? (
                <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(249,115,22,0.08)', border: '1.5px solid rgba(249,115,22,0.2)', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
                    Currently Clocked In
                  </div>
                  <div style={{ fontSize: 14, color: '#333', marginBottom: 12 }}>
                    Since {fmtDateTime(activeLog.checked_in_at!)}
                  </div>
                  <button
                    onClick={handleCheckOut}
                    disabled={clocking}
                    style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#c2410c', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                  >
                    {clocking ? 'Clocking Out...' : 'Clock Out'}
                  </button>
                </div>
              ) : isEditable ? (
                <button
                  onClick={handleCheckIn}
                  disabled={clocking}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginBottom: 16, fontSize: 14 }}
                >
                  <Timer size={14} />
                  {clocking ? 'Clocking In...' : 'Clock In'}
                </button>
              ) : null}

              {pastLogs.length > 0 ? (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Time Log</div>
                  {pastLogs.map((log) => (
                    <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: '#fafafa', border: '1px solid #f0f0f0', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#333', fontWeight: 600 }}>{fmtDateTime(log.checked_in_at!)}</div>
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>to {fmtDateTime(log.checked_out_at!)}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>
                        {calcDuration(log.checked_in_at!, log.checked_out_at!)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : !activeLog && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#ccc', fontSize: 13 }}>No time logged yet</div>
              )}
            </div>
          )}

          {/* FILES */}
          {activeSection === 'files' && (
            <div>
              {isEditable && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{
                      width: '100%', padding: '12px', border: '2px dashed #e5e7eb',
                      borderRadius: 10, background: '#fafafa', cursor: 'pointer',
                      fontSize: 13, color: '#888', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
                    }}
                  >
                    <Upload size={14} />
                    {uploading ? 'Uploading...' : 'Upload Photo or File'}
                  </button>
                </>
              )}

              {uploadedFiles.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#047857', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                    Ready to Submit ({uploadedFiles.length})
                  </div>
                  {uploadedFiles.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: 'rgba(4,120,87,0.06)', border: '1px solid rgba(4,120,87,0.15)', marginBottom: 4, fontSize: 12, color: 'var(--teal)', textDecoration: 'none' }}>
                      <Paperclip size={11} /> File {i + 1}
                    </a>
                  ))}
                </div>
              )}

              {allPrevFiles.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Previously Submitted</div>
                  {allPrevFiles.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: '#fafafa', border: '1px solid #f0f0f0', marginBottom: 4, fontSize: 12, color: '#555', textDecoration: 'none' }}>
                      <Paperclip size={11} color="#aaa" /> Submission File {i + 1}
                    </a>
                  ))}
                </div>
              )}

              {uploadedFiles.length === 0 && allPrevFiles.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#ccc', fontSize: 13 }}>No files uploaded yet</div>
              )}
            </div>
          )}

          {/* Q&A / SITE INFO */}
          {activeSection === 'qa' && (
            <div>
              {/* POC Contact Cards */}
              {(wo.poc_name || wo.poc_phone || wo.poc_email || wo.support_contact) && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Site Contacts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {wo.poc_name && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: '#fafafa', border: '1px solid #f0f0f0' }}>
                        <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>POC Name</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{wo.poc_name}</span>
                      </div>
                    )}
                    {wo.poc_phone && (
                      <a href={`tel:${wo.poc_phone}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: 'rgba(13,115,119,0.05)', border: '1px solid rgba(13,115,119,0.12)', textDecoration: 'none' }}>
                        <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Phone</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>{wo.poc_phone} →</span>
                      </a>
                    )}
                    {wo.poc_email && (
                      <a href={`mailto:${wo.poc_email}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: 'rgba(13,115,119,0.05)', border: '1px solid rgba(13,115,119,0.12)', textDecoration: 'none' }}>
                        <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>{wo.poc_email} →</span>
                      </a>
                    )}
                    {wo.support_contact && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.2)' }}>
                        <div style={{ fontSize: 11, color: '#b8944a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Support Contact</div>
                        <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5 }}>{wo.support_contact}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Custom Q&A */}
              {qaItems.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
                    Questions — fill in on site
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {qaItems.map((q) => (
                      <div key={q.id}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>
                          {q.label}
                        </div>
                        {q.type === 'yes_no' ? (
                          <div style={{ display: 'flex', gap: 8 }}>
                            {(['Yes', 'No'] as const).map((opt) => (
                              <button
                                key={opt}
                                onClick={() => handleQAAnswer(q.id, opt)}
                                style={{
                                  flex: 1, padding: '11px', border: 'none', borderRadius: 10, cursor: 'pointer',
                                  fontWeight: 700, fontSize: 14, transition: 'all 0.15s',
                                  background: q.answer === opt
                                    ? (opt === 'Yes' ? '#047857' : '#b91c1c')
                                    : '#f5f5f5',
                                  color: q.answer === opt ? 'white' : '#666',
                                  boxShadow: q.answer === opt ? '0 3px 10px rgba(0,0,0,0.15)' : 'none',
                                }}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        ) : q.type === 'textarea' ? (
                          <textarea
                            value={q.answer ?? ''}
                            onChange={(e) => setQaItems((qs) => qs.map((item) => item.id === q.id ? { ...item, answer: e.target.value } : item))}
                            onBlur={(e) => handleQAAnswer(q.id, e.target.value)}
                            placeholder="Enter answer..."
                            style={{
                              width: '100%', minHeight: 90, padding: '10px 12px', borderRadius: 10,
                              border: '1.5px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit',
                              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                              color: q.answer ? '#1a1a1a' : '#aaa',
                            }}
                          />
                        ) : (
                          <input
                            type={q.type === 'number' ? 'number' : 'text'}
                            value={q.answer ?? ''}
                            onChange={(e) => setQaItems((qs) => qs.map((item) => item.id === q.id ? { ...item, answer: e.target.value } : item))}
                            onBlur={(e) => handleQAAnswer(q.id, e.target.value)}
                            placeholder="Enter answer..."
                            style={{
                              width: '100%', padding: '11px 14px', borderRadius: 10,
                              border: '1.5px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit',
                              outline: 'none', boxSizing: 'border-box',
                              color: q.answer ? '#1a1a1a' : '#aaa',
                            }}
                          />
                        )}
                        {q.answer && (
                          <div style={{ fontSize: 10, color: '#047857', marginTop: 4, fontWeight: 700 }}>✓ Saved</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasSiteInfo && (
                <div style={{ textAlign: 'center', padding: '28px 0', color: '#ccc', fontSize: 13 }}>
                  No questions or contacts on this work order
                </div>
              )}
            </div>
          )}

          {/* SIGN OFF */}
          {activeSection === 'signoff' && (
            <div>
              {woSignature ? (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#047857', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Signed</div>
                  <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
                    <img src={woSignature.signature_data} alt="Signature" style={{ width: '100%', display: 'block' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                    <span>{woSignature.signer_name || 'Signed'}</span>
                    <span style={{ color: '#aaa' }}>{fmtDateTime(woSignature.signed_at)}</span>
                  </div>
                </div>
              ) : isEditable ? (
                showSigPad ? (
                  <SignaturePad
                    onSave={handleSaveSignature}
                    onCancel={() => setShowSigPad(false)}
                  />
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 14, lineHeight: 1.5 }}>
                      Capture a customer or supervisor signature to confirm work completion.
                    </div>
                    <input
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Signer name (optional)"
                      className="input"
                      style={{ marginBottom: 10 }}
                    />
                    <button
                      onClick={() => setShowSigPad(true)}
                      className="btn btn-primary"
                      style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
                    >
                      <PenLine size={13} /> Open Signature Pad
                    </button>
                  </div>
                )
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#ccc', fontSize: 13 }}>No signature collected</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Footer Actions ── */}
      {expanded && isEditable && (
        <div style={{ padding: '14px 18px', borderTop: '1px solid #f0f0f0' }}>
          {wo.wo_status === 'Assigned' && (
            <button
              onClick={handleStartJob}
              disabled={updating}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', fontSize: 14 }}
            >
              {updating ? 'Updating...' : 'Start Job'}
            </button>
          )}

          {wo.wo_status === 'In Progress' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Closeout Notes
              </div>
              <textarea
                value={closeoutNotes}
                onChange={(e) => setCloseoutNotes(e.target.value)}
                placeholder="Summarize work completed, issues found, equipment installed..."
                style={{
                  width: '100%', minHeight: 80, padding: '10px 12px', borderRadius: 10,
                  border: '1.5px solid #e5e7eb', fontSize: 13, fontFamily: 'inherit',
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: 10,
                }}
              />
              <button
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: 14 }}
              >
                <Send size={14} />
                {submitting ? 'Submitting...' : 'Submit for Review'}
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
  onUploadFile, onSubmitForReview, onLogout,
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', maxWidth: 640, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', padding: '20px 20px 24px', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="var(--gold-light)" />
            <span className="display" style={{ fontSize: 11, color: 'var(--gold-light)', fontWeight: 700, letterSpacing: 2 }}>FAJ SOLUTIONS</span>
          </div>
          <button
            onClick={onLogout}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            <LogOut size={12} /> Sign Out
          </button>
        </div>

        <div className="serif" style={{ fontSize: 28, fontWeight: 600, color: 'white', marginBottom: 2 }}>
          {contractor.name}
        </div>
        {contractor.business_name && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 4 }}>{contractor.business_name}</div>
        )}

        {/* Summary pills */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.