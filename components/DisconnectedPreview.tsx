'use client';

import { useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CalendarDays,
  CheckCircle2, ChevronDown, CircleDollarSign, Clock3, HardHat, MapPin,
  Search, ShieldCheck, Users, Wrench,
} from 'lucide-react';

type Area = 'Overview' | 'Work orders' | 'Technicians' | 'Financials' | 'Schedule' | 'Dispatch';
type Job = { id: string; title: string; client: string; tech: string; date: string; status: string; amount: string; city: string };

const jobs: Job[] = [
  { id: 'WO-2418', title: 'Network cabinet installation', client: 'Northstar Retail', tech: 'Marcus Lee', date: 'Today · 9:00 AM', status: 'In progress', amount: '$1,850', city: 'Austin, TX' },
  { id: 'WO-2417', title: 'Security camera service', client: 'Cedar Ridge Offices', tech: 'Alicia Gomez', date: 'Today · 11:30 AM', status: 'Assigned', amount: '$960', city: 'Round Rock, TX' },
  { id: 'WO-2416', title: 'POS equipment refresh', client: 'Juniper Market', tech: 'David Chen', date: 'Tomorrow · 8:00 AM', status: 'Scheduled', amount: '$2,420', city: 'Austin, TX' },
  { id: 'WO-2415', title: 'Access point troubleshooting', client: 'Stonebridge Dental', tech: 'Unassigned', date: 'Tomorrow · 1:00 PM', status: 'Needs tech', amount: '$675', city: 'Pflugerville, TX' },
  { id: 'WO-2414', title: 'Digital signage closeout', client: 'Westlake Fitness', tech: 'Alicia Gomez', date: 'Oct 7 · 10:00 AM', status: 'Review', amount: '$1,280', city: 'Austin, TX' },
];

const staff = [
  { name: 'Marcus Lee', role: 'Lead technician', jobs: '3 active jobs', status: 'On site', initials: 'ML', color: 'bg-[#e6ede8] text-[#396148]' },
  { name: 'Alicia Gomez', role: 'Field technician', jobs: '2 active jobs', status: 'On site', initials: 'AG', color: 'bg-[#f3e9dd] text-[#93612b]' },
  { name: 'David Chen', role: 'Field technician', jobs: '1 upcoming job', status: 'Available', initials: 'DC', color: 'bg-[#e7ebf3] text-[#435d86]' },
  { name: 'Unassigned', role: 'Coverage needed', jobs: '1 job waiting', status: 'Needs attention', initials: '—', color: 'bg-[#f6e9e5] text-[#a64e37]' },
];

const nav: { label: Area; icon: typeof Activity }[] = [
  { label: 'Overview', icon: Activity }, { label: 'Work orders', icon: BriefcaseBusiness },
  { label: 'Technicians', icon: Users }, { label: 'Financials', icon: CircleDollarSign },
  { label: 'Schedule', icon: CalendarDays }, { label: 'Dispatch', icon: MapPin },
];

function statusStyle(status: string) {
  if (status === 'In progress' || status === 'On site') return 'bg-[#e7f1e9] text-[#376345]';
  if (status === 'Needs tech' || status === 'Needs attention') return 'bg-[#faeee0] text-[#9c5b1c]';
  if (status === 'Review') return 'bg-[#e9edf6] text-[#4c5e82]';
  return 'bg-[#f2efe8] text-[#656258]';
}

function moneyCard(label: string, value: string, detail: string, icon: typeof Activity, positive = false) {
  const Icon = icon;
  return <article className="rounded-2xl border border-[#e9e4d9] bg-[#fff] p-5 shadow-[0_2px_10px_rgba(20,32,48,0.03)]">
    <div className="flex items-start justify-between"><span className="text-sm text-[#79786f]">{label}</span><span className="rounded-xl bg-[#f5f1e8] p-2.5 text-[#96753a]"><Icon size={18} /></span></div>
    <div className="mt-4 font-[family-name:var(--font-sans)] text-2xl font-semibold tracking-tight text-[#1b2430]">{value}</div>
    <div className="mt-2 flex items-center gap-1.5 text-xs text-[#77766f]">{positive ? <ArrowUpRight size={14} className="text-[#4f815d]" /> : <ArrowDownRight size={14} className="text-[#b06b40]" />}{detail}</div>
  </article>;
}

function WorkOrderList({ query = '' }: { query?: string }) {
  const filtered = jobs.filter((job) => `${job.id} ${job.title} ${job.client} ${job.tech} ${job.city}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="overflow-hidden rounded-2xl border border-[#e9e4d9] bg-[#fff]">
    <div className="hidden grid-cols-[1.7fr_1.2fr_1fr_1fr_auto] gap-4 border-b border-[#eeeae2] bg-[#faf9f6] px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#88867e] md:grid"><span>Work order</span><span>Technician</span><span>Schedule</span><span>Status</span><span className="text-right">Value</span></div>
    {filtered.map((job) => <div key={job.id} className="grid gap-3 border-b border-[#f0ede7] px-5 py-4 last:border-0 md:grid-cols-[1.7fr_1.2fr_1fr_1fr_auto] md:items-center md:gap-4">
      <div className="min-w-0"><div className="text-[10px] font-semibold tracking-wide text-[#a2834d]">{job.id} <span className="text-[#c4b99f]">/</span> {job.client}</div><div className="mt-1 truncate text-sm font-semibold text-[#252a30]">{job.title}</div><div className="mt-1 flex items-center gap-1 text-xs text-[#85837a] md:hidden"><MapPin size={12} />{job.city}</div></div>
      <div className="text-sm text-[#4f5355]">{job.tech}</div><div className="text-xs text-[#74736c]">{job.date}</div>
      <div><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle(job.status)}`}>{job.status}</span></div>
      <div className="text-sm font-semibold text-[#27313b] md:text-right">{job.amount}</div>
    </div>)}
    {filtered.length === 0 && <p className="px-5 py-10 text-center text-sm text-[#74736c]">No sample work orders match that search.</p>}
  </div>;
}

export default function DisconnectedPreview() {
  const [area, setArea] = useState<Area>('Overview');
  const [query, setQuery] = useState('');
  const visibleJobs = useMemo(() => jobs.filter((job) => `${job.id} ${job.title} ${job.client} ${job.tech}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const pageTitle = area === 'Overview' ? 'Good morning, Fred' : area;
  const pageSubtitle: Record<Area, string> = {
    Overview: 'Here’s the pulse of your field service business.',
    'Work orders': 'Keep every job, assignment, and closeout moving.',
    Technicians: 'See who’s in the field and what needs coverage.',
    Financials: 'A clear view of job value, payouts, and cash flow.',
    Schedule: 'Plan the work ahead and spot open time slots.',
    Dispatch: 'Coordinate today’s jobs across your service area.',
  };

  return <div className="min-h-screen bg-[#f7f6f2] text-[#252a30]">
    <div className="flex min-h-screen">
      <aside className="hidden w-[248px] shrink-0 flex-col bg-[#101d30] px-4 py-5 text-[#f4f1e9] md:flex">
        <div className="flex items-center gap-3 px-2 pb-8 pt-1"><div className="grid size-10 place-items-center rounded-xl bg-[#d0ad65] text-[#142238]"><Wrench size={20} /></div><div><div className="font-semibold tracking-wide">FAJ Solutions</div><div className="mt-0.5 text-[10px] uppercase tracking-[.2em] text-[#adbac9]">Business Manager</div></div></div>
        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#8290a2]">Workspace</div>
        <nav className="space-y-1" aria-label="Preview sections">{nav.map(({ label, icon: Icon }) => <button key={label} onClick={() => setArea(label)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition hover:bg-[#ffffff12] ${area === label ? 'bg-[#d0ad6524] font-semibold text-[#f2d691]' : 'text-[#d0d6df]'}`}><Icon size={17} strokeWidth={1.8} />{label}{label === 'Work orders' && <span className="ml-auto rounded-full bg-[#d0ad65] px-2 py-0.5 text-[10px] font-bold text-[#142238]">18</span>}</button>)}</nav>
        <div className="mt-auto rounded-2xl border border-[#ffffff18] bg-[#ffffff0b] p-4"><ShieldCheck size={18} className="text-[#d7bc7e]" /><div className="mt-3 text-sm font-semibold">A business, in view.</div><p className="mt-1.5 text-xs leading-5 text-[#b2bdca]">Jobs, field teams, schedule, and money—together in one workspace.</p></div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-[#e9e5dc] bg-[#fff] px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-3 md:hidden"><div className="grid size-9 place-items-center rounded-lg bg-[#101d30] text-[#d5b66d]"><Wrench size={18} /></div><span className="text-sm font-semibold">FAJ Solutions</span></div>
          <div className="hidden text-xs text-[#85837a] md:block">Workspace <span className="mx-2 text-[#c9c3b5]">/</span> <span className="font-medium text-[#3c4146]">{area}</span></div>
          <div className="ml-auto flex items-center gap-3"><span className="inline-flex items-center gap-2 rounded-full border border-[#e9e0c9] bg-[#fbf7eb] px-3 py-1.5 text-[11px] font-semibold text-[#8a713c]"><span className="size-1.5 rounded-full bg-[#ba9a52]" />Preview mode</span><div className="grid size-9 place-items-center rounded-full bg-[#e9edf1] text-xs font-bold text-[#354960]">FJ</div></div>
        </header>

        <div className="mx-auto max-w-[1380px] px-5 pb-10 pt-7 sm:px-8 sm:pt-9">
          <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#9a7e43]"><span>FAJ Solutions</span><span className="text-[#c8b992]">/</span><span>Operations</span></div><h1 className="font-serif text-3xl font-semibold tracking-tight text-[#202a35] sm:text-[38px]">{pageTitle}</h1><p className="mt-2 text-sm text-[#77766f]">{pageSubtitle[area]}</p></div>
            <div className="flex items-center gap-2 rounded-xl border border-[#e8e4db] bg-[#fff] px-3 py-2.5 text-xs text-[#73736e]"><CalendarDays size={15} className="text-[#a1834d]" /> Monday, October 5 <ChevronDown size={14} /></div></div>

          <div className="mb-7 flex items-start gap-3 rounded-xl border border-[#e9dfc8] bg-[#fbf7ed] px-4 py-3.5 text-xs leading-5 text-[#746344]"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#987b42]" /><p><strong className="font-semibold">Read-only preview.</strong> This screen uses sample work orders and technician details so you can explore the app before connecting your business data. Nothing here will be saved.</p></div>

          {area === 'Overview' && <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Business summary">
              {moneyCard('Open work orders', '18', '4 need a technician', BriefcaseBusiness)}{moneyCard('Scheduled this week', '26', 'Across 7 field technicians', CalendarDays, true)}{moneyCard('Work completed', '$32,480', 'This month · 12% vs last month', CircleDollarSign, true)}{moneyCard('Tech payouts due', '$6,240', 'Across 8 completed jobs', Clock3)}
            </section>
            <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.85fr)]">
              <div><div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-semibold text-[#29323b]">Work in motion</h2><p className="mt-1 text-xs text-[#85837a]">The jobs that need your attention today</p></div><button onClick={() => setArea('Work orders')} className="rounded-lg px-3 py-2 text-xs font-semibold text-[#776239] transition hover:bg-[#eee8db]">All work orders <span aria-hidden="true">→</span></button></div><WorkOrderList /></div>
              <div className="space-y-5">
                <article className="rounded-2xl bg-[#14243a] p-5 text-[#f3f0e8] shadow-[0_8px_26px_rgba(17,32,52,0.12)]"><div className="flex items-center justify-between"><div className="text-sm font-semibold">This week at a glance</div><Activity size={17} className="text-[#d4b76d]" /></div><div className="mt-6 flex items-end justify-between"><div><div className="text-3xl font-semibold tracking-tight">$18,640</div><div className="mt-1 text-xs text-[#b7c0ca]">Expected job revenue</div></div><span className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#ffffff12] px-2 py-1 text-[10px] text-[#e3d4ac]"><ArrowUpRight size={12} /> 8.4%</span></div><div className="mt-5 flex h-20 items-end gap-2">{['h-8','h-12','h-9','h-14','h-11','h-16','h-20'].map((height, i) => <div key={i} className={`flex-1 rounded-t-md ${i === 6 ? 'bg-[#d1ad64]' : 'bg-[#8090a3]/50'} ${height}`} />)}</div><div className="mt-2 flex justify-between text-[9px] text-[#aab4c1]"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></article>
                <article className="rounded-2xl border border-[#e9e4d9] bg-[#fff] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Your field team</h2><p className="mt-1 text-xs text-[#85837a]">Today’s availability</p></div><button onClick={() => setArea('Technicians')} className="text-xs font-semibold text-[#8a713c]">View team</button></div><div className="space-y-3">{staff.slice(0, 3).map((person) => <div key={person.name} className="flex items-center gap-3"><span className={`grid size-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${person.color}`}>{person.initials}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{person.name}</div><div className="mt-0.5 text-[10px] text-[#85837a]">{person.jobs}</div></div><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${statusStyle(person.status)}`}>{person.status}</span></div>)}</div></article>
              </div>
            </section>
          </>}

          {area === 'Work orders' && <section><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-semibold">Active work orders</h2><p className="mt-1 text-xs text-[#85837a]">Showing a handful of illustrative jobs</p></div><label className="flex items-center gap-2 rounded-xl border border-[#e9e4d9] bg-[#fff] px-3 py-2.5 sm:w-72"><Search size={15} className="text-[#918d82]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs or clients" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[#aaa69a]" aria-label="Search sample work orders" /></label></div><WorkOrderList query={query} /></section>}

          {area === 'Technicians' && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{staff.map((person) => <article key={person.name} className="rounded-2xl border border-[#e9e4d9] bg-[#fff] p-5"><div className="flex items-center gap-3"><span className={`grid size-11 place-items-center rounded-full text-xs font-bold ${person.color}`}>{person.initials}</span><div><h2 className="text-sm font-semibold">{person.name}</h2><p className="mt-1 text-xs text-[#85837a]">{person.role}</p></div></div><div className="mt-5 flex items-center justify-between border-t border-[#f0ede7] pt-4"><span className="text-xs text-[#73736e]">{person.jobs}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle(person.status)}`}>{person.status}</span></div></article>)}</section>}

          {area === 'Financials' && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{moneyCard('Job revenue', '$32,480', 'Month to date', CircleDollarSign, true)}{moneyCard('Collected', '$24,960', '77% of billed work', CheckCircle2, true)}{moneyCard('Tech payouts', '$6,240', '8 jobs awaiting payment', HardHat)}{moneyCard('Average job', '$1,352', 'Across 24 completed jobs', BriefcaseBusiness, true)}<div className="rounded-2xl border border-[#e9e4d9] bg-[#fff] p-5 sm:col-span-2 xl:col-span-4"><h2 className="text-sm font-semibold">Financial snapshot</h2><p className="mt-1 text-xs text-[#85837a]">Revenue and technician payouts are grouped with the work that created them.</p><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[#f7f6f2] p-4"><div className="text-xs text-[#85837a]">Awaiting client payment</div><div className="mt-2 text-xl font-semibold">$7,520</div></div><div className="rounded-xl bg-[#f7f6f2] p-4"><div className="text-xs text-[#85837a]">Ready to pay technicians</div><div className="mt-2 text-xl font-semibold">$6,240</div></div><div className="rounded-xl bg-[#f7f6f2] p-4"><div className="text-xs text-[#85837a]">Completed this month</div><div className="mt-2 text-xl font-semibold">24 jobs</div></div></div></div></section>}

          {area === 'Schedule' && <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{jobs.map((job) => <article key={job.id} className="rounded-2xl border border-[#e9e4d9] bg-[#fff] p-5"><div className="flex items-start justify-between gap-3"><span className="text-[10px] font-semibold tracking-wide text-[#a2834d]">{job.id}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle(job.status)}`}>{job.status}</span></div><h2 className="mt-3 text-sm font-semibold">{job.title}</h2><p className="mt-1 text-xs text-[#77766f]">{job.client}</p><div className="mt-4 space-y-2 border-t border-[#f0ede7] pt-3 text-xs text-[#73736e]"><div className="flex items-center gap-2"><CalendarDays size={13} />{job.date}</div><div className="flex items-center gap-2"><MapPin size={13} />{job.city}</div></div></article>)}</section>}

          {area === 'Dispatch' && <section className="rounded-2xl border border-[#e9e4d9] bg-[#fff] p-6 sm:p-8"><div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-[#d9d1bf] bg-[#f8f6f0] px-5 text-center"><div className="max-w-md"><MapPin size={26} className="mx-auto text-[#9a7e43]" /><h2 className="mt-3 text-lg font-semibold">Dispatch overview</h2><p className="mt-2 text-sm leading-6 text-[#77766f]">The live dispatch map and job locations appear here when your business data is connected. This preview shows the shape of the dispatch workspace without inventing a map.</p><button onClick={() => setArea('Work orders')} className="mt-4 rounded-lg bg-[#14243a] px-4 py-2.5 text-xs font-semibold text-[#f5f1e7] transition hover:bg-[#263c59]">Review sample work orders</button></div></div></section>}

          <footer className="mt-8 flex flex-col gap-2 border-t border-[#e9e5dc] pt-4 text-[10px] text-[#8a887f] sm:flex-row sm:items-center sm:justify-between"><span>FAJ Solutions · Field operations preview</span><span>Sample information only · No business data is connected</span></footer>
        </div>
      </main>
    </div>
  </div>;
}
