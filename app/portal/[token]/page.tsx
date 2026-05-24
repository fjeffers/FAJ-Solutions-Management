import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import AcknowledgeButton from './AcknowledgeButton';
import PortalStatusButton from './PortalStatusButton';
import type { WorkOrder, Contractor } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type PortalData = {
  contractor: Contractor;
  work_orders: WorkOrder[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  const [y, m, day] = d.split('T')[0].split('-');
  return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtTime(t: string | null | undefined) {
  if (!t) return null;
  const [h, m] = t.split(':');
  const hour = Number(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function statusBadge(wo: WorkOrder) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    Open:          { bg: 'rgba(156,163,175,0.2)',  color: '#4B5563', label: 'Pending' },
    Assigned:      { bg: 'rgba(59,130,246,0.15)',  color: '#1D4ED8', label: 'Assigned' },
    'In Progress': { bg: 'rgba(245,158,11,0.15)',  color: '#B45309', label: 'In Progress' },
    'Work Done':   { bg: 'rgba(16,185,129,0.15)',  color: '#047857', label: 'Work Done' },
    Approved:      { bg: 'rgba(13,115,119,0.15)',  color: '#0D7377', label: 'Approved' },
  };
  const s = map[wo.wo_status] ?? map['Open'];
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color, letterSpacing: 0.3,
    }}>
      {s.label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  // Next.js 15+ — params is a Promise and must be awaited
  const { token } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.rpc('get_portal_data', { p_token: token });
  if (error || !data) return notFound();

  const { contractor, work_orders } = data as PortalData;

  // ── Server action: contractor acknowledges a WO ──
  async function handleAcknowledge(woId: string) {
    'use server';
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await sb.rpc('acknowledge_work_order', { p_wo_id: woId, p_token: token });

    // Notify Fred that the contractor accepted
    const wo = work_orders.find((w) => w.id === woId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    try {
      await fetch(`${baseUrl}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'contractor_accepted',
          contractor_name: contractor.name,
          wo_number: wo?.wo_number ?? woId,
          title: wo?.title ?? null,
        }),
      });
    } catch { /* non-blocking — don't fail the acknowledge if email errors */ }

    revalidatePath(`/portal/${token}`);
  }

  // ── Server action: contractor updates WO status ──
  async function handleStatusUpdate(woId: string, status: string) {
    'use server';
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await sb.rpc('update_portal_wo_status', { p_wo_id: woId, p_token: token, p_status: status });

    // Notify Fred of the status change
    const wo = work_orders.find((w) => w.id === woId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    try {
      await fetch(`${baseUrl}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'contractor_status_update',
          contractor_name: contractor.name,
          wo_number: wo?.wo_number ?? woId,
          title: wo?.title ?? null,
          status,
        }),
      });
    } catch { /* non-blocking */ }

    revalidatePath(`/portal/${token}`);
  }

  const pending   = work_orders.filter((w) => !w.acknowledged_at);
  const accepted  = work_orders.filter((w) =>  w.acknowledged_at);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #f0fafa 0%, #f7f8fa 60%)',
      fontFamily: "'Segoe UI', Arial, Helvetica, sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)',
        padding: '24px 20px 20px',
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div style={{ color: '#C9A961', fontSize: 10, fontWeight: 700, letterSpacing: 3, marginBottom: 4 }}>
            FAJ SOLUTIONS
          </div>
          <div style={{ color: 'white', fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
            Contractor Portal
          </div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>
            Welcome, {contractor.name}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 48px' }}>

        {/* ── Pending / New jobs ── */}
        {pending.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#0D7377', letterSpacing: 2,
              textTransform: 'uppercase', marginBottom: 12,
            }}>
              ⚡ New Jobs — Action Required ({pending.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {pending.map((wo) => (
                <WOCard key={wo.id} wo={wo} token={token}
                  onAcknowledge={handleAcknowledge} onStatusUpdate={handleStatusUpdate} isNew />
              ))}
            </div>
          </div>
        )}

        {/* ── Accepted jobs ── */}
        {accepted.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 2,
              textTransform: 'uppercase', marginBottom: 12,
            }}>
              ✓ Accepted Jobs ({accepted.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {accepted.map((wo) => (
                <WOCard key={wo.id} wo={wo} token={token}
                  onAcknowledge={handleAcknowledge} onStatusUpdate={handleStatusUpdate} isNew={false} />
              ))}
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {work_orders.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            background: 'white', borderRadius: 16, border: '1px solid #e5e7eb',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#333', marginBottom: 6 }}>No active jobs</div>
            <div style={{ fontSize: 13, color: '#888' }}>
              New work orders will appear here when assigned to you.
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 32 }}>
          FAJ Solutions · Questions? Contact your dispatcher.
        </div>
      </div>
    </div>
  );
}

// ─── Work Order Card ──────────────────────────────────────────────────────────

function WOCard({
  wo, token, onAcknowledge, onStatusUpdate, isNew,
}: {
  wo: WorkOrder;
  token: string;
  onAcknowledge: (woId: string) => Promise<void>;
  onStatusUpdate: (woId: string, status: string) => Promise<void>;
  isNew: boolean;
}) {
  const site = [wo.site_address, wo.site_city, wo.site_state, wo.site_zip]
    .filter(Boolean).join(', ');

  const startDate = fmtDate(wo.start_date);
  const startTime = fmtTime(wo.start_time);
  const endTime   = fmtTime(wo.end_time);
  const timeStr   = [startDate, startTime, endTime ? `– ${endTime}` : null].filter(Boolean).join(' · ');

  const deliverableList = wo.deliverables
    ? wo.deliverables.split('\n').filter(Boolean)
    : [];

  return (
    <div style={{
      background: 'white',
      borderRadius: 16,
      border: `2px solid ${isNew ? '#0D7377' : '#e5e7eb'}`,
      overflow: 'hidden',
      boxShadow: isNew ? '0 4px 20px rgba(13,115,119,0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Card header */}
      <div style={{
        padding: '14px 20px',
        background: isNew ? 'rgba(13,115,119,0.06)' : '#fafafa',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#0D7377', fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>
            WO #{wo.wo_number}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>
            {wo.title || `Work Order #${wo.wo_number}`}
          </div>
        </div>
        {statusBadge(wo)}
      </div>

      {/* Card body */}
      <div style={{ padding: '16px 20px' }}>

        {/* Date / time */}
        {timeStr && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📅</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Schedule</div>
              <div style={{ fontSize: 14, color: '#333', fontWeight: 600 }}>{timeStr}</div>
            </div>
          </div>
        )}

        {/* Address */}
        {site && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📍</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Site Address</div>
              <div style={{ fontSize: 14, color: '#333' }}>
                {wo.site_name && <div style={{ fontWeight: 600 }}>{wo.site_name}</div>}
                <div>{[wo.site_address, wo.site_city, wo.site_state].filter(Boolean).join(', ')}</div>
                {wo.site_zip && <div style={{ color: '#888' }}>{wo.site_zip}</div>}
              </div>
              {/* Maps link */}
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(site)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block', marginTop: 6, fontSize: 12, color: '#0D7377',
                  fontWeight: 600, textDecoration: 'none',
                }}
              >
                Open in Maps ↗
              </a>
            </div>
          </div>
        )}

        {/* Description */}
        {wo.description && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📝</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Description</div>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
                {wo.description}
              </div>
            </div>
          </div>
        )}

        {/* Deliverables / checklist */}
        {deliverableList.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>✅</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Deliverables</div>
              <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                {deliverableList.map((d, i) => (
                  <li key={i} style={{ fontSize: 13, color: '#444', marginBottom: 4 }}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Photo requirement */}
        {wo.photo_required && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
            background: 'rgba(245,158,11,0.08)', borderRadius: 10, border: '1px solid rgba(245,158,11,0.2)',
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 16 }}>📷</span>
            <div style={{ fontSize: 13, color: '#92400e', fontWeight: 600 }}>
              Photos required — please document your work on site.
            </div>
          </div>
        )}

        {/* Custom Q&A fields (shows labels only as a reference) */}
        {wo.custom_qa && wo.custom_qa.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📋</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                Required Info on Site
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {wo.custom_qa.map((q) => (
                  <span key={q.id} style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: 'rgba(13,115,119,0.08)', color: '#0D7377',
                  }}>
                    {q.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Access instructions */}
        {wo.access_instructions && (
          <div style={{
            padding: '10px 14px', background: 'rgba(59,130,246,0.06)',
            borderRadius: 10, border: '1px solid rgba(59,130,246,0.12)', marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', marginBottom: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              🔑 Access Instructions
            </div>
            <div style={{ fontSize: 13, color: '#1e3a5f', lineHeight: 1.6 }}>{wo.access_instructions}</div>
          </div>
        )}

        {/* POC */}
        {(wo.poc_name || wo.poc_phone) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>👤</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Point of Contact</div>
              {wo.poc_name  && <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{wo.poc_name}</div>}
              {wo.poc_phone && (
                <a href={`tel:${wo.poc_phone}`} style={{ fontSize: 13, color: '#0D7377', textDecoration: 'none', fontWeight: 600 }}>
                  {wo.poc_phone}
                </a>
              )}
              {wo.poc_email && <div style={{ fontSize: 12, color: '#888' }}>{wo.poc_email}</div>}
            </div>
          </div>
        )}

        {/* Vendor attachment */}
        {wo.attachment_url && (
          <a
            href={wo.attachment_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: 'rgba(201,169,97,0.1)', borderRadius: 10,
              border: '1px solid rgba(201,169,97,0.25)', marginBottom: 16,
              textDecoration: 'none', color: '#b8944a', fontWeight: 600, fontSize: 13,
            }}
          >
            <span>📎</span>
            <span>Download Vendor Paperwork</span>
          </a>
        )}

        {/* ── Acknowledge / status buttons ── */}
        {isNew ? (
          <AcknowledgeButton woId={wo.id} woNumber={wo.wo_number} onAcknowledge={onAcknowledge} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: 'rgba(4,120,87,0.08)', borderRadius: 10,
              border: '1px solid rgba(4,120,87,0.15)', color: '#047857',
              fontSize: 13, fontWeight: 700,
            }}>
              <span>✓</span>
              <span>Accepted{wo.acknowledged_at
                ? ` on ${new Date(wo.acknowledged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : ''
              }</span>
            </div>
            {/* Status progression buttons for accepted WOs */}
            <PortalStatusButton
              woId={wo.id}
              woNumber={wo.wo_number}
              currentStatus={wo.wo_status}
              onStatusUpdate={onStatusUpdate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
