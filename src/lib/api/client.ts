import type {
  SessionListResponse,
  SessionLoadRequest,
  SessionLoadResponse,
  SessionPreviewResponse,
  SessionRenderRequest,
  SessionSearchRequest,
  SessionSearchResponse,
} from './contracts'

const DEFAULT_API_BASE = import.meta.env.DEV ? '/api' : 'http://127.0.0.1:4848'

/**
 * Browser client for the local replay API.
 */
export interface SessionReplayApiClient {
  exportSessionDocument(request: SessionRenderRequest, fileName?: string): Promise<string>
  listSessions(): Promise<SessionListResponse>
  loadSession(request: SessionLoadRequest): Promise<SessionLoadResponse>
  previewSession(request: SessionRenderRequest): Promise<SessionPreviewResponse>
  searchSessions(request: SessionSearchRequest): Promise<SessionSearchResponse>
}

/**
 * Creates a typed client for the local replay HTTP API.
 */
export function createSessionReplayApiClient(
  baseUrl = import.meta.env.VITE_SESSION_REPLAY_API_BASE ?? DEFAULT_API_BASE,
): SessionReplayApiClient {
  return {
    exportSessionDocument: async (request, fileName) => {
      const query = fileName ? `?fileName=${encodeURIComponent(fileName)}` : ''

      return fetchText(`${baseUrl}/api/export${query}`, {
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    },
    listSessions: () => fetchJson<SessionListResponse>(`${baseUrl}/api/sessions`),
    loadSession: (request) =>
      fetchJson<SessionLoadResponse>(`${baseUrl}/api/load`, {
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    previewSession: (request) =>
      fetchJson<SessionPreviewResponse>(`${baseUrl}/api/preview`, {
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    searchSessions: (request) =>
      fetchJson<SessionSearchResponse>(`${baseUrl}/api/search`, {
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
  }
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

async function fetchText(input: string, init?: RequestInit): Promise<string> {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`)
  }

  return await response.text()
}
