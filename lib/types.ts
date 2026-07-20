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

  // Contractor portal (migration-011)
  portal_token: string | null;

  // QuickBooks sync (migration-027)
  qbo_vendor_id: string | null;

  // Direct Deposit / ACH (migration-009)
  bank_name: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: 'checking' | 'savings' | null;

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

  // Scheduling calendar assignment (migration-022)
  scheduled_date: string | null;

  // Dispatch map geocoding (migration-023)
  site_lat: number | null;
  site_lng: number | null;

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

  // Multi-contacts (migration-019)
  contacts: SiteContact[] | null;

  // Vendor attachment (migration-007)
  attachment_url: string | null;

  // Admin documents & photos (migration-008)
  doc_urls: string[] | null;

  // Contractor portal (migration-011)
  acknowledged_at: string | null;

  // Extended WO fields (migration-010)
  source_platform: string | null;
  external_wo_id: string | null;
  customer_name: string | null;
  project_name: string | null;
  client_reference: string | null;
  buyer_company: string | null;
  assignment_type: string | null;
  priority: string | null;
  expense_budget: number | null;
  travel_amount: number | null;
  bonus_amount: number | null;
  schedule_type: string | null;
  time_zone: string | null;
  deliverable_instructions: string | null;
  tools_required: string | null;
  parts_materials: string | null;
  access_instructions: string | null;
  parking_instructions: string | null;
  check_in_required: boolean;
  check_out_required: boolean;
  signature_required: boolean;
  photo_required: boolean;

  // Multi-contractor (migration-014)
  contractor_names: string[] | null;

  // Lead / Assistant tech (migration-017)
  lead_contractor_name: string | null;

  // Per-contractor pay split (migration-029): contractor name -> dollar amount.
  // Null = no split (single tech, or legacy multi-tech where primary carries the total).
  contractor_pay: Record<string, number> | null;

  // Materials used at closeout (migration-031). material_id links to inventory
  // (stock decremented on save); null material_id = extra item bought for the job.
  materials_used: MaterialUsed[] | null;

  // Mileage logged at closeout (migration-032)
  mileage_logs: MileageLog[] | null;

  // Soft-archive (migration-013)
  archived_at: string | null;

  // Time & GPS tracking (migration-016)
  checked_in_at:    string | null;
  checked_out_at:   string | null;
  travel_start_at:  string | null;
  travel_start_lat: number | null;
  travel_start_lng: number | null;
  arrived_at:       string | null;
  arrived_lat:      number | null;
  arrived_lng:      number | null;

  created_at: string;
  updated_at: string;
};

export type EnrichedWorkOrder = WorkOrder & {
  paid: number;
  remaining: number;
  payment_status: 'paid' | 'partial' | 'pending';
  // Job price + mileage reimbursements — what "paid in full" means for this WO
  payout_total: number;
};

// ─── Payment ──────────────────────────────────────────────────────────────────

export type Payment = {
  id: string;
  user_id: string;
  wo_number: string;
  contractor_name: string;
  payment_date: string;
  amount: number;
  method: string;
  notes: string | null;
  created_at: string;
  updated_at: string;

  // QuickBooks sync (migration-027)
  qbo_synced_at: string | null;
  qbo_transaction_id: string | null;
};

// ─── Question Templates ───────────────────────────────────────────────────────

export type QuestionFieldType = 'text' | 'number' | 'yes_no' | 'textarea' | 'photo' | 'document' | 'signature';

export type QuestionField = {
  id: string;
  label: string;
  type: QuestionFieldType;
  placeholder?: string | null;
  required?: boolean;
};

export type QuestionTemplate = {
  id: string;
  user_id: string;
  name: string;
  questions: QuestionField[];
  attachment_url: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomQAItem = {
  id: string;
  label: string;
  type: QuestionFieldType;
  answer: string | null;
};

export type SiteContact = {
  id: string;
  label: string;   // e.g. "Site Manager", "NOC", "Security"
  name: string;
  phone: string;
  email: string;
};

// ─── Materials / Inventory (pre-existing table, built outside this repo) ─────

export type MileageLog = {
  id: string;              // row id within the WO (client-generated)
  contractor_name: string; // who drove
  miles: number;
  rate: number;            // dollars per mile
  note: string | null;     // e.g. "round trip to site"
};

export type MaterialUsed = {
  id: string;                 // row id within the WO (client-generated)
  material_id: string | null; // inventory link, or null for an extra/bought item
  name: string;
  quantity: number;
  unit_cost: number | null;
};

export type Material = {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  stock_quantity: number;
  low_stock_threshold: number | null;
  unit_cost: number | null;
  supplier: string | null;
  sku: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MaterialUsage = {
  id: string;
  user_id: string | null;
  material_id: string | null;
  work_order_id: string | null;
  wo_number: string | null;
  quantity_used: number;
  notes: string | null;
  used_at: string;
  created_at: string;
};

// ─── Quotes (pre-existing table, built outside this repo) ────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export type QuoteLineItem = {
  id: string;
  description: string;
  quantity: number;
  rate: number;
};

export type Quote = {
  id: string;
  user_id: string | null;
  quote_number: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  title: string | null;
  description: string | null;
  line_items: QuoteLineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  status: QuoteStatus;
  valid_until: string | null;
  notes: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  work_order_id: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Invoices (migration-033) — accounts receivable, client → FAJ ────────────

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

// Same shape as quote lines. Lines added from a work order use id `wo-<uuid>`,
// which is how work_order_ids is derived on save.
export type InvoiceLineItem = QuoteLineItem;

export type Invoice = {
  id: string;
  user_id: string | null;
  invoice_number: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  title: string | null;
  description: string | null;
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  status: InvoiceStatus;
  due_date: string | null;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  work_order_ids: string[];
  quote_id: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoicePayment = {
  id: string;
  user_id: string | null;
  invoice_id: string;
  amount: number;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

// ─── Work Order Messages (pre-existing table, built outside this repo) ───────

export type MessageSenderRole = 'admin' | 'contractor';

export type WorkOrderMessage = {
  id: string;
  user_id: string | null;
  work_order_id: string; // stores wo_number, per this app's existing wo-linking convention
  sender_email: string | null;
  sender_name: string;
  sender_role: MessageSenderRole;
  content: string;
  read_at: string | null;
  created_at: string;
};

// ─── Email Import (migration-026) ─────────────────────────────────────────────

export type GmailConnection = {
  id: string;
  user_id: string;
  connected_email: string;
  last_polled_at: string | null;
  created_at: string;
  // refresh_token / access_token intentionally omitted — never selectable by the browser client.
};

export type ImportQueueStatus = 'pending' | 'approved' | 'rejected';

export type ParsedNetviewFields = {
  title: string;
  description: string;
  customer_name: string;
  client_reference: string; // Site ID
  external_wo_id: string;   // Ticket Number
  start_date: string | null;
  total_amount?: number;    // Google Sheets imports carry an amount; email imports don't
};

export type ImportQueueItem = {
  id: string;
  user_id: string;
  source: 'netview_smartsheet' | 'field_nation' | 'google_sheets' | 'google_docs';
  external_dedupe_key: string;
  parsed_fields: ParsedNetviewFields;
  raw_snippet: string | null;
  status: ImportQueueStatus;
  created_work_order_id: string | null;
  created_at: string;
  reviewed_at: string | null;
};

// ─── QuickBooks Online sync (migration-027) ───────────────────────────────────

export type QuickBooksConnection = {
  id: string;
  user_id: string;
  realm_id: string;
  company_name: string | null;
  environment: 'sandbox' | 'production';
  default_expense_account_id: string | null;
  default_expense_account_name: string | null;
  default_payment_account_id: string | null;
  default_payment_account_name: string | null;
  connected_at: string;
  created_at: string;
  // refresh_token / access_token intentionally omitted — never selectable by the browser client.
};

export type QuickBooksAccount = {
  id: string;
  name: string;
  accountType: string;
};

// ─── Deliverable Templates ────────────────────────────────────────────────────

export type DeliverableTemplate = {
  id: string;
  user_id: string;
  name: string;
  items: string[];
  created_at: string;
  updated_at: string;
};

// ─── Contractor Portal ────────────────────────────────────────────────────────

export type WoTask = {
  id: string;
  category: 'Pre Visit' | 'On Site' | 'Post Site' | 'Prep' | 'Post'; // legacy: Prep→Pre Visit, Post→Post Site
  label: string;
  completed: boolean;
  completed_at: string | null;
};

export type TimeLog = {
  id: string;
  wo_id: string;
  wo_number: string;
  contractor_name: string;
  travel_start_at:  string | null;
  travel_start_lat: number | null;
  travel_start_lng: number | null;
  arrived_at:       string | null;
  arrived_lat:      number | null;
  arrived_lng:      number | null;
  checked_in_at:    string | null;
  checked_out_at:   string | null;
  created_at: string;
  updated_at: string;
};

export type ContractorTimeLog = {
  id: string;
  wo_id: string;
  wo_number: string;
  contractor_name: string;
  travel_start_at:  string | null;
  travel_start_lat: number | null;
  travel_start_lng: number | null;
  arrived_at:       string | null;
  arrived_lat:      number | null;
  arrived_lng:      number | null;
  checked_in_at:    string | null;
  checked_out_at:   string | null;
  created_at: string;
  updated_at: string;
};

export type Signature = {
  id: string;
  wo_id: string;
  wo_number: string;
  contractor_name: string;
  signer_name: string | null;
  signature_data: string;
  signed_at: string;
};

export type DeliverableSubmission = {
  id: string;
  wo_id: string;
  wo_number: string;
  contractor_name: string;
  notes: string | null;
  file_urls: string[];
  submitted_at: string;
};

// ─── Network documentation (migration-034) ──────────────────────────────────
// Port mapping for client sites: a site owns switches and patch panels; each
// drop is one room/jack record. Port maps are derived from drops app-side.

export type NetworkProject = {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Floor plan site survey (migration-037) ─────────────────────────────────
// Coordinates are in plan units on a 1000x700 canvas (roughly feet at a
// medium office scale — relative placement is what matters on a survey).

export type PlanRoomKind = 'room' | 'closet' | 'open';

export type PlanRoom = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PlanRoomKind;
};

export type PlanItemType =
  | 'drop' | 'outlet' | 'power' | 'workstation' | 'laptop' | 'printer'
  | 'ap' | 'rack' | 'switch' | 'firewall' | 'camera' | 'tv' | 'phone' | 'other';

export type PlanItem = {
  id: string;
  type: PlanItemType;
  x: number;
  y: number;
  label: string;
  /** Optional link to a network_drops row on the same floor. */
  drop_id?: string | null;
  /** Free text: jack/port details, e.g. "2x Cat6, jack A data / jack B voice". */
  ports?: string;
  notes?: string;
  photos: string[];
};

export type FloorPlan = {
  rooms: PlanRoom[];
  items: PlanItem[];
};

/** A floor (or area) within a network project. */
export type NetworkSite = {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  notes: string | null;
  /** Template for generated target labels: {room}, {jack}, {jacks} tokens. */
  label_scheme: string;
  floor_plan: FloorPlan | null;
  created_at: string;
  updated_at: string;
};

export type NetworkSwitch = {
  id: string;
  user_id: string;
  site_id: string;
  name: string;
  model: string | null;
  port_count: number;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type NetworkPatchPanel = {
  id: string;
  user_id: string;
  site_id: string;
  name: string;
  port_count: number;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type NetworkDropStatus = 'active' | 'needs_label' | 'office_closed';

export type NetworkDrop = {
  id: string;
  user_id: string;
  site_id: string;
  room: string;
  assigned_to: string | null;
  side: string | null;
  area_zone: string | null;
  item_type: string | null;
  /** Jack positions on the wall plate, comma-separated (e.g. "A,B,C"). */
  jacks: string | null;
  /** Current (legacy) label on the jack. */
  wall_jack_label: string | null;
  /** New label the jack should get under the site's label scheme. */
  target_label: string | null;
  patch_panel_id: string | null;
  panel_port: number | null;
  switch_id: string | null;
  switch_port: number | null;
  status: NetworkDropStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentMethod =
  | 'Cash' | 'Check' | 'Zelle' | 'Venmo' | 'CashApp'
  | 'PayPal' | 'Direct Deposit' | 'Bank Transfer' | 'Credit Card' | 'Other';
export const PAYMENT_METHODS: PaymentMethod[] = [
  'Cash', 'Check', 'Zelle', 'Venmo', 'CashApp',
  'PayPal', 'Direct Deposit', 'Bank Transfer', 'Credit Card', 'Other',
];


// â”€â”€â”€ WorkOrderModal dropdown constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const WORK_ORDER_SOURCES: string[] = [
  'Internal', 'NetView', 'FieldNation', 'WorkMarket', 'Thumbtack', 'CrowdSource', 'Direct', 'Other',
];

export const ASSIGNMENT_TYPES: string[] = [
  'Internal', 'Subcontract', 'Employee', 'Independent Contractor', 'Direct', 'Other',
];

export const WORK_ORDER_PRIORITIES: string[] = [
  'Low', 'Normal', 'High', 'Critical', 'Emergency',
];

export const SCHEDULE_TYPES: string[] = [
  'Exact Time', 'Time Window', 'Day', 'Flexible', 'On Demand',
];