'use client';
import { useMemo, useState } from 'react';
import { MessageSquare, RotateCcw } from 'lucide-react';
import TeamMessenger from '@/components/TeamMessenger';
import { createDemoAdapter, DEMO_PEOPLE, DEMO_STORAGE_KEY } from '@/lib/team-messaging-demo';
import { roleLabel } from '@/lib/team-messaging';
import './preview.css';

export default function MessagingDemoPage() {
  const [person, setPerson] = useState('office-pm');
  const [version, setVersion] = useState(0);
  const adapter = useMemo(() => createDemoAdapter(person, {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  }), [person, version]); // eslint-disable-line react-hooks/exhaustive-deps -- reset demo state
  return <div className="tm-demo">
    <header className="tm-demo-nav"><a href="/messaging-demo" aria-label="FAJ Solutions messaging demo"><span><MessageSquare size={20} /></span><b>FAJ<span>SOLUTIONS</span></b></a><div>OPERATIONS WORKSPACE <span>/</span> TEAM MESSENGER</div><span className="tm-demo-preview">INTERACTIVE PREVIEW</span></header>
    <main className="tm-demo-main"><div className="tm-demo-toolbar"><div><span className="tm-demo-dot" /><b>Try both sides of the conversation</b><p>Fictional people and work orders. Changes stay in this browser, not your live app.</p></div><div className="tm-demo-controls"><label htmlFor="demo-role">Viewing as<select id="demo-role" value={person} onChange={(e) => setPerson(e.target.value)}>{DEMO_PEOPLE.map((p) => <option key={p.id} value={p.id}>{p.name} · {roleLabel(p.role)}</option>)}</select></label><button onClick={() => { localStorage.removeItem(DEMO_STORAGE_KEY); setVersion((v) => v + 1); }} title="Reset fictional messages" aria-label="Reset demo"><RotateCcw size={16} /></button></div></div>
      <TeamMessenger key={`${person}-${version}`} adapter={adapter} />
      <div className="tm-demo-tip"><b>A quick way to try it</b><span>Open Alex Carter → send a message or availability request → switch to Alex Carter to reply → switch back to see the response.</span></div>
    </main>
  </div>;
}
