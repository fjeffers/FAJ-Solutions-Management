'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contractor } from '@/lib/types';
import Button from '@/components/ui/Button';

export default function ContractorsPage() {
  const supabase = createClient();
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadContractors();
  }, []);

  async function loadContractors() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .eq('user_id', user.id)
        .order('name');

      if (error) throw error;
      setContractors(data || []);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function sendW9Invite(contractorId: string) {
    setSending(contractorId);
    setMessage('');

    try {
      const res = await fetch('/api/contractors/send-w9-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractorId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || 'Failed to send invite');
      } else {
        setMessage(`✓ ${data.message}`);
        setTimeout(() => setMessage(''), 5000);
        await loadContractors();
      }
    } catch (err) {
      console.error('Send error:', err);
      setMessage('Failed to send invite');
    } finally {
      setSending(null);
    }
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Contractors</h1>
        <p className="text-gray-600">Manage contractors and send W-9 tax forms</p>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded ${message.startsWith('✓') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold">Name</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Email</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Phone</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Entity Type</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Tax ID</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">W-9 Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {contractors.map((c) => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-3 text-sm font-medium">{c.name}</td>
                <td className="px-6 py-3 text-sm">{c.email || '-'}</td>
                <td className="px-6 py-3 text-sm">{c.phone || '-'}</td>
                <td className="px-6 py-3 text-sm">{c.entity_type || '-'}</td>
                <td className="px-6 py-3 text-sm">
                  {c.tax_id_type && c.tax_id
                    ? `${c.tax_id_type}: ${c.tax_id}`
                    : '-'}
                </td>
                <td className="px-6 py-3 text-sm">
                  {c.w9_received ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                      ✓ Received
                    </span>
                  ) : c.w9_invite_sent_at ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                      Pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                      Not Sent
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-sm">
                  {!c.w9_received && (
                    <Button
                      onClick={() => sendW9Invite(c.id)}
                      disabled={sending === c.id}
                      variant="secondary"
                      size="sm"
                    >
                      {sending === c.id ? 'Sending...' : 'Send W-9'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contractors.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600">No contractors yet. Add one from the dashboard.</p>
        </div>
      )}
    </div>
  );
}
