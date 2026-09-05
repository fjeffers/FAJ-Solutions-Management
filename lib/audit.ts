import { createClient } from '@/lib/supabase/client';

type AuditAction = 'create' | 'update' | 'delete' | 'archive' | 'unarchive';
type EntityType = 'work_order' | 'payment' | 'contractor';

export async function logAudit(params: {
  action: AuditAction;
  entityType: EntityType;
  entityId?: string;
  entityLabel: string;
  changes?: Record<string, unknown>;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // The table stores the label and the changed fields together in `details`.
  // It has no entity_label/changes columns of its own — writing those made
  // PostgREST reject every single audit row with a 400, so nothing was being
  // recorded at all. Keep this shape matched to the table.
  const { error } = await supabase.from('audit_log').insert({
    user_id: user.id,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    details: { label: params.entityLabel, ...(params.changes ?? {}) },
  });
  // An audit row is a record of work, not the work itself: never block a save
  // on it, but do not swallow the failure in silence either.
  if (error) console.warn('[audit] could not record', params.action, params.entityType, error.message);
}
