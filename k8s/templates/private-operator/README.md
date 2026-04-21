# Private Operator Template Pack

This directory is a tracked, safe-to-copy handoff pack for real staging/prod clusters.

It intentionally keeps only placeholders. Do not place real hostnames, ingress annotations, `ClusterSecretStore`, `ClusterIssuer`, remote secret keys, or secret values in this public repo.

Use it by copying one environment folder into a private overlay repository, replacing every `replace-with-real-*` and `replace-with-private-*` value, then rendering it with `kubectl kustomize` before applying it to a real cluster.

