import OAuthClient from 'intuit-oauth';

const oauthClient = new OAuthClient({
  clientId: process.env.QB_CLIENT_ID || '',
  clientSecret: process.env.QB_CLIENT_SECRET || '',
  environment: (process.env.QB_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
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
    formData.append('file', new Blob([new Uint8Array(fileContent)], { type: 'application/pdf' }), fileName);

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

export async function refreshAccessToken(refreshToken: string) {
  try {
    const response = await fetch('https://oauth.platform.intuit.com/oauth2/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token refresh failed: ${error.error}`);
    }

    return await response.json();
  } catch (err) {
    console.error('Token refresh error:', err);
    throw err;
  }
}

export async function getQuickBooksAuthUrl() {
  return oauthClient.authorizeUri({
    scope: ['com.intuit.quickbooks.accounting'],
    state: Buffer.from(Date.now().toString()).toString('base64'),
  });
}

export async function exchangeCodeForTokens(code: string) {
  try {
    const tokens = await oauthClient.createToken(code);
    const tokenObj = typeof tokens.token === 'string' ? JSON.parse(tokens.token) : tokens.token;
    return {
      access_token: tokenObj.access_token,
      refresh_token: tokenObj.refresh_token,
      expires_in: tokenObj.expires_in,
    };
  } catch (err) {
    console.error('Token exchange error:', err);
    throw err;
  }
}

export async function getCompanyName(environment: string, realmId: string, accessToken: string) {
  try {
    const url = `https://quickbooks.api.intuit.com/v2/company/${realmId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`QB API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.CompanyInfo?.CompanyName || 'QuickBooks Company';
  } catch (err) {
    console.error('Get company name error:', err);
    throw err;
  }
}

export async function listAccounts(environment: string, realmId: string, accessToken: string) {
  try {
    const url = `https://quickbooks.api.intuit.com/v2/company/${realmId}/query?query=select * from Account`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`QB API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.QueryResponse?.Account || [];
  } catch (err) {
    console.error('List accounts error:', err);
    throw err;
  }
}

export async function findOrCreateVendor(
  environment: string,
  realmId: string,
  accessToken: string,
  vendorName: string,
  email?: string
): Promise<any> {
  try {
    // Query for existing vendor
    const query = `select * from Vendor where DisplayName = '${vendorName.replace(/'/g, "''")}'`;
    const url = `https://quickbooks.api.intuit.com/v2/company/${realmId}/query?query=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`QB API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.QueryResponse?.Vendor?.length > 0) {
      return data.QueryResponse.Vendor[0].Id;
    }

    // Create new vendor
    const newVendor = await createQBVendor(accessToken, realmId, {
      DisplayName: vendorName,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
    });
    return newVendor.Vendor.Id;
  } catch (err) {
    console.error('Find or create vendor error:', err);
    throw err;
  }
}

export async function createExpensePurchase(
  environment: string,
  realmId: string,
  accessToken: string,
  expense: any
): Promise<any> {
  try {
    const url = `https://quickbooks.api.intuit.com/v2/company/${realmId}/purchase`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(expense),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`QB API error: ${error.message}`);
    }

    const result = await response.json();
    return result.Purchase?.Id;
  } catch (err) {
    console.error('Create expense purchase error:', err);
    throw err;
  }
}

export { oauthClient };
