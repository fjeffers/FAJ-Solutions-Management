import { describe, expect, it } from 'vitest';
import { linkPurpose, linkTag } from './site-links';

const s = { checkin: 'https://teams.live.com/x', checkout: 'https://app.smartsheet.com/b/form/1', deliverable: 'https://drive.google.com/drive/folders/abc', survey: 'https://survey.ldsqa.fyi/' };

describe('Client link tags', () => {
  it('tags each marked link on the office card', () => {
    expect(linkTag(s.checkin, s)).toBe('Opens on check-in');
    expect(linkTag(s.checkout, s)).toBe('Opens on check-out');
    expect(linkTag(s.deliverable, s)).toBe('Deliverables (upload)');
    expect(linkTag(s.survey, s)).toBe('Site survey');
    expect(linkTag('https://deliverables.ldsqa.fyi/', s)).toBe('Site Deliverables page');
    expect(linkTag('https://lds-tools-hub.ldsqa.fyi/', s)).toBeNull();
  });
  it("tells the tech what the customer's deliverables page is", () => {
    expect(linkPurpose('https://deliverables.ldsqa.fyi/', s)).toBe("The customer's Site Deliverables page");
  });
});
