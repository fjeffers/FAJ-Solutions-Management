'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';

function W9FormContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [contractor, setContractor] = useState<any>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    business_name: '',
    entity_type: 'Individual/Sole Proprietor' as any,
    tax_id: '',
    tax_id_type: 'SSN' as any,
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    email: '',
  });

  useEffect(() => {
    loadContractor();
  }, []);

  async function loadContractor() {
    if (!token) {
      setError('Invalid or missing token');
      setLoading(false);
      return;
    }

    try {
      const { data: contractors, error: err } = await supabase
        .from('contractors')
        .select('*')
        .eq('w9_invite_token', token)
        .single();

      if (err || !contractors) {
        setError('Invalid token or contractor not found');
        setLoading(false);
        return;
      }

      setContractor(contractors);
      setFormData({
        name: contractors.name || '',
        business_name: contractors.business_name || '',
        entity_type: contractors.entity_type || 'Individual/Sole Proprietor',
        tax_id: contractors.tax_id || '',
        tax_id_type: contractors.tax_id_type || 'SSN',
        address: contractors.address || '',
        city: contractors.city || '',
        state: contractors.state || '',
        zip: contractors.zip || '',
        phone: contractors.phone || '',
        email: contractors.email || '',
      });

      setLoading(false);
    } catch (err) {
      console.error('Load error:', err);
      setError('Failed to load form');
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!contractor) {
      setError('Contractor information missing');
      return;
    }

    try {
      // Update contractor with W9 data
      const { error: updateErr } = await supabase
        .from('contractors')
        .update({
          ...formData,
          w9_received: true,
          w9_submitted_at: new Date().toISOString(),
          w9_uploaded_by: 'contractor',
          w9_uploaded_at: new Date().toISOString(),
        })
        .eq('id', contractor.id);

      if (updateErr) throw updateErr;

      setSubmitted(true);
    } catch (err) {
      console.error('Submit error:', err);
      setError('Failed to submit W-9 form');
    }
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-lg shadow p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4">Thank You!</h1>
          <p className="text-gray-600 mb-6">
            Your W-9 form has been submitted successfully. We'll upload it to QuickBooks and send you a confirmation.
          </p>
          <a href="/" className="text-blue-600 hover:text-blue-700">Return Home</a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-lg shadow p-8 max-w-md">
          <h1 className="text-xl font-bold mb-4 text-red-600">Error</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <a href="/" className="text-blue-600 hover:text-blue-700">Return Home</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow p-8">
        <h1 className="text-3xl font-bold mb-2">W-9 Tax Form</h1>
        <p className="text-gray-600 mb-6">Please provide your tax information below. This will be securely uploaded to QuickBooks.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Business Name (if applicable)</label>
              <input
                type="text"
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Entity Type</label>
              <select
                value={formData.entity_type}
                onChange={(e) => setFormData({ ...formData, entity_type: e.target.value })}
                className="w-full border rounded px-3 py-2"
              >
                <option>Individual/Sole Proprietor</option>
                <option>C Corporation</option>
                <option>S Corporation</option>
                <option>Partnership</option>
                <option>Trust/Estate</option>
                <option>LLC</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Tax ID Type</label>
              <select
                value={formData.tax_id_type}
                onChange={(e) => setFormData({ ...formData, tax_id_type: e.target.value })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="SSN">Social Security Number (SSN)</option>
                <option value="EIN">Employer Identification Number (EIN)</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">
                {formData.tax_id_type === 'SSN' ? 'Social Security Number' : 'Employer ID Number'}
              </label>
              <input
                type="text"
                required
                placeholder={formData.tax_id_type === 'SSN' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}
                value={formData.tax_id}
                onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Address</label>
              <input
                type="text"
                required
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input
                type="text"
                required
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <input
                type="text"
                required
                maxLength={2}
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">ZIP Code</label>
              <input
                type="text"
                required
                value={formData.zip}
                onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Your information will be securely transmitted and uploaded to QuickBooks. Please ensure all information is accurate.
            </p>
          </div>

          <div className="flex gap-3">
            <Button type="submit" className="flex-1">Submit W-9 Form</Button>
            <Button type="reset" variant="secondary" className="flex-1">Clear Form</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function W9FormPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <W9FormContent />
    </Suspense>
  );
}
