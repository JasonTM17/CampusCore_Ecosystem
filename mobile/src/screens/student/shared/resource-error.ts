/**
 * A screen-local read or write answered 401. The API client's refresh lane owns
 * the only sign-in route, so a widget keeps this inline and retryable: it shows
 * its own fallback copy instead of claiming the session expired.
 *
 * Pure and dependency-free so every screen family can share the rule without
 * pulling the API client (and its session store) into its module graph.
 */
export function isResourceUnauthorizedError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  return status === 401 || code === 'HTTP_401' || code === 'UNAUTHENTICATED';
}
