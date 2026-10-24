// A job's site as the map shows it (Fred, 2026-10-24: "also the maps needs to
// update the address and site info"): the full address on one line, and the
// client's numbers (ticket, site) next to the job's own.
import type { WorkOrder } from './types';

type Site = Pick<WorkOrder, 'site_address' | 'site_city' | 'site_state' | 'site_zip'>;

/** "6420 Morganton Road, Fayetteville, NC 28314" — whatever parts are there. */
export const fullAddress = (w: Site): string =>
  [w.site_address, w.site_city, [w.site_state, w.site_zip].filter(Boolean).join(' ')].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');

/** "Ticket LDS-1103 · Site 5333202" — or nothing. */
export const clientNumbers = (w: Pick<WorkOrder, 'external_wo_id' | 'client_reference'>): string =>
  [w.external_wo_id && `Ticket ${w.external_wo_id}`, w.client_reference && `Site ${w.client_reference}`].filter(Boolean).join(' · ');

/** Everyone on the job, the lead first. */
export const techsOf = (w: Pick<WorkOrder, 'contractor_name' | 'contractor_names'>): string[] =>
  (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter((t): t is string => !!t);
