'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { W9_FORM_HTML, CONTRACTOR_AGREEMENT_HTML } from '@/lib/document-templates';
import Button from '@/components/ui/Button';

function ContractorDocumentsContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const docType = searchParams.get('doc') || 'w9';
  const format = searchParams.get('format');
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [contractor, setContractor] = useState<any>(null);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

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
      setLoading(false);
    } catch (err) {
      console.error('Load error:', err);
      setError('Failed to load documents');
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
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

  // Handle PDF download
  if (format === 'pdf') {
    const html = docType === 'agreement' ? CONTRACTOR_AGREEMENT_HTML : W9_FORM_HTML;
    const fileName = docType === 'agreement' ? 'contractor-agreement.html' : 'w9-form.html';

    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <Button
              onClick={() => {
                const element = document.createElement('a');
                element.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
                element.download = fileName;
                document.body.appendChild(element);
                element.click();
                document.body.removeChild(element);
              }}
              variant="primary"
            >
              Download {docType === 'agreement' ? 'Agreement' : 'W-9'} as PDF
            </Button>
          </div>
          <div
            className="bg-white rounded-lg shadow p-8"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow p-8 mb-8">
          <h1 className="text-3xl font-bold mb-2">Contractor Documents</h1>
          <p className="text-gray-600 mb-6">Hi {contractor?.name}, please complete these two documents to get started with FAJ Solutions.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* W-9 Form Card */}
            <div className={`border-2 rounded-lg p-6 cursor-pointer transition ${docType === 'w9' ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <h2 className="text-xl font-bold mb-2">📋 IRS Form W-9</h2>
              <p className="text-gray-600 mb-4">Tax identification form for 1099 reporting</p>
              <div className="space-y-2">
                <a href="?token={token}&doc=w9" className="block">
                  <Button variant={docType === 'w9' ? 'primary' : 'secondary'} className="w-full">
                    View W-9 Form
                  </Button>
                </a>
                <a href={`?token=${token}&doc=w9&format=pdf`} className="block">
                  <Button variant="secondary" className="w-full">
                    Download PDF
                  </Button>
                </a>
              </div>
              {contractor?.w9_received && (
                <div className="mt-4 p-3 bg-green-100 text-green-800 rounded text-sm">
                  ✓ Received on {new Date(contractor.w9_submitted_at).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* Contractor Agreement Card */}
            <div className={`border-2 rounded-lg p-6 cursor-pointer transition ${docType === 'agreement' ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <h2 className="text-xl font-bold mb-2">📝 Contractor Agreement</h2>
              <p className="text-gray-600 mb-4">Working relationship and payment terms</p>
              <div className="space-y-2">
                <a href="?token={token}&doc=agreement" className="block">
                  <Button variant={docType === 'agreement' ? 'primary' : 'secondary'} className="w-full">
                    View Agreement
                  </Button>
                </a>
                <a href={`?token=${token}&doc=agreement&format=pdf`} className="block">
                  <Button variant="secondary" className="w-full">
                    Download PDF
                  </Button>
                </a>
              </div>
              {contractor?.contract_signed_at && (
                <div className="mt-4 p-3 bg-green-100 text-green-800 rounded text-sm">
                  ✓ Signed on {new Date(contractor.contract_signed_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Document Viewer */}
        <div className="bg-white rounded-lg shadow p-8">
          {docType === 'w9' ? (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">IRS Form W-9</h2>
                <a href={`?token=${token}&doc=w9&format=pdf`}>
                  <Button variant="secondary">Download PDF</Button>
                </a>
              </div>
              <div
                className="prose max-w-none"
                dangerouslySetInnerHTML={{ __html: W9_FORM_HTML }}
              />
              <div className="mt-8 p-4 bg-blue-50 rounded border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>How to submit:</strong> Fill out this form and either email it to <strong>fajsolutions@gmail.com</strong> or mail the signed original to FAJ Solutions, Easton, PA.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Contractor Agreement</h2>
                <a href={`?token=${token}&doc=agreement&format=pdf`}>
                  <Button variant="secondary">Download PDF</Button>
                </a>
              </div>
              <div
                className="prose max-w-none"
                dangerouslySetInnerHTML={{ __html: CONTRACTOR_AGREEMENT_HTML }}
              />
              <div className="mt-8 p-4 bg-blue-50 rounded border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>How to submit:</strong> Print this agreement, sign it, and either email a scanned copy to <strong>fajsolutions@gmail.com</strong> or mail the signed original to FAJ Solutions, Easton, PA.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h3 className="font-bold text-yellow-900 mb-2">📧 Email Documents</h3>
          <p className="text-yellow-800 text-sm mb-3">
            You can print these forms, complete them, and email them back to <strong>fajsolutions@gmail.com</strong>
          </p>
          <p className="text-yellow-800 text-sm">
            Once both documents are received and approved, you'll be ready to start accepting work assignments!
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ContractorDocumentsPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <ContractorDocumentsContent />
    </Suspense>
  );
}
