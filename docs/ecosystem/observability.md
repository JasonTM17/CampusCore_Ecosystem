# Observability contract — correlation id, metrics, log redaction

Pha: P03 step 3 · Owner: controller · Review: Kongming + tester contract
Liên quan: `contracts/ecosystem/domain-contracts.md`, gate `contracts` trong
`scripts/verify-ecosystem.gates.json`, `scripts/contract-verify.mjs`.

## 1. Correlation id (`X-Request-Id`)

| Điểm | Hành vi | Trạng thái |
| --- | --- | --- |
| Server | `RequestIdFilter` (HIGHEST_PRECEDENCE) nhận header `X-Request-Id` nếu khớp `[A-Za-z0-9._:-]{1,128}`, ngược lại tự sinh UUID; id đặt vào request attribute + echo trên mọi response | EXISTING |
| Mobile | `createApiClient.requestWithMeta` sinh `mobile-<ts>-<rand>` mỗi request; refresh gắn `<id>-refresh`; `ApiClientError` mang `requestId` để support join | EXISTING (P03 thêm metric hook) |
| Web | axios request interceptor trong `frontend/src/lib/api.ts` gắn `newRequestId()` nếu caller chưa đặt; response id đi vào `ApiMetric.requestId` | P03 |
| Quy tắc | Client KHÔNG tái sử dụng id giữa các request; id do caller cung cấp bị server validate — giá trị ngoài charset bị thay bằng UUID server (probe `invalid` trong contract-verify chứng minh) | contract |

Support/audit join: `X-Request-Id` trên response error + log server + metric
client dùng chung một giá trị — không thêm trace header thứ hai ở pha này.

## 2. Metric hooks (client-side)

Mỗi app có module pure `observability` (web: `src/lib/observability.ts`,
native: `src/api/observability.ts`) cùng contract:

```
recordApiMetric({ method, path, status, durationMs, requestId, at })
apiMetricsSnapshot()            // bounded ring, 100 entry cuối
subscribeApiMetrics(listener)   // hook cho debug/dev overlays, tương lai OTel
redactForLog(value)             // xem §3
```

Ring buffer chỉ là **metric hook nội bộ** — không phải telemetry sink; không
persist, không gửi đi. `durationMs` đo từ request start tới response cuối
(sau retry chain cuối cùng ở web, sau fetch cuối ở native).

`path` trong metric là **path-template**: segment trông như resource id
(UUID, số, hex ≥16 ký tự) được `pathTemplate()` gom về `{id}` trước khi vào
ring — tránh cardinality nổ và tránh entity id rơi vào metric artifact.

Bất đối xứng có chủ đích giữa hai transport (ghi nhận, không ép đồng nhất):
request id của native là `mobile-*` do client tự sinh và gửi lên server như
mọi client id khác (server vẫn validate charset); `durationMs` web gồm cả
retry chain axios, native chỉ gồm fetch cuối sau refresh.

Server-side: `/actuator/health` công khai; metric export chi tiết (micrometer
registry) là việc của pha vận hành (P14) — P03 chỉ đóng băng hook + tên metric
chuẩn `api.client.request` với tag `{method, path-template, status-class}`.

## 3. Log redaction

Nguyên tắc: credential (Bearer token, refresh token, password, cookie,
`Authorization`/`Set-Cookie` header value, token/password/secret trong query)
không bao giờ xuất hiện trong application log, error `message`, hay client
console/debug artifact.

- `redactForLog()` trong cả hai `observability` module là helper chuẩn khi
  client cần log chẩn đoán: strip `Bearer …`, `token|password|secret=…`,
  header auth/cookie dạng chuỗi `"k" : "v"` (kể cả có whitespace — JSON/string
  form). Không phải sanitizer toàn cục — chỉ là lớp thứ hai; contract bắt
  buộc vẫn là credential không được đưa vào log ngay từ đầu (sentinel test §3).
- Gate `contracts` case `contract-probes` chạy **sentinel test**: gửi Bearer
  `SENTINEL-BEARER-*` và password `SENTINEL-PASS-*` tới API thật, quét
  `docker compose logs` — xuất hiện literal nào cũng là FAIL.
- Error envelope (domain-contracts §1.1) đã cấm internal id/stack/column trong
  `message` — redaction là lớp thứ hai cho phần lọt qua.

## 4. Cache / private-response contract

| Kiểm | Cơ chế | Case gate |
| --- | --- | --- |
| Private response `no-store` | Spring Security default headers phát `Cache-Control: no-cache, no-store, max-age=0, must-revalidate` + `Pragma: no-cache` + `Expires: 0` trên mọi response. Assert bắt buộc trên **private-class** (protected → 401 phải `no-store` + status đúng 401); public feed/api-docs **ghi nhận** vì P06 được phép thêm public caching | `contract-probes` |
| Cross-account cache | Web: `query-cache-identity.test.js` — SSR không share client, AuthContext `clear()` mọi identity transition, session race không hồi sinh user cũ, **real `QueryClient.clear()` evict hết entry** (không chỉ stub). Native: `sessionEpoch` guard — refresh rotation của session cũ không đè session mới (test mô phỏng refresh pending + sign-in mới). Mobile chưa có data cache (không react-query/storage) nên sessionEpoch là toàn bộ mặt cách ly hiện hữu | `cross-account-cache` (node --test) |
| Cache phía client của API | axios instance gửi `Cache-Control: no-store` request header | EXISTING |

Giới hạn còn lại (ghi trung thực): probe `no-store` mới chứng minh trên
private-**class** response (401 unauthenticated). Authenticated 200 responses
của private endpoints chưa được probe — cần session thật, thuộc bước khi P04
identity/session hoàn chỉnh; được kỳ vọng pass vì header phát ở filter chain
chung, nhưng chưa là bằng chứng.

## 5. PostgreSQL buộc chạy thật

`contracts` gate case `pgit-real` delegate `platform-verify.mjs pgit` trên
disposable Postgres 15 cho các family contract-relevant:
`AuthCredentialRevocation`, `AuthSessionLockOrdering`,
`CredentialSessionLockOrder` (rig pin :5452 khi rảnh),
`AcademicEnrollmentIdempotencyRace`. Zero-test bị từ chối (zeroTestGuard).

## 6. Bằng chứng

`artifacts/verification/contracts/` sau khi gate chạy:
`contract-probes.json` (generator + header + request-id + redaction),
`pgit-real.json`, `run.log`, `report.json`, `tokens-check` log.
