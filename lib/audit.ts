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

  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    entity_label: params.entityLabel,
    changes: params.changes ?? {},
  });
}
