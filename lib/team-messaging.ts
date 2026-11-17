export type MessagingContact = { id: string; name: string; role: string; connected: boolean };
export type MessagingJob = { id: string; number: string; title: string | null; place: string; date: string | null };
export type TeamMessage = {
  id: string; peer_id: string; office_id: string; contractor_id: string; sender_id: string; sender_name: string;
  content: string; created_at: string; read_at: string | null; mine: boolean;
  job_id: string | null; job_number: string | null; job_title: string | null; job_place: string | null;
  proposed_date: string | null; availability: 'pending' | 'available' | 'unavailable' | null;
  response_note: string | null; responded_at: string | null;
};
export type MessagingSnapshot = {
  me: { id: string; name: string; role: string };
  contacts: MessagingContact[]; jobs: MessagingJob[]; messages: TeamMessage[];
};
export type MessagingAdapter = {
  load: () => Promise<MessagingSnapshot>;
  send: (peer: string, content: string, job: string | null, date: string | null) => Promise<void>;
  read: (peer: string) => Promise<void>;
  respond: (id: string, status: 'available' | 'unavailable', note: string) => Promise<void>;
};
export const roleLabel = (role: string) => ({ admin: 'Administrator', project_manager: 'Project manager', assistant: 'Assistant', technician: 'Technician' })[role] ?? role;
export const requestLabel = (status: TeamMessage['availability']) => ({ pending: 'Awaiting reply', available: 'Available', unavailable: 'Unavailable' })[status ?? 'pending'];
export function threadMessages(messages: TeamMessage[], peer: string) {
  return messages.filter((m) => m.peer_id === peer).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
export function unreadMessages(messages: TeamMessage[], peer?: string) {
  return messages.filter((m) => !m.mine && !m.read_at && (!peer || m.peer_id === peer)).length;
}
