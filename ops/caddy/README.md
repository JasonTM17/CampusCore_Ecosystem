# Caddy operations

Caddy allows up to five minutes for graceful shutdown so active API requests,
including assistant SSE streams, can drain during a reload or stop. Coordinate
deployments that may outlast this window; a longer running stream can still be
closed when the grace period expires.
