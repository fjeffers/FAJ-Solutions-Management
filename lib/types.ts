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
  /** Fred's own fields (Settings -> Custom fields, migration 110), by field id. */
  custom?: Record<string, unknown> | null;
  /** Who to call if something happens on a job, and when they started (migration 111). */
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  hire_date?: string | null;
  /** Their tech app login, once they've made one (migration 067). */
  auth_user_id?: string | null;
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
  /** (migration-104) On hold: can't be picked for a ticket or a job, and gets no assignment email. */
  on_hold?: boolean;
  zelle_phone: string | null;
  /** (migration-054) how this tech wants to be paid, answered on their W-9. */
  payment_method: 'Zelle' | 'Direct Deposit' | 'Check' | 'Other' | null;

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

  // (migration-049) pay from logged hours, and portal onboarding documents
  /** Default rate used to turn GPS-stamped hours into a suggested payout. */
  default_hourly_rate: number | null;
  contract_url: string | null;
  contract_signed_at: string | null;
  contract_signed_name: string | null;
  contract_signed_ip: string | null;
  w9_submitted_at: string | null;

  // (migration-051) W9 form tracking and management
  w9_file_path: string | null;
  w9_uploaded_by: string | null;
  w9_uploaded_at: string | null;
  w9_invite_sent_at: string | null;
  w9_invite_token: string | null;

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
  /** Fred's own fields (Settings -> Custom fields, migration 110), by field id. */
  custom?: Record<string, unknown> | null;
  /** One of Fred's own Dispatch board columns the job is parked in (migration 113), or null. */
  board_stage?: string | null;
  id: string;
  user_id: string;
  wo_number: string;
  title: string | null;
  contractor_name: string;

  /** (migration-046) join key to the customer master. */
  customer_id: string | null;

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

  // Submit → review (columns existed in the DB but were never typed;
  // migration-049 adds submitted_by and review_history)
  /**
   * 'submitted' puts the job in the owner's review queue. Defaults to
   * 'not_started' in the database — all 61 existing rows carry that value, and
   * an earlier version of this type omitted it.
   */
  submission_status: 'not_started' | 'submitted' | 'approved' | 'rejected' | null;
  approved_at: string | null;
  reviewed_at: string | null;
  /** Why it was sent back, shown to the tech so they know what to fix. */
  rejection_reason: string | null;
  /** Who submitted it — a multi-tech job needs to know which one. */
  submitted_by: string | null;
  /** Append-only log so a second denial doesn't erase the first. */
  review_history: { at: string; action: string; by: string; reason?: string }[];

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
  /** The tech's Tools (scan, sign a PDF, read codes, count, measure) on this job; off unless the office turns them on (migration 129). */
  tech_tools?: boolean;
  /** The client's links for this job, shown to the tech as buttons (migration 130). */
  client_links?: string[] | null;
  /** Opened when the tech checks in on site, e.g. the client's Teams meeting (migration 133). */
  checkin_link?: string | null;
  /** Opened when the tech goes off site for the day: the client's checkout form (migration 133). */
  checkout_link?: string | null;

  // Contractor portal (migration-011)
  acknowledged_at: string | null;

  // Extended WO fields (migration-010)
  source_platform: string | null;
  external_wo_id: string | null;
  customer_name: string | null;
  project_name: string | null;
  /** Part of a project: techs get the project day (migration 117). */
  is_project?: boolean;
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
  /** What the job asks the tech for (migration 128, lib/capture.ts); null or missing = everything. */
  capture?: string[] | null;
  /** What else the office wants at check-in (migration 128, lib/checkin.ts). */
  start_asks?: unknown;

  // Multi-contractor (migration-014)
  contractor_names: string[] | null;

  // Lead / Assistant tech (migration-017)
  lead_contractor_name: string | null;

  // Per-contractor pay split (migration-029): contractor name -> dollar amount.
  // Null = no split (single tech, or legacy multi-tech where primary carries the total).
  contractor_pay: Record<string, number> | null;

  // What the CLIENT is billed for travel, materials and anything else
  // (migration-063). REVENUE — deliberately separate from mileage_logs and
  // materials_used below, which are what goes OUT to the tech. Whether a tech
  // is reimbursed for the travel a client was charged varies by job, so the two
  // sides are recorded independently rather than inferred from each other.
  billable_travel: number | null;
  /** (migration-064) round-trip miles behind billable_travel. */
  billable_miles: number | null;
  billable_materials: number | null;
  billable_other: number | null;

  /** (migration-065) Everything on the pay panel that is not labour. */
  pay_addons: PayAddon[];

  // Materials used at closeout (migration-031). material_id links to inventory
  // (stock decremented on save); null material_id = extra item bought for the job.
  materials_used: MaterialUsed[] | null;

  // Mileage logged at closeout (migration-032)
  mileage_logs: MileageLog[] | null;

  // Accept/decline per tech (migration-056): name -> { status, at }
  assignment_responses: Record<string, AssignmentResponse> | null;

  // Job closeout and techs asking for another time (migration-105). Read with
  // lib/closeout.ts; written by the tech portal's server functions, and by
  // WorkFlow when Fred answers a time request. Not part of the Edit job save.
  closeout?: unknown;
  time_requests?: unknown;

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
  /**
   * Has a real tech pay figure been recorded? When false the payout is
   * UNKNOWN, not zero and not the client price — see hasPaySplit.
   */
  pay_set: boolean;
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

export type AssignmentResponse = {
  status: 'accepted' | 'declined';
  at: string; // ISO timestamp
};

export type MileageLog = {
  id: string;              // row id within the WO (client-generated)
  contractor_name: string; // who drove
  miles: number;
  rate: number;            // dollars per mile
  note: string | null;     // e.g. "round trip to site"
  /**
   * (migration-081) Which day this drive was, on a site visit that spans more
   * than one. A job where the parts weren't there means driving out, going for
   * materials, and driving back another day — two round trips, not one.
   * Work orders ignore this; they have their own dates.
   */
  on?: string | null;
};

export type MaterialUsed = {
  id: string;                 // row id within the WO (client-generated)
  material_id: string | null; // inventory link, or null for an extra/bought item
  name: string;
  quantity: number;
  unit_cost: number | null;
  /**
   * (migration-063) The client bought it, or asked for it to be left on site.
   *
   * Most materials Fred buys stay HIS — carried to the job, brought back, used
   * again. Those are stock, not a sale, and billing them would charge a client
   * for something they never received. Only a row marked here is billed, and
   * only that row leaves the van for good.
   */
  client_pays?: boolean;
  /**
   * (migration-063) Pay this back to whoever bought it.
   *
   * Someone laid out cash for an item bought for the job, and the payout never
   * counted it — a tech who spent $120 on faceplates was simply out $120. New
   * "extra" rows default to reimbursable; stock off the van does not, because
   * the business already owned it.
   */
  reimburse?: boolean;
  /** Who paid for it. Empty means the job's lead tech. */
  bought_by?: string | null;
  /**
   * (migration-081) The day it was bought, on a multi-day site visit. Parts
   * are often bought partway through — go out, find nothing on site, buy what
   * is needed, come back. Recording the day is what makes that legible later.
   */
  on?: string | null;
};

/**
 * One line read off a receipt or a product label (migration-084 era scanning).
 * sku is only present when a barcode was read.
 */
export type ReceiptItemLike = {
  name: string;
  quantity: number;
  unit_cost: number;
  sku?: string | null;
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

// ─── Material kits (migration-084) — a saved "recipe" of materials ──────────
//
// The parts list for a job you do over and over, saved once. Adding a kit to a
// work order copies its rows into materials_used; adding it to a quote turns
// them into line items. A kit itself never moves stock — the work order does.

export type MaterialKitItem = {
  id: string;                 // row id within the kit (client-generated)
  material_id: string | null; // inventory link, or null for a buy-it item
  name: string;
  quantity: number;
  unit_cost: number | null;
};

export type MaterialKit = {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  items: MaterialKitItem[];
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

// ─── Tech accounts (migration-067) — a tech's own login ──────────────────────
//
// Shapes returned by the tech_* RPCs. Deliberately NARROWER than Contractor,
// WorkOrder and Payment: what the database refuses to send, the type refuses
// to describe. There is no `total_amount` or `contractor_pay` on TechJob
// because a tech never sees job money — see migration 067.

export type TechProfile = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  business_name: string | null;
  entity_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  payment_method: string | null;
  default_hourly_rate: number | null;
  w9_received: boolean | null;
  w9_submitted_at: string | null;
  contract_signed_at: string | null;
  portal_last_login_at: string | null;
  created_at: string;
  /** Their emergency contact (they can fill it in) and start date (migration 111). */
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  hire_date?: string | null;
};

/** One job a tech worked. No money on it, by design. */
export type TechJob = {
  id: string;
  wo_number: string | null;
  title: string | null;
  description: string | null;
  scope_of_work: string | null;
  service_type: string | null;
  wo_status: string | null;
  customer_name: string | null;
  project_name: string | null;
  site_name: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  start_date: string | null;
  end_date: string | null;
  scheduled_date: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  hours_worked: number | null;
  closeout_notes: string | null;
  archived_at: string | null;
  /** Approved, Paid, or archived — the job is done and read-only. */
  is_closed: boolean;
  /**
   * Still this tech's to work. Saying "work done" ends it, so the job leaves
   * their active list the moment they hand it back rather than lingering until
   * the office closes it. Older RPCs omit this; callers fall back to is_closed.
   */
  is_active?: boolean;
  /** What THIS tech was paid on this job. Never the job's price. */
  paid_total?: number;
  last_paid_on?: string | null;
  created_at: string;
};

/**
 * An unassigned job a tech can pick up (migration-073). Same money-free shape
 * as TechJob, plus the scheduling detail that decides whether they want it.
 */
export type TechOpenJob = {
  id: string;
  wo_number: string | null;
  title: string | null;
  description: string | null;
  scope_of_work: string | null;
  service_type: string | null;
  wo_status: string | null;
  customer_name: string | null;
  project_name: string | null;
  site_name: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  start_date: string | null;
  end_date: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  required_skills: string | null;
  priority: string | null;
  /** 'accepted' | 'declined' | null — whether this tech already answered. */
  my_response: string | null;
  created_at: string;
};

/** One payout to this tech, with just enough job context to recognise it. */
export type TechPayment = {
  id: string;
  payment_date: string | null;
  amount: number;
  method: string | null;
  notes: string | null;
  wo_number: string | null;
  wo_title: string | null;
  wo_site: string | null;
  wo_id: string | null;
};

/** One message on a job's thread, as a signed-in tech sees it. */
export type TechMessage = {
  id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  created_at: string;
  // The live sheet's messages (migration 121).
  kind?: 'message' | 'question' | 'answer' | 'note' | 'issue' | 'resolved';
  to_name?: string | null;
  on_sheet?: boolean;
  reason?: string | null;
  parent_id?: string | null;
  resolved_at?: string | null;
  row_ref?: string | null;
  /** This tech sent it (with two techs on a job, the role alone can't say). */
  mine?: boolean;
  /** Meant for this tech (to them, or to everyone). */
  for_me?: boolean;
  /** The tech has seen it (migration 123). */
  read?: boolean;
};

/** A tech in the roster, for the message dropdown. Names only, by design. */
export type TechDirectoryEntry = {
  id: string;
  name: string;
  unread: number;
};

/** One direct message between two techs. */
export type TechDirectMessage = {
  id: string;
  mine: boolean;
  content: string;
  created_at: string;
};

export type TechSummary = {
  paid_all_time: number;
  paid_this_year: number;
  payment_count: number;
  last_payment_at: string | null;
  jobs_total: number;
  jobs_open: number;
};

// ─── Contracts (migration-070) — the paper after the quote ───────────────────

export type ContractStatus = 'draft' | 'sent' | 'signed' | 'declined' | 'void';
export const CONTRACT_STATUSES: ContractStatus[] = ['draft', 'sent', 'signed', 'declined', 'void'];

export type Contract = {
  id: string;
  user_id: string | null;
  contract_number: string;
  /** Where it came from. All SET NULL: deleting a quote never deletes paper. */
  quote_id: string | null;
  survey_id: string | null;
  work_order_id: string | null;
  customer_id: string | null;
  client_name: string | null;
  client_email: string | null;
  site_name: string | null;
  site_address: string | null;
  title: string | null;
  status: ContractStatus;
  scope_of_work: string | null;
  deliverables: string | null;
  schedule_terms: string | null;
  price_terms: string | null;
  payment_terms: string | null;
  change_orders: string | null;
  warranty: string | null;
  exclusions: string | null;
  access_safety: string | null;
  insurance: string | null;
  termination: string | null;
  governing_law: string | null;
  total: number;
  deposit_amount: number | null;
  provider_signatory: string | null;
  client_signatory: string | null;
  signed_at: string | null;
  signed_name: string | null;
  signed_ip: string | null;
  share_token: string | null;
  sent_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Site surveys (migration-066) — the front of the job pipeline ────────────

export type SurveyStatus = 'draft' | 'completed' | 'quoted' | 'won' | 'lost';
export const SURVEY_STATUSES: SurveyStatus[] = ['draft', 'completed', 'quoted', 'won', 'lost'];

/**
 * One line of proposed work from the walk-through. description/quantity/rate
 * are deliberately the same shape as QuoteLineItem, so building the quote is a
 * copy rather than a re-type; `unit` and `notes` are survey-only colour that
 * gets folded into the quote line's description.
 */
export type SurveyScopeItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  rate: number;
  notes: string | null;
};

/**
 * One camera position on the walk-through. Mirrors the schedule Fred actually
 * writes: number, location, indoor/outdoor, cable run — plus the detail that
 * drives the estimate.
 *
 * `position` is stored, not inferred from array index: inserting a head-end
 * camera at 1 shifts every other camera down, and that renumbering has to
 * survive a save.
 *
 * `cable_run` is free text on purpose. Real answers are "Minimal, same room",
 * "<50 ft", "50-100 ft" and "TBD" — forcing a number too early loses the
 * honest "we don't know yet".
 */
export type SurveyCamera = {
  id: string;
  position: number;
  location: string;
  camera_type: string;
  /** Housing/cover detail that belongs on the quote, e.g. "tinted cover". */
  variant: string | null;
  placement: 'Indoor' | 'Outdoor';
  /** Ceiling, Wall, Corner… how it physically goes up. */
  mount: string;
  cable_run: string;
  mount_height_ft: number | null;
  resolution: string;
  status: 'New' | 'Existing' | 'Replace';
  /** What this camera sells for, installed. Drives the quote line. */
  unit_price: number;
  /** Which closet/rack the run comes FROM. "Camera 3 runs from IDF-2." */
  origin_point: string | null;
  /** How the cable gets there: conduit, J-hooks, plenum, core drill. */
  pathway_notes: string | null;
  /** What this position needs beyond the camera itself. */
  materials_needed: string | null;
  notes: string | null;
  /** Photos of the recommended mounting area for THIS camera. */
  photos: string[];
};

export const CAMERA_TYPES = [
  'Dome', 'Turret', 'Bullet', 'PTZ', 'Panoramic', 'Fisheye', 'Multi-sensor', 'Other',
] as const;

export const CAMERA_MOUNTS = [
  'Ceiling', 'Wall', 'Corner', 'Pendant', 'Soffit', 'Pole', 'Recessed', 'Other',
] as const;

/** Housing/cover varieties, offered as a datalist but freely typeable. */
export const CAMERA_VARIANTS = [
  'Tinted cover', 'Clear cover', 'Vandal-resistant', 'IR', 'Varifocal',
  'Weatherproof housing', 'Heater/blower', 'Junction box',
] as const;

export const CAMERA_RESOLUTIONS = ['2MP', '4MP', '5MP', '6MP', '8MP (4K)', '12MP', 'TBD'] as const;

export const CAMERA_STATUSES = ['New', 'Existing', 'Replace'] as const;

/** Common cable-run answers, offered as a datalist but freely typeable. */
export const CABLE_RUN_PRESETS = [
  'Minimal, same room', '<50 ft', '50-100 ft', '100-150 ft', '150-200 ft', '200+ ft', 'TBD',
] as const;

/**
 * What kind of walk-through this is. Drives which page 2 the surveyor gets:
 * a camera job counts mounts and covers, a cabling job counts jacks and
 * terminations, and neither should be asked the other's questions.
 */
export type SurveyType = 'camera' | 'cabling' | 'network' | 'wireless' | 'general';

export const SURVEY_TYPES: { value: SurveyType; label: string; blurb: string }[] = [
  { value: 'camera',   label: 'Cameras / CCTV',   blurb: 'Camera positions, mounts, covers and cable runs' },
  { value: 'cabling',  label: 'Structured Cabling', blurb: 'Drops, jacks, cable type and patch-panel terminations' },
  { value: 'network',  label: 'Network / MDF-IDF', blurb: 'Racks, switches and the drops feeding them' },
  { value: 'wireless', label: 'Wi-Fi / Starlink',  blurb: 'Coverage, mounting points and backhaul' },
  { value: 'general',  label: 'General / Other',   blurb: 'Findings and a priced scope, no device schedule' },
];

/** Which schedule page 2 shows for a given survey type. */
export function scheduleKindFor(t: SurveyType): 'cameras' | 'drops' | 'none' {
  if (t === 'camera') return 'cameras';
  if (t === 'cabling' || t === 'network') return 'drops';
  return 'none';
}

/** One cable drop on a cabling or network walk-through. */
export type CableDrop = {
  id: string;
  position: number;
  location: string;
  /** Jacks at this location — a dual drop is one location, two jacks. */
  jack_count: number;
  cable_type: string;
  /** Free text, same reasoning as a camera's: "85 ft", "TBD". */
  run_length: string;
  /** Where it lands at the head end, e.g. "Patch panel A, ports 12-13". */
  termination: string;
  mount: string;
  /** Price PER JACK — a dual drop is one location billed twice. */
  unit_price: number;
  /** Which closet/rack the run comes FROM. */
  origin_point: string | null;
  /** How the cable gets there: conduit, J-hooks, plenum, core drill. */
  pathway_notes: string | null;
  /** What this drop needs beyond the cable itself. */
  materials_needed: string | null;
  notes: string | null;
  /** Photos of the recommended location for this drop. */
  photos: string[];
};

export const CABLE_TYPES = [
  'Cat6', 'Cat6A', 'Cat5e', 'Cat6A shielded', 'Fiber (MMF)', 'Fiber (SMF)', 'Coax', 'TBD',
] as const;

export const DROP_MOUNTS = [
  'Wall plate', 'Floor box', 'Surface biscuit', 'Ceiling', 'Raceway', 'Rack', 'Other',
] as const;

export type SurveyDocumentKind = 'photo' | 'plan' | 'spec' | 'quote' | 'other';

export const SURVEY_DOC_KINDS: SurveyDocumentKind[] = ['photo', 'plan', 'spec', 'quote', 'other'];

/** A file backing the survey up: site photo, existing plan, spec sheet, vendor quote. */
export type SurveyDocument = {
  id: string;
  url: string;
  name: string;
  kind: SurveyDocumentKind;
  /** Bytes, when the browser reported it. */
  size: number | null;
  caption: string | null;
  uploaded_at: string;
};

export type SurveyPhoto = { url: string; caption: string | null };

export type Survey = {
  id: string;
  user_id: string | null;
  survey_number: string;
  /** (migration-046) join key to the customer master. */
  customer_id: string | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  poc_name: string | null;
  poc_phone: string | null;
  site_name: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  title: string | null;
  survey_date: string | null;
  surveyed_by: string | null;
  status: SurveyStatus;
  existing_conditions: string | null;
  findings: string | null;
  recommendations: string | null;
  notes: string | null;
  scope_items: SurveyScopeItem[];
  labor_rate: number | null;
  labor_hours: number | null;
  tax_rate: number;
  payment_terms: string | null;
  photos: SurveyPhoto[];
  /** (migration-069) which kind of walk-through, and so which pages apply. */
  survey_type: SurveyType;
  /** (migration-069) the page the surveyor last had open, to resume in the field. */
  last_page: number;
  /** (migration-068) the numbered camera schedule the job is priced from. */
  cameras: SurveyCamera[];
  /** (migration-069) the drop schedule, for cabling and network surveys. */
  cable_drops: CableDrop[];
  /** (migration-070) your own questions for this job, and their answers. */
  custom_qa: CustomQAItem[];
  /** (migration-068) site photos, plans, spec sheets, vendor quotes. */
  documents: SurveyDocument[];
  /** (migration-068) head-end / infrastructure findings from the same walk. */
  head_end_notes: string | null;
  rack_space: string | null;
  switch_notes: string | null;
  access_notes: string | null;
  /** The quote this survey produced, once built. */
  quote_id: string | null;
  /** Stamped when that quote is accepted and becomes a job. */
  work_order_id: string | null;
  share_token: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
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
  /** (migration-046) join key to the customer master. */
  customer_id: string | null;
  /** (migration-066) the walk-through this quote was built from. */
  survey_id: string | null;
  /** (migration-070) the contract papered from this quote, once built. */
  contract_id: string | null;
  /** (migration-044) powers the public /quote/<token> client page. */
  share_token: string | null;
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
  /** (migration-046) join key to the customer master. */
  customer_id: string | null;
  /** (migration-042) powers the public /invoice/<token> client page. */
  share_token: string | null;
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

export type MessageSenderRole = 'admin' | 'contractor' | 'client'; // client: a PM or client on the live project sheet (migration 121)

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

  // Location, when the email states it. A go-back list gives a name and street
  // address per site, which become the work order's site fields and the site
  // visit's own address rather than being buried in the description.
  site_name?: string | null;
  site_address?: string | null;
  city?: string;
  state?: string;
  zip?: string;

  // The client's weekly schedule (lib/client-schedule.ts) gives the rest of the
  // visit: the start time, the lockbox, the client's links, and the platform of
  // the client's other jobs.
  start_time?: string | null;
  end_date?: string | null;
  access_instructions?: string | null;
  client_links?: string[];
  checkin_link?: string | null;
  checkout_link?: string | null;
  source_platform?: string;
};

export type ImportQueueItem = {
  id: string;
  user_id: string;
  source: 'netview_smartsheet' | 'field_nation' | 'google_sheets' | 'google_docs' | 'client_schedule';
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
  /** (migration-100) where the tech was when they clocked in / out. */
  checked_in_lat?:      number | null;
  checked_in_lng?:      number | null;
  checked_in_accuracy?: number | null;
  checked_out_lat?:      number | null;
  checked_out_lng?:      number | null;
  checked_out_accuracy?: number | null;
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
  /** (migration-049) per-job rate override; falls back to the tech's default. */
  hourly_rate:      number | null;
  /** (migration-049) what the tech says they did, captured at checkout. */
  work_summary:     string | null;
  /** (migration-049) manual correction when the clock is wrong (missed checkout). */
  adjusted_hours:   number | null;
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
  /** Specific variety/model within the type, e.g. "48-port PoE+ managed". */
  variant?: string;
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

/** A measured cable path on the plan (drop → closet etc.). */
export type PlanRun = {
  id: string;
  points: { x: number; y: number }[];
  note?: string;
};

export type FloorPlan = {
  rooms: PlanRoom[];
  items: PlanItem[];
  /** Optional photo underlay (evac map / blueprint snapshot) traced over. */
  bg?: { url: string; opacity: number } | null;
  /** Plan-units-per-foot calibration set by the Set Scale tool. */
  scale?: { unitsPerFt: number } | null;
  runs?: PlanRun[];
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

// ─── Site visit log (migration-038) — lightweight field tracking ────────────

export type SiteVisitType = 'Project' | 'T&M' | 'Revisit' | 'Survey' | 'Other';
export const SITE_VISIT_TYPES: SiteVisitType[] = ['Project', 'T&M', 'Revisit', 'Survey', 'Other'];

/** One on-site stint; a visit can span several (multi-day jobs). */
export type VisitSession = { in: string; out: string | null };

export type SiteVisit = {
  id: string;
  user_id: string;
  program: string | null;
  site_code: string | null;
  site_name: string | null;
  address: string | null;
  visit_date: string | null;
  time_in: string | null;
  time_out: string | null;
  /** (migration-045) all stints; hours totals the completed ones. */
  sessions: VisitSession[] | null;
  hours: number | null;
  rate: string | null;
  /** (migration-051) fixed project price for non-hourly work. */
  total_project_price: number | null;
  visit_type: SiteVisitType;
  invoice_status: 'not_invoiced' | 'invoiced' | 'na';
  payment_status: 'unpaid' | 'paid' | 'na';
  miles: number | null;
  travel_charge: number | null;
  /**
   * (migration-081) Every part and every drive, one row each.
   *
   * The single columns below are kept as their TOTALS, because the statement,
   * the Excel export and the invoice builder all read them. Rows are the truth;
   * the totals are derived from them by syncVisitTotals on save.
   */
  materials_used: MaterialUsed[] | null;
  mileage_logs: MileageLog[] | null;
  /** (migration-057) Master Entry columns M, N, O and T. */
  materials_description: string | null;
  materials_cost: number | null;
  other_charges: number | null;
  additional_details: string | null;
  notes: string | null;
  /**
   * (migration-050) what the CLIENT sees on the shared report. When empty the
   * report falls back to `notes`, but only if they're short enough to be a real
   * work description — long ones are imported emails and are hidden instead.
   */
  client_summary: string | null;
  work_order_id: string | null;
  /** (migration-046) join key to the customer master. */
  customer_id: string | null;
  /** (migration-051) lead tech. Mirrors the first entry of tech_ids. */
  contractor_id: string | null;
  /**
   * (migration-058) every tech who was on site, lead first. Purely a record
   * of who did the work — it does not change what the client is billed.
   */
  tech_ids: string[];
  /**
   * (migration-062) when this visit was cleared off the board. Null while it is
   * still live work. Never deleted — an archived visit still belongs on the
   * statement for the period it happened in.
   */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

// ── Customer master (migration 046) — the ERP/CRM foundation ────────────────
// One canonical record per client. The free-text names on work orders,
// invoices, quotes and visits stay as the human label; customer_id is the join
// key that makes per-customer reporting possible.

export type CustomerStatus = 'lead' | 'prospect' | 'active' | 'dormant' | 'lost';

export type Customer = {
  /** Fred's own fields (Settings -> Custom fields, migration 110), by field id. */
  custom?: Record<string, unknown> | null;
  id: string;
  user_id: string;
  name: string;
  status: CustomerStatus;
  industry: string | null;
  source: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  payment_terms: string | null;
  /** NULL falls back to user_settings.mileage_rate. */
  default_mileage_rate: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Every spelling that means this customer — 'wendys' and "wendy's" both resolve. */
export type CustomerAlias = {
  id: string;
  user_id: string;
  customer_id: string;
  alias: string;
  created_at: string;
};

export type CustomerContact = {
  id: string;
  user_id: string;
  customer_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ── Portal access grants (migration 048) ────────────────────────────────────
// A revocable, optionally-expiring token letting a helper do a chosen subset of
// what a contractor can. Enforced server-side by portal_resolve + portal_can;
// the UI only decides which controls to draw.

export type PortalCapability =
  | 'view' | 'tasks' | 'answers' | 'upload' | 'documents'
  | 'time' | 'notes' | 'status' | 'messages';

export const PORTAL_CAPABILITIES: { key: PortalCapability; label: string; hint: string }[] = [
  { key: 'view',      label: 'See assigned jobs', hint: 'Required — without this they see nothing' },
  { key: 'tasks',     label: 'Tick off tasks',    hint: 'Mark work order tasks complete' },
  { key: 'answers',   label: 'Answer questions',  hint: 'Fill in the custom questions' },
  { key: 'upload',    label: 'Upload photos',     hint: 'Add pictures and documents to the job' },
  { key: 'documents', label: 'View documents',    hint: 'Open, download and print attached documents' },
  { key: 'time',      label: 'Log time',          hint: 'Travel, arrival, check in and check out' },
  { key: 'notes',     label: 'Write closeout notes', hint: 'Describe what was done' },
  { key: 'status',    label: 'Advance and submit',  hint: 'In Progress / Work Done, and submit for review' },
  { key: 'messages',  label: 'Messages',          hint: 'Read and send messages on the job' },
];

export type PortalGrant = {
  id: string;
  user_id: string;
  token: string;
  label: string;
  contractor_id: string;
  capabilities: PortalCapability[];
  /** NULL = every job assigned to that contractor. */
  scope_wo_ids: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerActivityKind =
  | 'call' | 'email' | 'meeting' | 'note' | 'quote' | 'invoice' | 'job';

export type CustomerActivity = {
  id: string;
  user_id: string;
  customer_id: string;
  contact_id: string | null;
  kind: CustomerActivityKind;
  subject: string | null;
  body: string | null;
  occurred_at: string;
  created_at: string;
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
/**
 * A column Fred defined himself, computed from the other columns on the row.
 * The expression is evaluated by lib/formula.ts — a parser, never eval().
 */
export type FormulaColumn = {
  id: string;
  user_id: string | null;
  name: string;
  expression: string;
  format: 'number' | 'money' | 'percent' | 'text';
  position: number;
  applies_to: 'site_visits' | 'assets';
  created_at: string;
  updated_at: string;
};

/** A piece of kit at a client site — the CMMS asset register (migration 061). */
export type Asset = {
  id: string;
  user_id: string | null;
  customer_id: string | null;
  program: string | null;
  site_code: string | null;
  site_name: string | null;
  name: string;
  asset_type: string | null;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  location_in_site: string | null;
  installed_on: string | null;
  status: 'active' | 'needs_repair' | 'retired';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** A recurring task. asset_id null means it is against the site, not one item. */
export type MaintenancePlan = {
  id: string;
  user_id: string | null;
  asset_id: string | null;
  program: string | null;
  site_code: string | null;
  site_name: string | null;
  task: string;
  interval_days: number;
  last_done_on: string | null;
  next_due_on: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Which visit discharged which task — the maintenance history. */
export type MaintenanceEvent = {
  id: string;
  user_id: string | null;
  plan_id: string | null;
  asset_id: string | null;
  site_visit_id: string | null;
  done_on: string;
  notes: string | null;
  created_at: string;
};

/**
 * A line on the pay panel, on top of labour (migration-065).
 *
 * Modelled on the way Field Nation presents a work order's pay: labour, then
 * Additional Charges that add, and Service Charges and Tax that deduct, with a
 * sum at the bottom. Fixed fields could not hold that — a per diem, a toll or a
 * platform fee had nowhere to go — so this is one list and a new kind of charge
 * never needs a new column.
 */
export type PayAddonKind =
  | 'labour' | 'materials' | 'mileage' | 'per_diem' | 'tolls_parking' | 'permit'
  | 'equipment' | 'bonus' | 'tax' | 'service_fee' | 'deduction' | 'other';

export type PayAddon = {
  id: string;
  kind: PayAddonKind;
  /** What it is, in Fred's words. Falls back to the kind's own name. */
  label: string;
  /**
   * A flat figure, OR the result of qty x rate when both are set.
   *
   * Two hours at $55 and 117.4 miles at $0.50 are the same shape, so one line
   * type covers labour, mileage, per-device work and a plain charge. Rate and
   * hours stopped being fields of their own for exactly this reason.
   */
  amount: number;
  qty?: number | null;
  rate?: number | null;
  /** True takes it off the payout (tax, platform fee); false adds it. */
  deduct: boolean;
  /**
   * Which side of the job this line lands on. Both can be true — travel is
   * often billed to the client AND paid back to the tech who drove — and both
   * can be false while a figure is still being worked out.
   *
   * This is why one list replaced the separate travel, materials and mileage
   * fields: whether a charge is revenue, a cost, or both varies per job, and
   * three sets of fields could not say so without contradicting each other.
   */
  bill_client: boolean;
  pay_tech: boolean;
  /** Who it belongs to. Empty means the job's lead tech. */
  contractor_name?: string | null;
};
