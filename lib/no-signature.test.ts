import { describe, expect, it } from 'vitest';
import { noSignatureJob, wfJobFromOwner, wfJobFromTech } from './wf';

describe('No signature on LDS jobs', () => {
  it('spots LDS jobs by ticket, name or meetinghouse', () => {
    expect(noSignatureJob({ title: 'LDS-1103 - 5333202 - FAYETTEVILLE' })).toBe(true);
    expect(noSignatureJob({ title: 'Network install', description: 'Church meetinghouse' })).toBe(true);
    expect(noSignatureJob({ title: 'Fields office cabling', description: 'Builds out the IDF' })).toBe(false);
  });
  it("an LDS job never asks for the customer's signature, even if the box was ticked", () => {
    expect(wfJobFromTech({ id: '1', wo_number: '1', title: 'LDS-1103 Fayetteville', signature_required: true }).signatureRequired).toBe(false);
    expect(wfJobFromOwner({ id: '2', wo_number: '2', title: "Wendy's POS", signature_required: true } as never).signatureRequired).toBe(true);
  });
});
