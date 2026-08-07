export const W9_FORM_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.5; max-width: 8.5in; margin: 0 auto; padding: 0.5in; }
    .header { text-align: center; font-weight: bold; margin-bottom: 1in; }
    .form-title { font-size: 18px; font-weight: bold; }
    .form-section { margin: 0.5in 0; border-top: 1px solid #999; padding-top: 0.3in; }
    .form-section-title { font-weight: bold; margin-bottom: 0.2in; }
    .form-row { margin: 0.2in 0; display: flex; gap: 1in; }
    .form-field { flex: 1; }
    .form-label { font-weight: bold; font-size: 0.9em; margin-bottom: 0.1in; }
    .form-input { border-bottom: 1px solid #000; min-height: 0.3in; padding: 0.05in; width: 100%; box-sizing: border-box; }
    .checkbox { display: inline-block; border: 1px solid #000; width: 0.2in; height: 0.2in; margin-right: 0.1in; }
    .instructions { background: #f0f0f0; padding: 0.2in; margin: 0.2in 0; font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="header">
    <div class="form-title">Form W-9</div>
    <div>Request for Taxpayer Identification Number and Certification</div>
  </div>

  <div class="instructions">
    <strong>Instructions:</strong> Fill out all fields below. For sole proprietors, enter your Social Security Number (SSN). For businesses, enter your Employer Identification Number (EIN).
  </div>

  <div class="form-section">
    <div class="form-section-title">1. Name</div>
    <div class="form-field">
      <div class="form-label">Full Legal Name</div>
      <div class="form-input"></div>
    </div>
  </div>

  <div class="form-section">
    <div class="form-section-title">2. Business Name (if different from above)</div>
    <div class="form-field">
      <div class="form-label">Business Name</div>
      <div class="form-input"></div>
    </div>
  </div>

  <div class="form-section">
    <div class="form-section-title">3. Federal Tax Classification</div>
    <div style="margin: 0.1in 0;">
      <div style="margin: 0.1in 0;">
        <span class="checkbox"></span> Individual / Sole Proprietor
      </div>
      <div style="margin: 0.1in 0;">
        <span class="checkbox"></span> C Corporation
      </div>
      <div style="margin: 0.1in 0;">
        <span class="checkbox"></span> S Corporation
      </div>
      <div style="margin: 0.1in 0;">
        <span class="checkbox"></span> Partnership
      </div>
      <div style="margin: 0.1in 0;">
        <span class="checkbox"></span> LLC
      </div>
      <div style="margin: 0.1in 0;">
        <span class="checkbox"></span> Other: <span style="border-bottom: 1px solid #000; width: 2in; display: inline-block;"></span>
      </div>
    </div>
  </div>

  <div class="form-section">
    <div class="form-section-title">4. Taxpayer Identification Number (TIN)</div>
    <div class="form-row">
      <div class="form-field">
        <div class="form-label">Social Security Number (SSN) OR</div>
        <div class="form-input"></div>
      </div>
      <div class="form-field">
        <div class="form-label">Employer Identification Number (EIN)</div>
        <div class="form-input"></div>
      </div>
    </div>
  </div>

  <div class="form-section">
    <div class="form-section-title">5. Address</div>
    <div class="form-field">
      <div class="form-label">Street Address</div>
      <div class="form-input"></div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <div class="form-label">City</div>
        <div class="form-input"></div>
      </div>
      <div class="form-field">
        <div class="form-label">State</div>
        <div class="form-input"></div>
      </div>
      <div class="form-field">
        <div class="form-label">ZIP Code</div>
        <div class="form-input"></div>
      </div>
    </div>
  </div>

  <div class="form-section">
    <div class="form-section-title">6. Contact Information</div>
    <div class="form-row">
      <div class="form-field">
        <div class="form-label">Email</div>
        <div class="form-input"></div>
      </div>
      <div class="form-field">
        <div class="form-label">Phone</div>
        <div class="form-input"></div>
      </div>
    </div>
  </div>

  <div class="form-section">
    <div class="form-section-title">7. Certification</div>
    <div style="margin: 0.2in 0;">
      I certify that the number shown on this form is my correct taxpayer identification number and that I am not subject to backup withholding because: (a) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding, or (b) the IRS has notified me that I am no longer subject to backup withholding.
    </div>
    <div style="margin-top: 0.3in;">
      <div style="border-bottom: 1px solid #000; min-height: 0.4in; margin-bottom: 0.1in;"></div>
      <div style="font-size: 0.85em;">Signature</div>
    </div>
    <div style="margin-top: 0.3in;">
      <div style="border-bottom: 1px solid #000; min-height: 0.2in; margin-bottom: 0.1in;"></div>
      <div style="font-size: 0.85em;">Date</div>
    </div>
  </div>

  <div style="margin-top: 0.5in; padding-top: 0.3in; border-top: 1px solid #999; font-size: 0.8em; color: #666;">
    <strong>INSTRUCTIONS FOR COMPLETING FORM W-9:</strong><br>
    Mail completed form to: FAJ Solutions, Easton, PA<br>
    Or email a scanned copy to: fajsolutions@gmail.com<br>
    Do NOT send original to the IRS. This form is for FAJ Solutions' records only.
  </div>
</body>
</html>
`;

export const CONTRACTOR_AGREEMENT_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 8.5in; margin: 0 auto; padding: 0.5in; }
    .header { text-align: center; margin-bottom: 0.5in; }
    .title { font-size: 16px; font-weight: bold; }
    .section { margin: 0.3in 0; }
    .section-title { font-weight: bold; text-decoration: underline; }
    .signature-block { margin-top: 0.5in; padding-top: 0.3in; border-top: 1px solid #000; }
    .signature-line {
      display: inline-block;
      border-bottom: 1px solid #000;
      width: 2in;
      margin: 0 0.1in;
      height: 0.2in;
    }
    .date-line {
      display: inline-block;
      border-bottom: 1px solid #000;
      width: 1in;
      margin-left: 0.2in;
      height: 0.2in;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">INDEPENDENT CONTRACTOR AGREEMENT</div>
    <div>FAJ Solutions</div>
  </div>

  <div class="section">
    <div class="section-title">1. ENGAGEMENT</div>
    <p>FAJ Solutions ("Company") engages you as an independent contractor to perform field services including but not limited to network installation, low-voltage work, site surveys, and related technical services ("Services").</p>
  </div>

  <div class="section">
    <div class="section-title">2. TERM</div>
    <p>This agreement begins on the date signed below and continues until terminated by either party with 7 days written notice.</p>
  </div>

  <div class="section">
    <div class="section-title">3. COMPENSATION</div>
    <p>You will be compensated based on rates agreed to for each project or assignment. Payment will be made within 14 days of project completion and approval. No compensation is due until work is submitted for approval.</p>
  </div>

  <div class="section">
    <div class="section-title">4. INDEPENDENT CONTRACTOR STATUS</div>
    <p>You are an independent contractor, not an employee of the Company. You are responsible for all taxes, insurance, and withholdings. The Company will not provide workers' compensation, unemployment insurance, health insurance, or retirement benefits.</p>
  </div>

  <div class="section">
    <div class="section-title">5. W-9 TAX FORM</div>
    <p>You must complete and submit IRS Form W-9 before any work commences. The Company will report compensation on Form 1099-NEC if annual payments exceed $600.</p>
  </div>

  <div class="section">
    <div class="section-title">6. INSURANCE AND LIABILITY</div>
    <p>You are responsible for maintaining appropriate liability insurance covering your work. You agree to indemnify and hold harmless the Company from any claims arising from your work or negligence.</p>
  </div>

  <div class="section">
    <div class="section-title">7. WORK STANDARDS</div>
    <p>All work must be performed professionally, safely, and in compliance with applicable laws and regulations. You agree to follow the Company's safety protocols and customer guidelines.</p>
  </div>

  <div class="section">
    <div class="section-title">8. CONFIDENTIALITY</div>
    <p>You agree to maintain confidentiality regarding customer information, project details, and any proprietary methods or data shared by the Company.</p>
  </div>

  <div class="section">
    <div class="section-title">9. TERMINATION</div>
    <p>Either party may terminate this agreement at any time with 7 days written notice. Upon termination, you must return all Company property and complete any in-progress work.</p>
  </div>

  <div class="section">
    <div class="section-title">10. GOVERNING LAW</div>
    <p>This agreement is governed by the laws of Pennsylvania.</p>
  </div>

  <div class="signature-block">
    <div style="margin: 0.3in 0;">
      <strong>CONTRACTOR SIGNATURE:</strong><br>
      Signature: <span class="signature-line"></span><br>
      Print Name: ________________________________<br>
      Date: <span class="date-line"></span>
    </div>

    <div style="margin: 0.3in 0; margin-top: 0.5in;">
      <strong>FAJ SOLUTIONS:</strong><br>
      By: ________________________________<br>
      Title: ________________________________<br>
      Date: <span class="date-line"></span>
    </div>
  </div>

  <div style="margin-top: 0.5in; padding-top: 0.3in; border-top: 1px solid #999; font-size: 0.8em; color: #666;">
    Please complete, sign, and return this agreement along with your completed W-9 form to: fajsolutions@gmail.com
  </div>
</body>
</html>
`;

export const W9_EMAIL_TEMPLATE = (contractorName: string, w9Link: string) => `
<h2>W-9 Tax Form & Contractor Agreement</h2>
<p>Hi ${contractorName},</p>
<p>Before we can get you started on projects with FAJ Solutions, we need two important documents:</p>

<h3>1. IRS Form W-9</h3>
<p>This is a standard tax form that tells us your tax identification number. You can:</p>
<ul>
  <li><strong>Fill it out online:</strong> <a href="${w9Link}">Click here to fill out your W-9</a></li>
  <li><strong>Print & mail it:</strong> <a href="${w9Link}?format=download">Download the W-9 PDF</a>, print it, sign it, and mail to FAJ Solutions, Easton, PA</li>
  <li><strong>Print & email it:</strong> Download, print, sign, and email the scanned copy to fajsolutions@gmail.com</li>
</ul>

<h3>2. Contractor Agreement</h3>
<p>This is a simple agreement outlining how we work together. <a href="${w9Link}?doc=agreement">Download the contractor agreement</a>, review it, sign it, and email it back to fajsolutions@gmail.com</p>

<h3>What Happens Next</h3>
<p>Once we receive your signed W-9 and agreement, you'll be all set to start taking on projects. We'll upload your W-9 to our QuickBooks system for tax reporting purposes.</p>

<p>Questions? Reply to this email or call us.</p>
<p>Thanks,<br>FAJ Solutions</p>
`;

export const CONTRACTOR_AGREEMENT_EMAIL = (contractorName: string, agreementLink: string) => `
<h2>Contractor Agreement for FAJ Solutions</h2>
<p>Hi ${contractorName},</p>
<p>Please review and sign the attached contractor agreement. This outlines:</p>
<ul>
  <li>How we work together</li>
  <li>Payment terms</li>
  <li>Your status as an independent contractor</li>
  <li>Insurance and liability</li>
  <li>Confidentiality</li>
</ul>

<p>You can:</p>
<ul>
  <li><strong>Sign electronically:</strong> <a href="${agreementLink}">Click here to review and sign</a></li>
  <li><strong>Print & mail:</strong> <a href="${agreementLink}?format=download">Download PDF</a>, print, sign, and mail to FAJ Solutions, Easton, PA</li>
  <li><strong>Print & email:</strong> Download, print, sign, and email the scanned copy to fajsolutions@gmail.com</li>
</ul>

<p>Once signed and received, you're ready to go!</p>
<p>Thanks,<br>FAJ Solutions</p>
`;
