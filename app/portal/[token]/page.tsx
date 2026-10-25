import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import AcknowledgeButton from './AcknowledgeButton';
import PortalStatusButton from './PortalStatusButton';
import PortalTasks from './PortalTasks';
import PortalQA from './PortalQA';
import PortalWorkDoneGate from './PortalWorkDoneGate';
import PortalUpload from './PortalUpload';
import PortalTimeLog from './PortalTimeLog';
import PortalChat from './PortalChat';
import PortalDocuments from './PortalDocuments';
import PortalWorkExport from './PortalWorkExport';
import type { WorkOrder, Contractor } from '@/lib/types';
import { linkLabel, parseClientLinks } from '@/lib/client-links';
import { linkPurpose } from '@/lib/site-links';

// ─── Types ────────────────────────────────────────────────────────────────────

// RPC returns WorkOrder rows augmented with a computed is_lead flag
type PortalWorkOrder = WorkOrder & { is_lead: boolean };

type PortalData = {
  contractor: Contractor;
  work_orders: PortalWorkOrder[];
  // migration-048: what this token may do, and whether it's the tech or a helper
  capabilities?: string[];
  display_name?: string;
  kind?: 'contractor' | 'grant';
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
    Approved:      { bg: 'rgba(14,27,46,0.15)',  color: '#0E1B2E', label: 'Approved' },
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

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return <div style={{ height: 1, background: '#f0f0f0', margin: '12px 0' }} />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PortalPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { token } = await params;
  // One token, two front doors. A W-9 request links to ?view=paperwork and
  // shows only the forms; a job link shows only the work. Mixing tax paperwork
  // into a job screen reads as unprofessional and buries whichever one the
  // person was actually sent for.
  const { view } = await searchParams;
  const paperworkOnly = view === 'paperwork';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.rpc('get_portal_data', { p_token: token });
  if (error || !data) return notFound();

  const { contractor, work_orders, kind } = data as PortalData;
  // Paperwork is the tech's own; a helper link never sees it.
  const isContractor = (kind ?? 'contractor') === 'contractor';
  // Pre-compute isLead per WO for ergonomic use below
  const woIsLead = (wo: PortalWorkOrder) => wo.is_lead !== false;

  async function handleAcknowledge(woId: string) {
    'use server';
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await sb.rpc('acknowledge_work_order', { p_wo_id: woId, p_token: token });
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
    } catch { /* non-blocking */ }
    revalidatePath(`/portal/${token}`);
  }

  async function handleStatusUpdate(woId: string, status: string) {
    'use server';
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await sb.rpc('update_portal_wo_status', { p_wo_id: woId, p_token: token, p_status: status });
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

  const pending  = work_orders.filter((w) => !w.acknowledged_at);
  const accepted = work_orders.filter((w) =>  w.acknowledged_at);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #f0fafa 0%, #f7f8fa 60%)',
      fontFamily: "'Segoe UI', Arial, Helvetica, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0E1B2E 0%, #13284A 100%)',
        padding: '24px 20px 20px',
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div style={{ color: '#C9A24B', fontSize: 10, fontWeight: 700, letterSpacing: 3, marginBottom: 4 }}>
            FAJ SOLUTIONS
          </div>
          <div style={{ color: 'white', fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
            {paperworkOnly ? 'Onboarding Paperwork' : 'Contractor Portal'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>
            Welcome, {contractor.name}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 48px' }}>

        {/* Check in, mileage, receipts and the client's forms are only in the
            tech app (Fred, 2026-10-19: a tech on this page couldn't find where
            to add receipts). */}
        {!paperworkOnly && work_orders.length > 0 && (
          <a href="/tech/login" style={{
            display: 'block', textDecoration: 'none', marginBottom: 18, padding: '14px 16px', borderRadius: 14,
            background: '#0E1B2E', color: 'white', border: '2px solid #C9A24B',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Check in, mileage and receipts are in the FAJ tech app</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
              Tap here, then &ldquo;First time? Create your login&rdquo; with the email this link was sent to. Pick your own password.
            </div>
          </a>
        )}

        {/* ══ PAPERWORK VIEW — reached from a W-9 request. Forms only. ══ */}
        {paperworkOnly && isContractor && (
          <PortalDocuments
            token={token}
            w9Received={Boolean(contractor.w9_received)}
            w9SubmittedAt={contractor.w9_submitted_at ?? null}
            contractUrl={contractor.contract_url ?? null}
            contractSignedAt={contractor.contract_signed_at ?? null}
            contractSignedName={contractor.contract_signed_name ?? null}
            contractorName={contractor.name}
          />
        )}

        {/* A helper link carries no paperwork, so send it to the job view
            rather than showing an empty page. */}
        {paperworkOnly && !isContractor && (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 16, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#333', marginBottom: 6 }}>Nothing to complete here</div>
            <div style={{ fontSize: 13, color: '#888' }}>Onboarding paperwork is filed by the contractor themselves.</div>
          </div>
        )}

        {/* New / pending jobs */}
        {!paperworkOnly && pending.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#0E1B2E', letterSpacing: 2,
              textTransform: 'uppercase', marginBottom: 12,
            }}>
              ⚡ New Jobs — Action Required ({pending.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {pending.map((wo) => (
                <WOCard key={wo.id} wo={wo} token={token}
                  onAcknowledge={handleAcknowledge} onStatusUpdate={handleStatusUpdate}
                  isNew isLead={woIsLead(wo)} />
              ))}
            </div>
          </div>
        )}

        {/* Accepted jobs */}
        {!paperworkOnly && accepted.length > 0 && (
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
                  onAcknowledge={handleAcknowledge} onStatusUpdate={handleStatusUpdate}
                  isNew={false} isLead={woIsLead(wo)} />
              ))}
            </div>
          </div>
        )}

        {/* Their own record of the work, money-free. Only on the job view —
            the paperwork link stays a single errand. */}
        {!paperworkOnly && isContractor && work_orders.length > 0 && (
          <PortalWorkExport workOrders={work_orders} contractorName={contractor.name} />
        )}

        {/* Job view with nothing assigned. Paperwork is deliberately NOT shown
            here — it has its own link. */}
        {!paperworkOnly && work_orders.length === 0 && (
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
          FAJ Solutions · Questions? Contact support@fajsolutions.com
        </div>
      </div>
    </div>
  );
}

// ─── Work Order Card ──────────────────────────────────────────────────────────

function WOCard({
  wo, token, onAcknowledge, onStatusUpdate, isNew, isLead,
}: {
  wo: WorkOrder;
  token: string;
  onAcknowledge: (woId: string) => Promise<void>;
  onStatusUpdate: (woId: string, status: string) => Promise<void>;
  isNew: boolean;
  isLead: boolean;
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
      border: `2px solid ${isNew ? '#0E1B2E' : '#e5e7eb'}`,
      overflow: 'hidden',
      boxShadow: isNew ? '0 4px 20px rgba(14,27,46,0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Card header */}
      <div style={{
        padding: '14px 20px',
        background: isNew ? 'rgba(14,27,46,0.06)' : '#fafafa',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#0E1B2E', fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>
            WO #{wo.wo_number}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>
            {wo.title || `Work Order #${wo.wo_number}`}
          </div>
          {wo.customer_name && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{wo.customer_name}</div>
          )}
        </div>
        {statusBadge(wo)}
      </div>

      {/* Card body */}
      <div style={{ padding: '16px 20px' }}>

        {/* ── Role badge (only shown on multi-tech jobs) ── */}
        {wo.contractor_names && wo.contractor_names.length >= 2 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14,
            padding: '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700,
            background: isLead ? 'rgba(14,27,46,0.1)' : 'rgba(99,102,241,0.1)',
            color: isLead ? '#0E1B2E' : '#4338ca',
            border: isLead ? '1px solid rgba(14,27,46,0.2)' : '1px solid rgba(99,102,241,0.2)',
          }}>
            <span>{isLead ? '⭐' : '🔧'}</span>
            <span>{isLead ? 'Lead Technician' : 'Assistant Technician'}</span>
          </div>
        )}

        {/* ── On-site reference: the number to give at check-in ── */}
        {(wo.external_wo_id || wo.client_reference) && (
          <InfoRow icon="🔖" label="On-Site Reference">
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0E1B2E' }}>
              {wo.source_platform && wo.source_platform !== 'Internal' ? `${wo.source_platform} ` : ''}
              #{wo.external_wo_id || wo.client_reference}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              Give this number when you check in on site
            </div>
          </InfoRow>
        )}

        {/* ── Schedule ── */}
        {timeStr && (
          <InfoRow icon="📅" label="Schedule">
            <div style={{ fontSize: 14, color: '#333', fontWeight: 600 }}>{timeStr}</div>
            {wo.schedule_type && wo.schedule_type !== 'Exact Time' && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{wo.schedule_type}</div>
            )}
          </InfoRow>
        )}

        {/* ── Site Address ── */}
        {site && (
          <InfoRow icon="📍" label="Site Address">
            {wo.site_name && <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{wo.site_name}</div>}
            <div style={{ fontSize: 13, color: '#444' }}>
              {[wo.site_address, wo.site_city, wo.site_state].filter(Boolean).join(', ')}
              {wo.site_zip && <span style={{ color: '#888' }}> {wo.site_zip}</span>}
            </div>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(site)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', marginTop: 5, fontSize: 12, color: '#0E1B2E', fontWeight: 600, textDecoration: 'none' }}
            >
              Open in Maps ↗
            </a>
          </InfoRow>
        )}

        {/* ── Parking ── */}
        {wo.parking_instructions && (
          <InfoRow icon="🅿️" label="Parking">
            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {wo.parking_instructions}
            </div>
          </InfoRow>
        )}

        {/* ── Access Instructions ── */}
        {wo.access_instructions && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(59,130,246,0.06)',
            borderRadius: 10,
            border: '1px solid rgba(59,130,246,0.12)',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', marginBottom: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              🔑 Access Instructions
            </div>
            <div style={{ fontSize: 13, color: '#1e3a5f', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {wo.access_instructions}
            </div>
          </div>
        )}

        {/* ── Client links (Fred, 2026-10-19: "the tech is not seeing client links").
            The same links the tech app shows; the checkout form says so. ── */}
        {parseClientLinks((wo.client_links ?? []).join('\n')).length > 0 && (
          <InfoRow icon="🔗" label="Client links">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {parseClientLinks((wo.client_links ?? []).join('\n')).map((l) => {
                const purpose = linkPurpose(l, { checkin: wo.checkin_link ?? undefined, checkout: wo.checkout_link ?? undefined, survey: wo.survey_link ?? undefined, deliverable: wo.deliverable_link ?? undefined });
                return (
                <a key={l} href={l} target="_blank" rel="noopener noreferrer" style={{
                  display: 'block', padding: '10px 12px', borderRadius: 10, border: '1px solid #d6dbe4', background: 'white',
                  color: '#0E1B2E', fontSize: 13, fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {linkLabel(l)} ↗
                  {purpose && <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: '#5E6470' }}>{purpose}</span>}
                </a>
                );
              })}
            </div>
          </InfoRow>
        )}

        {/* ── Description ── */}
        {wo.description && (
          <InfoRow icon="📝" label="Description">
            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
              {wo.description}
            </div>
          </InfoRow>
        )}

        {/* ── Deliverables (lead only) ── */}
        {isLead && deliverableList.length > 0 && (
          <InfoRow icon="✅" label="Deliverables">
            <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
              {deliverableList.map((d, i) => (
                <li key={i} style={{ fontSize: 13, color: '#444', marginBottom: 4 }}>{d}</li>
              ))}
            </ul>
          </InfoRow>
        )}

        {/* ── Deliverable Instructions (lead only) ── */}
        {isLead && wo.deliverable_instructions && (
          <InfoRow icon="📌" label="Deliverable Instructions">
            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
              {wo.deliverable_instructions}
            </div>
          </InfoRow>
        )}

        {/* ── Tools Required ── */}
        {wo.tools_required && (
          <InfoRow icon="🔧" label="Tools Required">
            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
              {wo.tools_required}
            </div>
          </InfoRow>
        )}

        {/* ── Parts / Materials ── */}
        {wo.parts_materials && (
          <InfoRow icon="📦" label="Parts / Materials">
            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
              {wo.parts_materials}
            </div>
          </InfoRow>
        )}

        {/* ── Photo Required badge (lead only) ── */}
        {isLead && wo.photo_required && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
            background: 'rgba(245,158,11,0.08)', borderRadius: 10,
            border: '1px solid rgba(245,158,11,0.2)', marginBottom: 12,
          }}>
            <span style={{ fontSize: 16 }}>📷</span>
            <div style={{ fontSize: 13, color: '#92400e', fontWeight: 600 }}>
              Photos required — please document your work on site.
            </div>
          </div>
        )}

        {/* ── Site Contacts (multi-contact, migration-019) ── */}
        {wo.contacts && wo.contacts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0E1B2E', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>
              📋 Site Contacts
            </div>
            {wo.contacts.map((c) => (
              <div key={c.id} style={{ border: '1px solid rgba(14,27,46,0.18)', borderRadius: 10, padding: '10px 14px', background: 'rgba(14,27,46,0.03)' }}>
                {c.label && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#0E1B2E', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    {c.label}
                  </div>
                )}
                {c.name && <div style={{ fontSize: 14, fontWeight: 600, color: '#1a3a3a' }}>{c.name}</div>}
                <div style={{ display: 'flex', gap: 16, marginTop: c.name ? 4 : 0, flexWrap: 'wrap' }}>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} style={{ fontSize: 13, color: '#0E1B2E', textDecoration: 'none', fontWeight: 600 }}>
                      📞 {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} style={{ fontSize: 13, color: '#0E1B2E', textDecoration: 'none' }}>
                      ✉️ {c.email}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (wo.poc_name || wo.poc_phone) ? (
          /* Legacy single-POC fallback */
          <InfoRow icon="👤" label="Point of Contact">
            {wo.poc_name  && <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{wo.poc_name}</div>}
            {wo.poc_phone && (
              <a href={`tel:${wo.poc_phone}`} style={{ fontSize: 13, color: '#0E1B2E', textDecoration: 'none', fontWeight: 600 }}>
                {wo.poc_phone}
              </a>
            )}
            {wo.poc_email && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{wo.poc_email}</div>}
          </InfoRow>
        ) : null}

        {/* ── Support Contact ── */}
        {wo.support_contact && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(14,27,46,0.06)',
            borderRadius: 10,
            border: '1px solid rgba(14,27,46,0.15)',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0E1B2E', marginBottom: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              📞 Support Contact
            </div>
            <div style={{ fontSize: 13, color: '#1a3a3a', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {wo.support_contact}
            </div>
          </div>
        )}

        {/* ── Vendor attachment ── */}
        {wo.attachment_url && (
          <a
            href={wo.attachment_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: 'rgba(201,162,75,0.1)', borderRadius: 10,
              border: '1px solid rgba(201,162,75,0.25)', marginBottom: 12,
              textDecoration: 'none', color: '#b8944a', fontWeight: 600, fontSize: 13,
            }}
          >
            <span>📎</span>
            <span>Download Vendor Paperwork</span>
          </a>
        )}

        {/* ── Admin documents ── */}
        {wo.doc_urls && wo.doc_urls.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
              📄 Job Documents
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wo.doc_urls.map((url, i) => {
                const name = url.split('/').pop() ?? `Document ${i + 1}`;
                const isImg = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(url);
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderRadius: 8,
                      background: '#f9fafb', border: '1px solid #e5e7eb',
                      textDecoration: 'none', color: '#374151', fontSize: 13,
                    }}
                  >
                    <span>{isImg ? '🖼️' : '📄'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>View ↗</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* ── New WO: show Q&A fields as a preview, then acknowledge ── */}
        {isNew ? (
          <>
            {/* Q&A preview badges — lead only (assistant doesn't need to fill these in) */}
            {isLead && wo.custom_qa && wo.custom_qa.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                  Required Info on Site
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {wo.custom_qa.map((q) => (
                    <span key={q.id} style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: 'rgba(14,27,46,0.08)', color: '#0E1B2E',
                    }}>
                      {q.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <AcknowledgeButton woId={wo.id} woNumber={wo.wo_number} onAcknowledge={onAcknowledge} />
          </>
        ) : (
          /* ── Accepted WO ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Accepted banner */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: 'rgba(4,120,87,0.08)', borderRadius: 10,
              border: '1px solid rgba(4,120,87,0.15)', color: '#047857',
              fontSize: 13, fontWeight: 700, marginBottom: 16,
            }}>
              <span>✓</span>
              <span>Accepted{wo.acknowledged_at
                ? ` on ${new Date(wo.acknowledged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : ''
              }</span>
            </div>

            <PortalChat token={token} woNumber={wo.wo_number} />
            <Divider />

            {/* ── LEAD TECH: full interactive workflow ── */}
            {isLead && (
              <>
                {/* Status progression — Start Work only (Work Done is gated below) */}
                <PortalStatusButton
                  woId={wo.id}
                  woNumber={wo.wo_number}
                  currentStatus={wo.wo_status}
                  onStatusUpdate={onStatusUpdate}
                />

                {/* Time & travel log */}
                <Divider />
                <PortalTimeLog
                  woId={wo.id}
                  token={token}
                  travelStartAt={wo.travel_start_at}
                  travelStartLat={wo.travel_start_lat}
                  travelStartLng={wo.travel_start_lng}
                  arrivedAt={wo.arrived_at}
                  arrivedLat={wo.arrived_lat}
                  arrivedLng={wo.arrived_lng}
                  checkedInAt={wo.checked_in_at}
                  checkedOutAt={wo.checked_out_at}
                />

                {/* Tasks checklist */}
                {wo.wo_tasks && wo.wo_tasks.length > 0 && (
                  <>
                    <Divider />
                    <PortalTasks
                      woId={wo.id}
                      token={token}
                      tasks={wo.wo_tasks}
                    />
                  </>
                )}

                {/* Q&A */}
                {wo.custom_qa && wo.custom_qa.length > 0 && (
                  <>
                    <Divider />
                    <PortalQA
                      woId={wo.id}
                      token={token}
                      qa={wo.custom_qa}
                    />
                  </>
                )}

                {/* Photo upload */}
                <Divider />
                <PortalUpload
                  woId={wo.id}
                  token={token}
                  initialUrls={
                    (wo.doc_urls ?? []).filter((u) => {
                      const seg = u.split('/').pop() ?? '';
                      return /^\d{13}\./.test(seg); // only portal-uploaded (Date.now() prefix)
                    })
                  }
                />

                {/* Work Done gate (requires closeout notes + photos) */}
                <Divider />
                <PortalWorkDoneGate
                  woId={wo.id}
                  woNumber={wo.wo_number}
                  token={token}
                  currentStatus={wo.wo_status}
                  initialNotes={wo.closeout_notes ?? ''}
                  photoRequired={wo.photo_required ?? false}
                  signatureRequired={wo.signature_required ?? false}
                  onStatusUpdate={onStatusUpdate}
                />
              </>
            )}

            {/* ── ASSISTANT TECH: check-in / check-out only ── */}
            {!isLead && (
              <>
                <Divider />
                <PortalTimeLog
                  woId={wo.id}
                  token={token}
                  travelStartAt={wo.travel_start_at}
                  travelStartLat={wo.travel_start_lat}
                  travelStartLng={wo.travel_start_lng}
                  arrivedAt={wo.arrived_at}
                  arrivedLat={wo.arrived_lat}
                  arrivedLng={wo.arrived_lng}
                  checkedInAt={wo.checked_in_at}
                  checkedOutAt={wo.checked_out_at}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── InfoRow helper ───────────────────────────────────────────────────────────

function InfoRow({
  icon, label, children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }}>
          {label}
        </div>
        {children}
      </div>
    </div>
  );
}
