// Registry of known MCP providers for ticket, docs, and code-quality categories.
// Each provider describes the `claude mcp add` command to run, which env vars to
// collect, and (optionally) a `test(envVars)` request used to actually verify the
// credentials against the provider's API before saving.

export const TICKET_PROVIDERS = [
  {
    id: 'atlassian',
    label: 'Atlassian (Jira) — @atlassian/mcp',
    mcpName: 'atlassian',
    envVars: [
      { key: 'ATLASSIAN_BASE_URL', prompt: 'Atlassian base URL (e.g. https://yourorg.atlassian.net): ' },
      { key: 'ATLASSIAN_API_TOKEN', prompt: 'Atlassian API token: ' },
      { key: 'ATLASSIAN_EMAIL', prompt: 'Atlassian account email: ' }
    ],
    // npx-based server from the community registry
    command: ['npx', '-y', '@atlassian/mcp@latest'],
    test: envVars => ({
      url: `${envVars.ATLASSIAN_BASE_URL}/rest/api/3/myself`,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${envVars.ATLASSIAN_EMAIL}:${envVars.ATLASSIAN_API_TOKEN}`).toString('base64'),
        Accept: 'application/json'
      }
    })
  },
  {
    id: 'linear',
    label: 'Linear MCP',
    mcpName: 'linear',
    envVars: [
      { key: 'LINEAR_API_KEY', prompt: 'Linear API key: ' }
    ],
    command: ['npx', '-y', '@linear/mcp@latest'],
    test: envVars => ({
      url: 'https://api.linear.app/graphql',
      method: 'POST',
      headers: { Authorization: envVars.LINEAR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' })
    })
  },
  {
    id: 'github',
    label: 'GitHub Issues (via gh MCP)',
    mcpName: 'github',
    envVars: [
      { key: 'GITHUB_TOKEN', prompt: 'GitHub personal access token: ' }
    ],
    command: ['npx', '-y', '@modelcontextprotocol/server-github@latest'],
    test: envVars => ({
      url: 'https://api.github.com/user',
      headers: { Authorization: `Bearer ${envVars.GITHUB_TOKEN}`, 'User-Agent': 'sethlans-cli' }
    })
  }
]

export const DOCS_PROVIDERS = [
  {
    id: 'atlassian',
    label: 'Confluence (via Atlassian MCP — reuses Jira config)',
    mcpName: 'atlassian',  // same server as TICKET_PROVIDERS atlassian
    reusesTicket: 'atlassian'
  },
  {
    id: 'notion',
    label: 'Notion MCP',
    mcpName: 'notion',
    envVars: [
      { key: 'NOTION_API_TOKEN', prompt: 'Notion integration token: ' }
    ],
    command: ['npx', '-y', '@modelcontextprotocol/server-notion@latest'],
    test: envVars => ({
      url: 'https://api.notion.com/v1/users/me',
      headers: { Authorization: `Bearer ${envVars.NOTION_API_TOKEN}`, 'Notion-Version': '2022-06-28' }
    })
  }
]

export const CODE_QUALITY_PROVIDERS = [
  {
    id: 'codescene',
    label: 'CodeScene',
    mcpName: 'codescene',
    envVars: [
      { key: 'CODESCENE_URL', prompt: 'CodeScene URL (e.g. https://codescene.io): ' },
      { key: 'CODESCENE_API_TOKEN', prompt: 'CodeScene API token: ' }
    ],
    command: ['npx', '-y', '@codescene/mcp@latest'],
    test: envVars => ({
      url: `${envVars.CODESCENE_URL}/api/v2/projects`,
      headers: { Authorization: `Bearer ${envVars.CODESCENE_API_TOKEN}` }
    })
  },
  {
    id: 'sonarqube',
    label: 'SonarQube',
    mcpName: 'sonarqube',
    envVars: [
      { key: 'SONAR_URL', prompt: 'SonarQube URL: ' },
      { key: 'SONAR_TOKEN', prompt: 'SonarQube token: ' }
    ],
    command: ['npx', '-y', '@sonarqube/mcp@latest'],
    test: envVars => ({
      url: `${envVars.SONAR_URL}/api/system/status`,
      headers: { Authorization: 'Bearer ' + envVars.SONAR_TOKEN }
    })
  },
  {
    id: 'codacy',
    label: 'Codacy',
    mcpName: 'codacy',
    envVars: [
      { key: 'CODACY_API_TOKEN', prompt: 'Codacy API token: ' }
    ],
    command: ['npx', '-y', '@codacy/mcp@latest'],
    test: envVars => ({
      url: 'https://app.codacy.com/api/v3/user',
      headers: { 'api-token': envVars.CODACY_API_TOKEN }
    })
  }
]

/**
 * Verify a provider's credentials against its real API.
 * Prefers `provider.test(envVars)` — an authenticated request that proves the
 * token actually works, not just that some host is reachable. Falls back to a
 * plain HEAD request on the first `*_URL` env var when a provider has no
 * dedicated test (e.g. providers whose only configurable field is a base URL).
 * Distinguishes "unreachable" from "reached but rejected" (401/403) so a typo'd
 * token doesn't look like a network problem.
 */
export async function testProvider(provider, envVars) {
  const req = provider.test ? provider.test(envVars) : null

  if (!req) {
    const urlKey = provider.envVars.find(v => /_URL$/.test(v.key))?.key
    const url = urlKey && envVars[urlKey]
    if (!url) return { ok: true, message: 'No automated check available for this provider — credentials are only validated when the MCP server actually runs.' }
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      return { ok: true, message: `Reachable (HTTP ${res.status}). Token format only — not authenticated.` }
    } catch (err) {
      return { ok: false, message: `Could not reach ${url}: ${err.message}` }
    }
  }

  try {
    const res = await fetch(req.url, {
      method: req.method || 'GET',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(8000)
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Reached the API but authentication failed (HTTP ${res.status}) — check the token/credentials.` }
    }
    if (!res.ok) {
      return { ok: false, message: `Unexpected response from the API (HTTP ${res.status}).` }
    }
    return { ok: true, message: `Authenticated successfully (HTTP ${res.status}).` }
  } catch (err) {
    return { ok: false, message: `Could not reach the API: ${err.message}` }
  }
}
