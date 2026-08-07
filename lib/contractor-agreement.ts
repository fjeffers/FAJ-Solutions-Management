// The agreement a tech reads and signs in their portal.
//
// This lives in code rather than as an uploaded PDF so it is always present:
// contractors.contract_url was null for every contractor, which meant the
// portal asked techs to sign something they could not read. A signature on an
// unreadable document is worth nothing.
//
// contract_url still wins when set, so a lawyer-reviewed PDF can replace this
// per contractor without a code change.
//
// NOT LEGAL ADVICE. These are ordinary independent-contractor terms, not
// counsel. Have them reviewed before relying on them.

export const AGREEMENT_VERSION = '2026-08';

export type AgreementClause = { heading: string; body: string };

export const CONTRACTOR_AGREEMENT: AgreementClause[] = [
  {
    heading: 'Independent contractor',
    body:
      'You are an independent contractor, not an employee of FAJ Solutions. You control how and when the work is performed. Nothing here creates an employment, partnership, or joint venture relationship.',
  },
  {
    heading: 'The work',
    body:
      'FAJ Solutions may offer you assignments — network and low-voltage installation, cabling, site surveys and related field services. You may accept or decline any assignment. Each accepted assignment is governed by the scope, site and price agreed for that job.',
  },
  {
    heading: 'Pay',
    body:
      'Pay for each assignment is the amount agreed for that assignment, either an hourly rate or a fixed price. Submit the job as complete when you finish. FAJ Solutions pays after the work is reviewed and approved, normally within 14 days. Approved mileage and pre-agreed expenses are reimbursed with the job.',
  },
  {
    heading: 'Taxes',
    body:
      'You are responsible for all of your own taxes. FAJ Solutions does not withhold income tax, Social Security or Medicare. You must file a Form W-9 before your first payment, and FAJ Solutions will issue a Form 1099-NEC where required by law.',
  },
  {
    heading: 'Your own costs',
    body:
      'You supply your own tools, vehicle, phone and transport unless a job says otherwise. You are not entitled to employee benefits — no health insurance, paid leave, retirement contributions, workers compensation or unemployment insurance.',
  },
  {
    heading: 'Insurance and liability',
    body:
      'You are responsible for maintaining any insurance appropriate to your work. You are responsible for damage or loss caused by your own negligence or misconduct on site.',
  },
  {
    heading: 'How you work on site',
    body:
      'Work safely, follow the site rules and the client’s requirements, and hold any licences or certifications your work requires. Complete the check-in, photo and closeout steps an assignment asks for — they are how the job gets approved and paid.',
  },
  {
    heading: 'Confidentiality',
    body:
      'Client names, site details, network layouts, credentials, pricing and anything else you learn through an assignment are confidential. Do not share them or use them outside the work. This continues after this agreement ends.',
  },
  {
    heading: 'Ending this agreement',
    body:
      'Either of us may end this agreement at any time, with or without reason. Ending it does not affect payment owed for work already completed and approved, and does not release you from the confidentiality section.',
  },
  {
    heading: 'Governing law',
    body:
      'This agreement is governed by the laws of the Commonwealth of Pennsylvania.',
  },
];

export const AGREEMENT_CERTIFICATION =
  'By typing my full legal name below I confirm I have read and agree to this agreement, and that I am signing as an independent contractor.';
