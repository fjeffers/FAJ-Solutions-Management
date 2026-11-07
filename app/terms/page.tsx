import type { Metadata } from 'next';
import { LegalPage } from '@/app/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Use | FAJ Solutions',
  description: 'Terms governing authorized use of the FAJ Solutions business management application.',
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>These Terms govern access to the FAJ Solutions business management application (the “Service”). The Service is operated by FAJ Solutions and is intended for FAJ Solutions and people it authorizes.</p>

      <h2>Authorized use</h2>
      <p>You may use the Service only for legitimate FAJ Solutions business, with an account or link issued to you. Keep your sign-in information private and promptly report suspected unauthorized access.</p>

      <h2>Business records and QuickBooks</h2>
      <p>The Service helps prepare and transfer work orders, invoices, contractor records, payments, and related information. You are responsible for reviewing records before sending them to QuickBooks or another third party. QuickBooks remains the accounting system of record for information accepted there.</p>

      <h2>Acceptable use</h2>
      <p>You may not misuse the Service, attempt to access another person’s data, disrupt its operation, upload unlawful material, or use it in violation of applicable law or a customer agreement.</p>

      <h2>Availability and changes</h2>
      <p>FAJ Solutions may maintain, update, suspend, or discontinue features. The Service may occasionally be unavailable because of maintenance, internet outages, or third-party services.</p>

      <h2>Access and termination</h2>
      <p>FAJ Solutions may turn off a user’s access when it is no longer needed or when these Terms are violated. Business records may be retained as required for operations, accounting, tax, legal, or security purposes.</p>

      <h2>Disclaimer and liability</h2>
      <p>The Service is provided on an “as available” basis. To the extent permitted by law, FAJ Solutions disclaims implied warranties and is not liable for indirect, incidental, special, or consequential losses arising from use of the Service.</p>

      <h2>Contact</h2>
      <p>Questions about these Terms may be sent to <a href="mailto:fajsolutions@gmail.com">fajsolutions@gmail.com</a>.</p>
    </LegalPage>
  );
}
