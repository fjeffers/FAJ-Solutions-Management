// Fillable PDF forms, filled in the app (Fred, 2026-10-22: documents "not
// working for all ... ios, windows, and android ... some way you can convert
// the form to be fillable"). A phone's own PDF viewer often can't type into a
// form's boxes (Android Chrome downloads the PDF instead of showing it), so
// the app reads the boxes itself with pdf-lib, shows each as a box to type in,
// tick or pick, and writes the answers back. The PDF editor then opens the
// filled copy for signing; saving flattens it, so the answers stay put.

export type FormField =
  | { kind: 'text'; name: string; label: string; value: string; multiline: boolean; maxLength: number | null }
  | { kind: 'check'; name: string; label: string; value: boolean }
  | { kind: 'choice'; name: string; label: string; value: string; options: string[] };

export type FormValues = Record<string, string | boolean>;

/** "Text Field 12" / "Customer_Name[0]" → "Customer name". */
export function fieldLabel(name: string, tooltip?: string | null): string {
  const t = (tooltip ?? '').replace(/\s+/g, ' ').trim();
  if (t) return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  const last = name.split('.').pop() ?? name;
  const words = last.replace(/\[\d+\]$/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  if (!words) return 'Field';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** The boxes a PDF asks to be filled in; [] when it has none or can't be read. */
export async function readFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, PDFName, PDFString, PDFHexString } = await import('pdf-lib');
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { return []; }
  let fields;
  try { fields = doc.getForm().getFields(); } catch { return []; }
  const tip = (f: { acroField: { dict: { lookup: (n: unknown) => unknown } } }) => {
    const v = f.acroField.dict.lookup(PDFName.of('TU'));
    return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null;
  };
  const out: FormField[] = [];
  for (const f of fields) {
    const name = f.getName();
    if (f.isReadOnly()) continue;
    const label = fieldLabel(name, tip(f as never));
    if (f instanceof PDFTextField) {
      out.push({ kind: 'text', name, label, value: f.getText() ?? '', multiline: f.isMultiline(), maxLength: f.getMaxLength() ?? null });
    } else if (f instanceof PDFCheckBox) {
      out.push({ kind: 'check', name, label, value: f.isChecked() });
    } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      out.push({ kind: 'choice', name, label, value: f.getSelected()[0] ?? '', options: f.getOptions() });
    } else if (f instanceof PDFRadioGroup) {
      out.push({ kind: 'choice', name, label, value: f.getSelected() ?? '', options: f.getOptions() });
    }
  }
  return out;
}

/** The same PDF with the answers written into its boxes (still a form; the editor flattens it on save). */
export async function fillForm(bytes: Uint8Array, values: FormValues): Promise<Uint8Array> {
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  for (const f of form.getFields()) {
    const name = f.getName();
    if (!(name in values) || f.isReadOnly()) continue;
    const v = values[name];
    try {
      if (f instanceof PDFTextField) {
        const max = f.getMaxLength();
        const text = String(v ?? '');
        f.setText(max != null ? text.slice(0, max) : text);
      } else if (f instanceof PDFCheckBox) {
        if (v === true) f.check(); else f.uncheck();
      } else if ((f instanceof PDFDropdown || f instanceof PDFOptionList) && typeof v === 'string') {
        if (v) f.select(v); else f.clear();
      } else if (f instanceof PDFRadioGroup && typeof v === 'string' && v) {
        f.select(v);
      }
    } catch { /* a box that won't take the value keeps its own */ }
  }
  // Draw the answers in a plain font so every viewer shows them the same way.
  try { form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica)); } catch { /* keep the PDF's own look */ }
  return doc.save();
}
