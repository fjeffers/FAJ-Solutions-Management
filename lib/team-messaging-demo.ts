import type { MessagingAdapter, MessagingContact, MessagingJob, TeamMessage } from './team-messaging';
import { todayEastern } from './assistant';

export const DEMO_PEOPLE: MessagingContact[] = [
  { id: 'office-admin', name: 'Morgan Blake', role: 'admin', connected: true },
  { id: 'office-pm', name: 'Avery Mitchell', role: 'project_manager', connected: true },
  { id: 'office-assistant', name: 'Jordan Lee', role: 'assistant', connected: true },
  { id: 'tech-alex', name: 'Alex Carter', role: 'technician', connected: true },
  { id: 'tech-maya', name: 'Maya Thompson', role: 'technician', connected: true },
  { id: 'tech-chris', name: 'Chris Rivera', role: 'technician', connected: true },
  { id: 'tech-sam', name: 'Sam Wilson', role: 'technician', connected: true },
];
export const DEMO_STORAGE_KEY = 'faj-team-messaging-demo-v1';
export function demoJobs(): MessagingJob[] {
  const date = new Date(`${todayEastern()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 2);
  const day = date.toISOString().slice(0, 10);
  return [
    { id: 'job-1048', number: '1048', title: 'Network equipment installation', place: 'Charlotte, NC', date: day },
    { id: 'job-1052', number: '1052', title: 'Security camera site survey', place: 'Raleigh, NC', date: day },
    { id: 'job-1056', number: '1056', title: 'Access point replacement', place: 'Greenville, SC', date: day },
  ];
}
export function seedDemoMessages(): TeamMessage[] {
  const make = (id: string, office: string, tech: string, sender: string, content: string, minutes: number): TeamMessage => ({
    id, office_id: office, contractor_id: tech, peer_id: tech, sender_id: sender,
    sender_name: DEMO_PEOPLE.find((p) => p.id === sender)!.name, content,
    created_at: new Date(Date.now() - minutes * 60000).toISOString(), read_at: null, mine: false,
    job_id: null, job_number: null, job_title: null, job_place: null, proposed_date: null,
    availability: null, response_note: null, responded_at: null,
  });
  const request = make('seed-request', 'office-pm', 'tech-alex', 'office-pm', 'Hi Alex! Are you available for this installation? The site is ready for us. We would plan on a 9 AM start.', 36);
  Object.assign(request, { job_id: 'job-1048', job_number: '1048', job_title: 'Network equipment installation', job_place: 'Charlotte, NC', proposed_date: demoJobs()[0].date, availability: 'pending' });
  return [
    make('seed-1', 'office-pm', 'tech-alex', 'tech-alex', 'Morning Avery! I wrapped up the cabling at the last site. Ready to talk about the next one.', 44),
    request,
    make('seed-2', 'office-pm', 'tech-maya', 'tech-maya', 'The site survey photos are uploaded. Let me know if you need anything else.', 72),
    make('seed-3', 'office-admin', 'tech-alex', 'office-admin', 'Welcome to team messenger, Alex. You can reach me directly here.', 95),
    make('seed-4', 'office-assistant', 'tech-alex', 'office-assistant', 'Hi Alex, I can help coordinate site access and your upcoming schedule.', 110),
  ];
}
export function createDemoAdapter(personId: string, storage: Pick<Storage, 'getItem' | 'setItem'>): MessagingAdapter {
  const me = DEMO_PEOPLE.find((p) => p.id === personId)!;
  const tech = me.role === 'technician';
  const readAll = (): TeamMessage[] => {
    const saved = storage.getItem(DEMO_STORAGE_KEY);
    if (saved) { try { const parsed = JSON.parse(saved); if (Array.isArray(parsed)) return parsed; } catch { /* replace invalid demo state */ } }
    const seeded = seedDemoMessages(); storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(seeded)); return seeded;
  };
  const save = (messages: TeamMessage[]) => storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(messages));
  const belongs = (m: TeamMessage) => tech ? m.contractor_id === me.id : m.office_id === me.id;
  const contacts = DEMO_PEOPLE.filter((p) => tech ? p.role !== 'technician' : p.role === 'technician');
  return {
    load: async () => ({
      me, contacts, jobs: tech ? [] : demoJobs(),
      messages: readAll().filter(belongs).map((m) => ({ ...m, peer_id: tech ? m.office_id : m.contractor_id, mine: m.sender_id === me.id })),
    }),
    send: async (peer, content, jobId, date) => {
      if (!contacts.some((c) => c.id === peer) || !content.trim() || content.length > 4000) throw new Error('Choose a contact and enter a message.');
      const job = jobId ? demoJobs().find((j) => j.id === jobId) : null;
      if ((jobId && (!job || tech || !date || date < todayEastern())) || (!jobId && date)) throw new Error('Choose a work order and a date from today onward.');
      save([...readAll(), {
        id: crypto.randomUUID(), office_id: tech ? peer : me.id, contractor_id: tech ? me.id : peer,
        peer_id: peer, sender_id: me.id, sender_name: me.name, content: content.trim(), created_at: new Date().toISOString(),
        read_at: null, mine: true, job_id: job?.id ?? null, job_number: job?.number ?? null,
        job_title: job?.title ?? null, job_place: job?.place ?? null, proposed_date: date,
        availability: job ? 'pending' : null, response_note: null, responded_at: null,
      }]);
    },
    read: async (peer) => save(readAll().map((m) => belongs(m) && m.sender_id !== me.id && (tech ? m.office_id : m.contractor_id) === peer ? { ...m, read_at: m.read_at ?? new Date().toISOString() } : m)),
    respond: async (id, status, note) => {
      const all = readAll(); const request = all.find((m) => m.id === id && belongs(m));
      if (!tech || !request || request.availability !== 'pending') throw new Error('Request already answered or not available.');
      save(all.map((m) => m.id === id ? { ...m, availability: status, response_note: note.trim() || null, responded_at: new Date().toISOString() } : m));
    },
  };
}
