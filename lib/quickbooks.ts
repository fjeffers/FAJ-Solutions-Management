import { OAuthClient } from 'intuit-oauth';

const oauthClient = new OAuthClient({
  clientId: process.env.QB_CLIENT_ID || '',
  clientSecret: process.env.QB_CLIENT_SECRET || '',
  environment: process.env.QB_ENVIRONMENT || 'sandbox',
  redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/quickbooks/callback`,
});

export interface QBVendor {
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
  TaxID?: string;
}

export async function createQBVendor(
  accessToken: string,
  realmId: string,
  vendor: QBVendor
): Promise<any> {
  try {
    const url = `https://quickbooks.api.intuit.com/v2/company/${realmId}/vendor`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(vendor),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`QB API error: ${error.message}`);
    }

    return await response.json();
  } catch (err) {
    console.error('QB vendor creation error:', err);
    throw err;
  }
}

export async function uploadQBAttachment(
  accessToken: string,
  realmId: string,
  fileName: string,
  fileContent: Buffer,
  entityId: string,
  entityType: 'Vendor' = 'Vendor'
): Promise<any> {
  try {
    const url = `https://quickbooks.api.intuit.com/v2/company/${realmId}/upload`;

    const formData = new FormData();
    formData.append('file', new Blob([fileContent], { type: 'application/pdf' }), fileName);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`QB upload error: ${error.message}`);
    }

    const uploadResponse = await response.json();

    // Create attachment reference
    const attachmentUrl = `https://quickbooks.api.intuit.com/v2/company/${realmId}/attachable`;

    const attachablePayload = {
      AttachableRef: [
        {
          EntityRef: {
            type: entityType,
            value: entityId,
          },
        },
      ],
      AttachFile: uploadResponse.AttachFile,
      FileName: fileName,
    };

    const attachResponse = await fetch(attachmentUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(attachablePayload),
    });

    if (!attachResponse.ok) {
      const error = await attachResponse.json();
      throw new Error(`QB attachment error: ${error.message}`);
    }

    return await attachResponse.json();
  } catch (err) {
    console.error('QB attachment upload error:', err);
    throw err;
  }
}

export { oauthClient };
