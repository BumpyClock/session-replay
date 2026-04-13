/**
 * Stable HTTP error used by API route handlers.
 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
    this.status = status
  }
}
