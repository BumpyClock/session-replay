import type {
  IndexedSessionEntry as CanonicalIndexedSessionEntry,
  SessionCatalogProvider as CanonicalSessionCatalogProvider,
  SessionFileFingerprint as CanonicalSessionFileFingerprint,
  SessionFileRef as CanonicalSessionFileRef,
  SessionSearchDoc as CanonicalSessionSearchDoc,
} from '../../src/lib/session/contracts'

export type SessionFileFingerprint = CanonicalSessionFileFingerprint
export type SessionFileRef = CanonicalSessionFileRef
export type SessionSearchDoc = CanonicalSessionSearchDoc
export type IndexedSessionEntry = CanonicalIndexedSessionEntry
export type SessionCatalogProvider = CanonicalSessionCatalogProvider
