import { describe, expect, it } from 'vitest';
import { buildWoPrompt, parseModelJson, sanitizeWoAi, filledCount, WO_AI_MODEL, aiFailureReason, aiFailureText, type AiCustomField } from './wo-ai';

describe('Generate with AI', () => {
  it('uses a model that exists', () => {
    expect(WO_AI_MODEL).toBe('claude-opus-5-5');
  });

  it('asks for every field and the checklist, and never to invent', () => {
    const p = buildWoPrompt('Install 4 cameras', '2026-10-02');
    for (const k of ['external_wo_id', 'access_instructions', 'parking_instructions', 'deliverables', 'wo_tasks', 'time_zone', 'support_contact', 'parts_materials',
      'check_in_required', 'check_out_required', 'assignment_type', 'expense_budget', 'travel_amount', 'bonus_amount', 'contacts', 'custom_qa']) {
      expect(p).toContain(`"${k}"`);
    }
    expect(p).toContain('NEVER invent');
    expect(p).toContain('Today is 2026-10-02');
  });

  it('finds the JSON even with fences or words around it', () => {
    expect(parseModelJson('```json\n{"title":"A"}\n```')).toEqual({ title: 'A' });
    expect(parseModelJson('Here you go: {"a":1} thanks')).toEqual({ a: 1 });
    expect(parseModelJson('no json here')).toBeNull();
  });

  it('keeps only what the form understands, in the right shapes', () => {
    const f = sanitizeWoAi({
      title: "Wendy's #5798 — POS refresh", description: 'Replace switch', site_state: 'pa', site_city: 'Roselle',
      service_type: 'network/it', priority: 'high', source_platform: 'Field Nation', pay_type: 'fixed',
      total_amount: '$1,250.00', device_count: '4.4', start_date: '2026-10-06', start_time: '8:00',
      end_time: '25:00', time_zone: 'America/New_York', poc_email: 'not an email', photo_required: true,
      signature_required: 'yes',
      contractor_name: 'Jere Jones', contractor_pay: { 'Jere Jones': 400 }, wo_status: 'Paid', user_id: 'x',
    });
    expect(f).toMatchObject({
      title: "Wendy's #5798 — POS refresh", site_state: 'PA', service_type: 'Network / IT', priority: 'High',
      source_platform: 'FieldNation', pay_type: 'Fixed', total_amount: 1250, device_count: 4,
      start_date: '2026-10-06', scheduled_date: '2026-10-06', start_time: '08:00', time_zone: 'America/New_York',
      photo_required: true,
    });
    // Never from the model: techs, tech pay, status, owner — and nothing malformed.
    for (const k of ['contractor_name', 'contractor_pay', 'wo_status', 'user_id', 'end_time', 'poc_email', 'signature_required']) {
      expect(f).not.toHaveProperty(k);
    }
  });

  it('turns the checklist into real checklist items', () => {
    const f = sanitizeWoAi({ wo_tasks: [
      { category: 'Pre Visit', label: 'Call the store manager 30 minutes before arrival' },
      { category: 'somewhere', label: 'Replace the switch' },
      'Take before and after photos',
      { category: 'Post Site', label: '' },
    ] });
    expect(f.wo_tasks?.map((t) => [t.category, t.label, t.completed])).toEqual([
      ['Pre Visit', 'Call the store manager 30 minutes before arrival', false],
      ['On Site', 'Replace the switch', false],
      ['On Site', 'Take before and after photos', false],
    ]);
    expect(new Set(f.wo_tasks?.map((t) => t.id)).size).toBe(3);
  });

  it('counts what it filled', () => {
    expect(filledCount(sanitizeWoAi({ title: 'A', start_date: '2026-10-06', wo_tasks: ['x'] }))).toBe(2);
  });

  // Fred, 2026-10-18: "fill in every field on the work order".
  const own: AiCustomField[] = [
    { id: 'f1', label: 'Store hours', kind: 'text', options: [] },
    { id: 'f2', label: 'Ladder needed', kind: 'yesno', options: [] },
    { id: 'f3', label: 'Ceiling height', kind: 'number', options: [] },
    { id: 'f4', label: 'Region', kind: 'choice', options: ['North', 'South'] },
    { id: 'f5', label: 'Permit date', kind: 'date', options: [] },
  ];

  it("asks for every field, Fred's own fields when he has them, never techs or tech pay", () => {
    const prompt = buildWoPrompt('x', '2026-10-18', own);
    for (const k of ['title', 'site_state', 'time_zone', 'check_in_required', 'assignment_type', 'travel_amount', 'contacts', 'custom_qa', 'wo_tasks', 'client_links']) {
      expect(prompt).toContain(`"${k}"`);
    }
    for (const k of ['contractor_name', 'contractor_pay', 'contractor_names', 'wo_status']) expect(prompt).not.toContain(`"${k}"`);
    expect(prompt).toContain('"f4": Region — one of ["North","South"]');
    expect(prompt).toContain('"f2": ');
    expect(buildWoPrompt('x', '2026-10-18')).not.toContain('"custom"');
  });

  it('fills check-in and out, budgets, every contact, the questions and Fred\'s own fields', () => {
    const f = sanitizeWoAi({
      check_in_required: true, check_out_required: false, assignment_type: 'subcontract',
      expense_budget: '$150', travel_amount: 40, bonus_amount: null,
      contacts: [
        { label: 'Site manager', name: 'Dana Lee', phone: '555-0100', email: 'dana@example.test' },
        { label: 'Help desk', name: '', phone: '555-0199', email: 'not-an-email' },
        { label: 'Nobody', name: '', phone: '', email: '' },
      ],
      custom_qa: [{ label: 'Serial number of the new switch', type: 'text' }, { label: 'Photo of the rack', type: 'photo' }, { label: 'Odd', type: 'video' }, { label: '' }],
      custom: { f1: '6am-11pm', f2: true, f3: '$12', f4: 'south', f5: '2026-10-20', f9: 'not a field' },
    }, own);
    expect(f).toMatchObject({ check_in_required: true, check_out_required: false, assignment_type: 'Subcontract', expense_budget: 150, travel_amount: 40 });
    expect(f).not.toHaveProperty('bonus_amount');
    expect(f.contacts?.map((c) => [c.label, c.name, c.phone, c.email])).toEqual([
      ['Site manager', 'Dana Lee', '555-0100', 'dana@example.test'],
      ['Help desk', '', '555-0199', ''],
    ]);
    expect(f.custom_qa?.map((q) => [q.label, q.type, q.answer])).toEqual([
      ['Serial number of the new switch', 'text', null], ['Photo of the rack', 'photo', null], ['Odd', 'text', null],
    ]);
    expect(f.custom).toEqual({ f1: '6am-11pm', f2: true, f3: 12, f4: 'South', f5: '2026-10-20' });
    // Fred's own fields count one each.
    expect(filledCount(f)).toBe(5 + 2 + 5);
  });
});

describe('Generate with AI failure reasons', () => {
  it('names the real problem', () => {
    expect(aiFailureReason(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')).toBe('ai_credit');
    expect(aiFailureReason(401, 'invalid x-api-key')).toBe('ai_401');
    expect(aiFailureReason(404, 'model: not found')).toBe('ai_404');
    expect(aiFailureReason(529, 'Overloaded')).toBe('ai_busy');
    expect(aiFailureReason(400, 'messages: field required')).toBe('ai_400');
    expect(aiFailureReason(400, 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header')).toBe('ai_workspace');
  });
  it('says it in plain words, and never blames the person', () => {
    expect(aiFailureText('ai_credit')).toMatch(/out of credit/);
    expect(aiFailureText('no_key')).toMatch(/no AI key/);
    expect(aiFailureText('ai_401')).toMatch(/refused/);
    expect(aiFailureText(undefined)).toMatch(/didn't answer/);
    for (const w of ['no_key', 'ai_401', 'ai_credit', 'ai_busy', undefined]) expect(aiFailureText(w)).toMatch(/then Save\.$/);
  });
});

describe('Generate with AI: client links and the template', async () => {
  const { sanitizeWoAi, buildWoPrompt } = await import('./wo-ai');
  const templates = [{ id: 'lds-1', name: 'LDS' }];
  it('keeps the links and a template that exists', () => {
    const out = sanitizeWoAi({ client_links: ['https://drive.google.com/x', 'not a link'], template: 'lds-1' }, [], templates);
    expect(out.client_links).toEqual(['https://drive.google.com/x']);
    expect(out.template).toBe('lds-1');
    expect(sanitizeWoAi({ template: 'made-up' }, [], templates).template).toBeUndefined();
  });
  it('asks for the links and offers only Fred’s templates', () => {
    expect(buildWoPrompt('job', '2026-10-18', [], templates)).toContain('"client_links"');
    expect(buildWoPrompt('job', '2026-10-18', [], templates)).toContain('"name":"LDS"');
    expect(buildWoPrompt('job', '2026-10-18')).not.toContain('"template"');
  });
});

describe('reading the answer (Fred, 2026-10-18: Generate with AI fell back to the text parser)', async () => {
  const { sanitizeWoAi } = await import('./wo-ai');
  it('reads "" as not said, and "yes"/"no" for Fred\'s yes/no fields', () => {
    const f = sanitizeWoAi({ title: '', service_type: '', template: '', custom: { f2: 'yes', f9: 'no' } }, [
      { id: 'f2', label: 'Permit', kind: 'yesno', options: [] }, { id: 'f9', label: 'Lift', kind: 'yesno', options: [] },
    ], [{ id: 'lds-1', name: 'LDS' }]);
    expect(f.title).toBeUndefined();
    expect(f.service_type).toBeUndefined();
    expect(f.template).toBeUndefined();
    expect(f.custom).toEqual({ f2: true, f9: false });
  });
});

