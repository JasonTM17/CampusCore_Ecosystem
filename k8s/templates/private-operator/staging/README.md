# CampusCore Private Staging Operator Template

Copy this folder to a private overlay before using it against a real staging cluster.

## Fill Before Apply

- Replace `replace-with-real-staging-host.example.com` with the staging hostname.
- Replace `replace-with-real-staging-tls-secret` with the TLS secret name used by the cluster.
- Replace `replace-with-staging-ingress-class` and the private ingress annotation placeholder with values required by the ingress controller.
- Replace `replace-with-real-staging-cluster-secret-store` with the existing `ClusterSecretStore`.
- Replace `replace-with-real-staging-cluster-issuer` with the existing `ClusterIssuer`.
- Replace `replace-with-real-staging/campuscore/runtime` with the remote secret key/path used by the secret manager.
- Review `patch-runtime-overrides.yaml`; it is an example for stateless app replicas/resources/rolling update only.

## Render

```bash
kubectl kustomize k8s/templates/private-operator/staging
kubectl kustomize k8s/templates/private-operator/staging/bootstrap
```

## Apply Order

1. Apply the runtime overlay after private values are replaced.
2. Wait for infrastructure deployments and `ExternalSecret`/`Certificate` readiness.
3. Apply bootstrap jobs from `bootstrap/` in the documented order.
4. Verify `/health`, login/session, and public deny for `/api/v1/internal/*`.

