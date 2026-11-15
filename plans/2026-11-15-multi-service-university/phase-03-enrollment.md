# Phase 3 — enrollment-api container (Registrar slice)

## Mục tiêu
Container riêng cho đăng ký học phần bằng profile flag trên cùng image restful-api (precedent: rag-service `persistence` profile, port 4011).

## Việc cần làm
1. `application-enrollment.properties` + `EnrollmentSliceFilter`: chỉ allow `/api/v1/me/registration/**`, `/api/v1/me/enrollments/**`, `/actuator/health`, `/api/v1/auth/**` (nếu cần cho OIDC flow); mọi route khác → 404 với header `X-Served-By: enrollment-api`.
2. `docker-compose.yml`: service `enrollment-api` — cùng build context restful-api, `SPRING_PROFILES_ACTIVE=persistence,enrollment`, port 4013, cùng env DB/JWT.
3. Cập nhật `ops/edge/nginx.conf`: nhóm route registration → `enrollment-api` upstream.
4. Endpoint allowlist test: `EnrollmentSliceFilterTest` — route ngoài allowlist 404, route trong pass-through.
5. Financial hold hook: `RegistrationService` trước khi enroll → gọi `bursar-api` `/internal/bursar/holds/{studentId}` (RestClient + token nội bộ + timeout/fail-open theo config `bursar.enforcement=true|false`, default warn-only local) → 409 `TUITION_HOLD` khi bị chặn.

## Nghiệm thu
- `curl :4013/api/v1/me/registration/rounds` = 200; `curl :4013/api/v1/me/notifications` = 404.
- Đăng ký lớp qua gateway (:8080) thành công, ghi vào DB đúng.
- `student-debt@` bị 409 TUITION_HOLD khi enroll (bursar.enforcement=true trong compose demo).
- rag-service vẫn hoạt động (cùng Dockerfile pattern).
