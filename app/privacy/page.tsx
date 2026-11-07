import type { Metadata } from 'next';
import { LegalPage } from '@/app/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy | FAJ Solutions',
  description: 'How the FAJ Solutions business management application handles personal and business information.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>This policy explains how FAJ Solutions collects, uses, and protects information in its business management application (the “Service”).</p>

      <h2>Information we collect</h2>
      <ul>
        <li>Account information, including names, email addresses, phone numbers, roles, and sign-in identifiers.</li>
        <li>Business records, including work orders, customer and site details, time, mileage, expenses, invoices, payments, tax-document status, messages, photos, documents, and signatures.</li>
        <li>Operational information, including device and browser details, login activity, timestamps, and location data when a job workflow requires it and the user permits it.</li>
        <li>QuickBooks information authorized through Intuit, including company, customer, vendor, account, invoice, and payment identifiers needed for requested synchronization.</li>
      </ul>

      <h2>How we use information</h2>
      <p>We use information to operate the Service, assign and document work, communicate with authorized users, prepare invoices and payments, synchronize requested records with QuickBooks, maintain security, troubleshoot problems, and meet accounting, tax, legal, and contractual obligations.</p>

      <h2>QuickBooks connection</h2>
      <p>The Service accesses QuickBooks only after an authorized FAJ Solutions administrator approves the connection. QuickBooks data is used to perform requested accounting synchronization and is not sold. Access can be revoked from QuickBooks or the Service, and disconnecting stops future synchronization without deleting records already created in QuickBooks.</p>

      <h2>Sharing</h2>
      <p>Information is shared only with authorized FAJ Solutions personnel, assigned contractors, customers where a customer-facing record is intended, service providers needed to operate the Service, and government or legal authorities when required. FAJ Solutions does not sell personal information.</p>

      <h2>Retention and security</h2>
      <p>Records are retained for as long as reasonably needed for operations, accounting, tax, legal, security, and dispute-resolution purposes. FAJ Solutions uses access controls, encrypted connections, and restricted credentials, but no system can guarantee absolute security.</p>

      <h2>Your choices</h2>
      <p>Authorized users may ask to review or correct their account information. Administrators can disable access. Location, camera, and notification permissions can be controlled through the user’s device, although some job features may then be unavailable.</p>

      <h2>Children</h2>
      <p>The Service is for business use and is not directed to children under 13.</p>

      <h2>Changes and contact</h2>
      <p>We may update this policy as the Service changes. Questions or privacy requests may be sent to <a href="mailto:fajsolutions@gmail.com">fajsolutions@gmail.com</a>.</p>
    </LegalPage>
  );
}
