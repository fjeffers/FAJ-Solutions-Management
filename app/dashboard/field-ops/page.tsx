'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SiteVisit, Contractor } from '@/lib/types';
import Button from '@/components/ui/Button';
import { useRouter } from 'next/navigation';

export default function FieldOpsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [formData, setFormData] = useState({
    site_name: '',
    site_code: '',
    address: '',
    visit_date: new Date().toISOString().split('T')[0],
    hours: '',
    rate: '',
    total_project_price: '',
    visit_type: 'T&M' as const,
    miles: '',
    travel_charge: '',
    notes: '',
    contractor_id: '',
    invoice_status: 'not_invoiced' as const,
    payment_status: 'unpaid' as const,
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Load site visits
      const { data: visitsData } = await supabase
        .from('site_visits')
        .select('*')
        .eq('user_id', user.id)
        .order('visit_date', { ascending: false });

      setVisits(visitsData || []);

      // Load contractors
      const { data: contractorsData } = await supabase
        .from('contractors')
        .select('*')
        .eq('user_id', user.id)
        .order('name');

      setContractors(contractorsData || []);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        user_id: user.id,
        site_name: formData.site_name || null,
        site_code: formData.site_code || null,
        address: formData.address || null,
        visit_date: formData.visit_date || null,
        hours: formData.hours ? parseFloat(formData.hours) : null,
        rate: formData.rate || null,
        total_project_price: formData.total_project_price ? parseFloat(formData.total_project_price) : null,
        visit_type: formData.visit_type,
        miles: formData.miles ? parseFloat(formData.miles) : null,
        travel_charge: formData.travel_charge ? parseFloat(formData.travel_charge) : null,
        notes: formData.notes || null,
        contractor_id: formData.contractor_id || null,
        invoice_status: formData.invoice_status,
        payment_status: formData.payment_status,
      };

      const { error } = await supabase
        .from('site_visits')
        .insert([payload]);

      if (error) throw error;

      // Reset form
      setFormData({
        site_name: '',
        site_code: '',
        address: '',
        visit_date: new Date().toISOString().split('T')[0],
        hours: '',
        rate: '',
        total_project_price: '',
        visit_type: 'T&M',
        miles: '',
        travel_charge: '',
        notes: '',
        contractor_id: '',
        invoice_status: 'not_invoiced',
        payment_status: 'unpaid',
      });

      setShowForm(false);
      await loadData();
    } catch (err) {
      console.error('Submit error:', err);
      alert('Error saving site visit');
    }
  }

  async function exportToExcel() {
    setExporting(true);
    try {
      const res = await fetch('/api/exports/site-visits?format=excel');
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `site-visits-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export to Excel');
    } finally {
      setExporting(false);
    }
  }

  async function exportToSheets() {
    setExporting(true);
    try {
      const res = await fetch('/api/exports/site-visits?format=sheets');
      if (!res.ok) throw new Error('Export failed');

      const data = await res.json();

      // Create Google Sheets import URL
      const sheetsUrl = new URL('https://docs.google.com/spreadsheets/create');
      const csv = [
        Object.keys(data.data[0]).join(','),
        ...data.data.map((row: Record<string, any>) =>
          Object.values(row).map(v => `"${v}"`).join(',')
        ),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `site-visits-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert('CSV exported. You can now import into Google Sheets: File > Import > Upload > Select file');
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export to Google Sheets');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Field Operations</h1>
        <div className="flex gap-3">
          <Button onClick={exportToExcel} disabled={exporting} variant="secondary">
            {exporting ? 'Exporting...' : 'Export to Excel'}
          </Button>
          <Button onClick={exportToSheets} disabled={exporting} variant="secondary">
            {exporting ? 'Exporting...' : 'Export to Sheets'}
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Add Site Visit'}
          </Button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Site Name</label>
              <input
                type="text"
                value={formData.site_name}
                onChange={(e) => setFormData({ ...formData, site_name: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Site Code</label>
              <input
                type="text"
                value={formData.site_code}
                onChange={(e) => setFormData({ ...formData, site_code: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Address</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Visit Date</label>
              <input
                type="date"
                value={formData.visit_date}
                onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Contractor</label>
              <select
                value={formData.contractor_id}
                onChange={(e) => setFormData({ ...formData, contractor_id: e.target.value })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="">Select Contractor</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Total Hours</label>
              <input
                type="number"
                step="0.5"
                value={formData.hours}
                onChange={(e) => setFormData({ ...formData, hours: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Hourly Rate</label>
              <input
                type="text"
                placeholder="e.g., $55/hr or 2600"
                value={formData.rate}
                onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Total Project Price</label>
              <input
                type="number"
                step="0.01"
                value={formData.total_project_price}
                onChange={(e) => setFormData({ ...formData, total_project_price: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Visit Type</label>
              <select
                value={formData.visit_type}
                onChange={(e) => setFormData({ ...formData, visit_type: e.target.value as any })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="Project">Project</option>
                <option value="T&M">T&M</option>
                <option value="Revisit">Revisit</option>
                <option value="Survey">Survey</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Miles</label>
              <input
                type="number"
                step="0.1"
                value={formData.miles}
                onChange={(e) => setFormData({ ...formData, miles: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Travel Charge</label>
              <input
                type="number"
                step="0.01"
                value={formData.travel_charge}
                onChange={(e) => setFormData({ ...formData, travel_charge: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Invoice Status</label>
              <select
                value={formData.invoice_status}
                onChange={(e) => setFormData({ ...formData, invoice_status: e.target.value as any })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="not_invoiced">Not Invoiced</option>
                <option value="invoiced">Invoiced</option>
                <option value="na">N/A</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Payment Status</label>
              <select
                value={formData.payment_status}
                onChange={(e) => setFormData({ ...formData, payment_status: e.target.value as any })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="na">N/A</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button type="submit">Save Site Visit</Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold">Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Site</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Address</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Contractor</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Hours</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Rate</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Project Price</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Type</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Invoice</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Payment</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => (
              <tr key={visit.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-3 text-sm">{visit.visit_date}</td>
                <td className="px-6 py-3 text-sm">{visit.site_name}</td>
                <td className="px-6 py-3 text-sm">{visit.address}</td>
                <td className="px-6 py-3 text-sm">{visit.contractor_id ? contractors.find(c => c.id === visit.contractor_id)?.name : '-'}</td>
                <td className="px-6 py-3 text-sm">{visit.hours}</td>
                <td className="px-6 py-3 text-sm">{visit.rate}</td>
                <td className="px-6 py-3 text-sm">{visit.total_project_price ? `$${visit.total_project_price}` : '-'}</td>
                <td className="px-6 py-3 text-sm">{visit.visit_type}</td>
                <td className="px-6 py-3 text-sm">{visit.invoice_status}</td>
                <td className="px-6 py-3 text-sm">{visit.payment_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
