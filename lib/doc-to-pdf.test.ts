// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { blocksFromHtml, blocksToPdf, wrapLine } from './doc-to-pdf';
import { fieldLabel, fillForm, readFormFields } from './pdf-form';

const page = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('a Word document made into a PDF', () => {
  it('reads headings, paragraphs, lists and tables in order', () => {
    const blocks = blocksFromHtml(page(
      '<h1>Site checklist</h1><p>Tech name: Mike&nbsp; Wise</p><ul><li>Rack labeled</li><li>Photos taken</li></ul>'
      + '<ol><li>Arrive</li></ol><table><tr><th>Item</th><th>Done</th></tr><tr><td>Patch panel</td><td>Yes</td></tr></table><p>   </p>'));
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Site checklist' },
      { kind: 'para', text: 'Tech name: Mike Wise' },
      { kind: 'item', text: 'Rack labeled', marker: '•' },
      { kind: 'item', text: 'Photos taken', marker: '•' },
      { kind: 'item', text: 'Arrive', marker: '1.' },
      { kind: 'row', cells: ['Item', 'Done'], header: true },
      { kind: 'row', cells: ['Patch panel', 'Yes'], header: false },
    ]);
  });
  it('wraps words onto lines and cuts a word too long for one', () => {
    const w = (s: string) => s.length;
    expect(wrapLine('one two three four', 9, w)).toEqual(['one two', 'three', 'four']);
    expect(wrapLine('abcdefghij', 4, w)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapLine('a\nb', 10, w)).toEqual(['a', 'b']);
  });
  it('makes a PDF, curly quotes and all', async () => {
    const bytes = await blocksToPdf([{ kind: 'heading', level: 1, text: 'Sign-off' }, { kind: 'para', text: '“Done” — it’s all set ☐' },
      { kind: 'row', cells: ['A', 'B'], header: true }], 'Sign-off');
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});

describe('fillable PDF boxes', () => {
  it('reads the boxes, fills them, and the answers are in the PDF', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.create();
    const p = d.addPage([612, 792]);
    const form = d.getForm();
    form.createTextField('Tech_Name').addToPage(p, { x: 50, y: 700, width: 200, height: 20 });
    form.createCheckBox('Work_Complete').addToPage(p, { x: 50, y: 650, width: 14, height: 14 });
    const dd = form.createDropdown('Result'); dd.addOptions(['Pass', 'Fail']); dd.addToPage(p, { x: 50, y: 600, width: 120, height: 20 });
    const bytes = await d.save();

    const fields = await readFormFields(bytes);
    expect(fields.map((f) => [f.kind, f.label])).toEqual([['text', 'Tech name'], ['check', 'Work complete'], ['choice', 'Result']]);

    const filled = await fillForm(bytes, { Tech_Name: 'Mike Wise', Work_Complete: true, Result: 'Pass' });
    const again = await readFormFields(filled);
    expect(again.map((f) => f.value)).toEqual(['Mike Wise', true, 'Pass']);
  });
  it('has no boxes for a plain PDF or something that is not a PDF', async () => {
    expect(await readFormFields(await blocksToPdf([{ kind: 'para', text: 'Hi' }], 'x'))).toEqual([]);
    expect(await readFormFields(new Uint8Array([1, 2, 3]))).toEqual([]);
  });
  it('names a box by its tooltip, or tidies its name', () => {
    expect(fieldLabel('form1[0].Customer_Name[0]')).toBe('Customer name');
    expect(fieldLabel('Text Field 12', 'Site ID')).toBe('Site ID');
    expect(fieldLabel('dateSigned')).toBe('Date signed');
  });
});
