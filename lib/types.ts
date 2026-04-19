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

export type WorkOrder = {
  id: string;
  user_id: string;
  wo_number: string;
  contractor_name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  total_amount: number;
  created_at: string;
  updated_at: string;
};

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
};

export type EnrichedWorkOrder = WorkOrder & {
  paid: number;
  remaining: number;
  status: 'paid' | 'partial' | 'pending';
};

export type PaymentMethod =
  | 'Cash' | 'Check' | 'Zelle' | 'Venmo' | 'CashApp'
  | 'PayPal' | 'Bank Transfer' | 'Credit Card' | 'Other';

export const PAYMENT_METHODS: PaymentMethod[] = [
  'Cash', 'Check', 'Zelle', 'Venmo', 'CashApp',
  'PayPal', 'Bank Transfer', 'Credit Card', 'Other',
];
