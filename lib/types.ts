export type EntityType =
  | 'Individual/Sole Proprietor'
  | 'C Corporation'
  | 'S Corporation'
  | 'Partnership'
  | 'Trust/Estate'
  | 'LLC'
  | 'Other';

export const ENTITY_TYPES: EntityType[] = [
  'Individual/Sole Proprietor',
  'C Corporation',
  'S Corporation',
  'Partnership',
  'Trust/Estate',
  'LLC',
  'Other',
];

export type Contractor = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  business_name: string | null;
  entity_type: EntityType | null;
  tax_id: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  w9_received: boolean;
  zelle_phone: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Work Order ────────────────────────────────────────────────────────────────

export type WorkOrderStatus =
  | 'Open'
  | 'Assigned'
  | 'In Progress'
  | 'Work Done'
  | 'Approved'
  | 'Paid';

export const WO_STATUSES: WorkOrderStatus[] = [
  'Open', 'Assigned', 'In Progress', 'Work Done', 'Approved', 'Paid',
];

export type PayType = 'Fixed' | 'Hourly' | 'Per Device' | 'Blended';

export const PAY_TYPES: PayType[] = ['Fixed', 'Hourly', 'Per Device', 'Blended'];

export const SERVICE_TYPES: string[] = [
  'Network / IT',
  'Low Voltage',
  'Electrical',
  'Installation',
  'Maintenance',
  'Audio / Visual',
  'Security / Surveillance',
  'Telecommunications',
  'Construction',
  'Other',
];

export type WorkOrder = {
  id: string;
  user_id: string;
  wo_number: string;
  title: string | null;
  contractor_name: string;

  // FieldNation status
  wo_status: WorkOrderStatus;

  // Pay
  pay_type: PayType;
  total_amount: number;           // Always stored (calculated for non-fixed types)
  hourly_rate: number | null;     // Hourly + Blended
  hours_worked: number | null;    // Hourly + Blended
  per_device_rate: number | null; // Per Device
  device_count: number | null;    // Per Device
  blended_base: number | null;    // Blended fixed base amount

  // Site / Location
  site_name: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;

  // Schedule
  start_date: string | null;
  start_time: string | null;      // "HH:MM" 24h
  end_date: string | null;
  end_time: string | null;        // "HH:MM" 24h

  // Scope
  description: string | null;
  deliverables: string | null;    // Newline-separated checklist items
  service_type: string | null;
  required_skills: string | null; // Comma-separated

  // Contractor portal fields (migration-005)
  wo_tasks: WoTask[] | null;
  closeout_notes: string | null;
  submitted_at: string | null;

  // POC + custom Q&A (migration-006)
  poc_name: string | null;
  poc_phone: string | null;
  poc_email: string | null;
  support_contact: string | null;
  custom_qa: CustomQAItem[] | null;

  // Vendor attachment (migration-007)
  attachment_url: string | null;

  created_at: string;
  updated_at: string;
};

export type EnrichedWorkOrder = WorkOrder & {
  paid: number;
  remaining: number;
  payment_status: 'paid' | 'partial' | 'pending';
};

// ─── Payment ──────────────────────────────────────────────────────────────────

export type Payment = {
  id: string;
  user_id: string;
  wo_number: string;
  contractor_name: string;
  payment_date: strin