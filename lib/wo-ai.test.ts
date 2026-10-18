import { describe, expect, it } from 'vitest';
import { buildWoPrompt, parseModelJson, sanitizeWoAi, filledCount, WO_AI_MODEL, aiFailureReason, aiFailureText } from './wo-ai';

describe('Generate with AI', () => {
  it('uses a model that exists', () => {
    expect(WO_AI_MODEL).toBe('claude-sonnet-5-5');
  });

  it('asks for every field and the checklist, and never to invent', () => {
    const p = buildWoPrompt('Install 4 cameras', '2026-10-02');
    for (const k of ['external_wo_id', 'access_instructions', 'parking_instructions', 'deliverables', 'wo_tasks', 'time_zone', 'support_contact', 'parts_materials']) {
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
});

describe('Generate with AI failure reasons', () => {
  it('names the real problem', () => {
    expect(aiFailureReason(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')).toBe('ai_credit');
    expect(aiFailureReason(401, 'invalid x-api-key')).toBe('ai_401');
    expect(aiFailureReason(404, 'model: not found')).toBe('ai_404');
    expect(aiFailureReason(529, 'Overloaded')).toBe('ai_busy');
    expect(aiFailureReason(400, 'messages: field required')).toBe('ai_400');
  });
  it('says it in plain words, and never blames the person', () => {
    expect(aiFailureText('ai_credit')).toMatch(/out of credit/);
    expect(aiFailureText('no_key')).toMatch(/no AI key/);
    expect(aiFailureText('ai_401')).toMatch(/refused/);
    expect(aiFailureText(undefined)).toMatch(/didn't answer/);
    for (const w of ['no_key', 'ai_401', 'ai_credit', 'ai_busy', undefined]) expect(aiFailureText(w)).toMatch(/then Save\.$/);
  });
});
