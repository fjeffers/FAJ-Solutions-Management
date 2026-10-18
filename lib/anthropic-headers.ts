// Headers for every call to Claude (Generate with AI, receipt and item scans,
// survey photos, the support helper).
//
// Fred's Anthropic key (2026-10-17) is an organization-wide key that isn't tied
// to a workspace, and Anthropic answers such a key with 400 "This API key is
// not scoped to a workspace, so this request must include the
// anthropic-workspace-id header". When ANTHROPIC_WORKSPACE_ID is set, every
// call names the workspace; with a workspace key it can stay unset.
export function workspaceHeader(): Record<string, string> {
  const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return ws ? { 'anthropic-workspace-id': ws } : {};
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    ...workspaceHeader(),
  };
}
