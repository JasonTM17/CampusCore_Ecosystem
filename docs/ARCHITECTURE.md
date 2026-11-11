# CampusCore — System Architecture & Engineering Blueprint

```mermaid
flowchart TB
    subgraph clients["Clients"]
        web["<b>Next.js web portal</b><br/>students · lecturers · admins"]
        mobile["<b>Expo mobile app</b><br/>Android / iOS"]
    end
    subgraph edge["Edge + public API"]
        caddy["<b>Caddy edge</b><br/>TLS · /api/v1 · web"]
        api["<b>Spring Boot REST API</b><br/>OIDC issuer · academics · thesis<br/>grades · attendance · files"]
    end
    subgraph assistant["Private assistant"]
        rag["<b>RAG service sidecar</b><br/>role-scoped retrieval"]
        llm["<b>LLM provider</b><br/>DeepSeek · server-side key"]
    end
    subgraph data["Data"]
        pg[("<b>PostgreSQL</b><br/>system of record · Flyway")]
        store[("<b>Assistant store</b><br/>knowledge + chat history")]
    end
    web -->|HTTPS| caddy
    mobile -->|HTTPS| caddy
    caddy -->|/api/v1| api
    api -->|read / write| pg
    api -->|assistant call| rag
    rag -.->|prompt| llm
    rag -.->|retrieve| store

    classDef client fill:#eff6ff,stroke:#2563eb,color:#0f172a
    classDef core fill:#f0fdf4,stroke:#16a34a,color:#0f172a
    classDef ai fill:#faf5ff,stroke:#9333ea,color:#0f172a
    classDef db fill:#fff7ed,stroke:#ea580c,color:#0f172a
    class web,mobile client
    class caddy,api core
    class rag,llm ai
    class pg,store db
    style clients fill:#f8fafc,stroke:#cbd5e1
    style edge fill:#f8fafc,stroke:#cbd5e1
    style assistant fill:#f8fafc,stroke:#cbd5e1
    style data fill:#f8fafc,stroke:#cbd5e1
```

> This blueprint documents the runtime boundaries, concurrency invariants, data ownership models, security controls, and design non-goals of **CampusCore**.

---

## 1. Runtime Topology & Network Boundaries

```mermaid
flowchart TD
    subgraph CLIENTS["TẦNG GIAO DIỆN & TRUY CẬP (CLIENTS)"]
        Web["Next.js 15 Web Portal\n(:3000 mặc định | Cookie HttpOnly + CSRF)"]
        Mobile["Expo React Native App\n(Thử nghiệm | Bearer JWT)"]
        Browser["Trình duyệt Người dùng"]
    end

    subgraph BACKEND["TẦNG DỊCH VỤ JAVA (JAVA APPLICATION LAYER)"]
        REST["Spring Boot 4.1 REST API\n(:4010 | /api/v1/)\n• Auth & RBAC Security Filter\n• 4-Layer Registration Engine\n• Gradebook & Transcript Service\n• Thesis Lifecycle Manager\n• Assistant Gateway & Quota Guard"]
        RAG["Private rag-service Sidecar\n(:4011 | chỉ expose nội bộ)\n• Bilingual Prompt-Injection Guard\n• Lexical ranking BM25\n• Snapshot runtime reader\n• Thực thi Flyway migration trong compose"]
    end

    subgraph DATA["TẦNG DỮ LIỆU & LƯU TRỮ (PERSISTENCE)"]
        PG[(PostgreSQL 15\n:5432 host mặc định | DB campuscore_restful\nSchema: campuscore_auth · academic ·\nthesis · assistant · engagement · notifications)]
        Flyway["Flyway Migration Engine\n(versioned scripts trong\njava-services/restful-api/src/main/\nresources/db/migration/)"]
    end

    subgraph EXTERNAL["DỊCH VỤ NGOÀI (EXTERNAL)"]
        DeepSeek["DeepSeek API\ndeepseek-v4-flash (Tùy chọn)"]
        Mailpit["Mailpit Local SMTP\n(:8025 UI / :1025 SMTP)"]
    end

    Browser --> Web
    Web --> REST
    Mobile --> REST

    REST --> PG
    REST --> RAG
    RAG --> PG
    RAG -.-> DeepSeek
    REST -.-> Mailpit
    Flyway --> PG
```

> Trong cụm Docker Compose, `rag-service` là bên thực thi Flyway (`restful-api` chạy với `FLYWAY_ENABLED=false`). Khi chạy JAR trực tiếp, Flyway bật mặc định theo `application.yml`. Cổng host đều ghi đè được qua `.env` (xem `docker-compose.yml`).

### Ứng dụng di động

```mermaid
flowchart TB
    subgraph nav["Navigation"]
        direction LR
        router["<b>Expo Router</b><br/>app shell · deep links"] --> guard["<b>Route map + guard</b><br/>session · role · grants"] --> shell["<b>Tabs + menu</b><br/>role-specific"]
    end
    subgraph screens["Role screens"]
        direction LR
        student["<b>Student</b><br/>schedule · grades · thesis"]
        lecturer["<b>Lecturer</b><br/>gradebook · attendance"]
        admin["<b>Admin</b><br/>overview · people"]
        shared["<b>Shared</b><br/>news · notifications · profile"]
        student ~~~ lecturer ~~~ admin ~~~ shared
    end
    subgraph services["Client services"]
        direction LR
        session["<b>Session store</b><br/>refresh token in SecureStore"] -.->|token| client["<b>API client</b><br/>bearer token · 401 refresh"]
        client ~~~ files["<b>Native file adapter</b><br/>pick · save · share"]
    end
    subgraph backend["Backend"]
        direction LR
        caddy["<b>Caddy edge</b><br/>/api/v1 · web"] --> api["<b>Spring Boot REST API</b><br/>OIDC issuer · domain API"] -->|SQL| pg[("<b>PostgreSQL</b>")]
    end
    nav --> screens
    screens -->|fetch · pick / save| services
    services -->|HTTPS| backend

    classDef navc fill:#eff6ff,stroke:#2563eb,color:#0f172a
    classDef scr fill:#f0fdfa,stroke:#0d9488,color:#0f172a
    classDef svc fill:#f0fdf4,stroke:#16a34a,color:#0f172a
    classDef be fill:#fff7ed,stroke:#ea580c,color:#0f172a
    class router,guard,shell navc
    class student,lecturer,admin,shared scr
    class client,session,files svc
    class caddy,api,pg be
    style nav fill:#f8fafc,stroke:#cbd5e1
    style screens fill:#f8fafc,stroke:#cbd5e1
    style services fill:#f8fafc,stroke:#cbd5e1
    style backend fill:#f8fafc,stroke:#cbd5e1
```

Sơ đồ dưới đây mô tả đăng nhập OIDC, làm mới phiên API và tải tệp trên ứng dụng di động.

```mermaid
sequenceDiagram
    participant User
    participant App
    participant SecureStore
    participant Edge
    participant Issuer
    participant API

    rect rgb(240, 248, 255)
        Note over User,Issuer: OIDC sign-in
        User->>App: Start sign-in
        App->>Issuer: Authorize with PKCE S256
        Issuer-->>App: Redirect with authorization code
        App->>Issuer: Exchange code with verifier
        Issuer-->>App: Return access and refresh tokens
        App->>App: Keep access token in memory
        App->>SecureStore: Save refresh token
    end

    rect rgb(240, 253, 244)
        Note over App,API: API call and refresh
        App->>Edge: Request with bearer token
        Edge->>API: Forward /api/v1 request
        API-->>Edge: Return 401
        Edge-->>App: Return 401
        App->>Issuer: Refresh through shared lane
        Issuer-->>App: Return rotated tokens
        App->>SecureStore: Save rotated refresh token
        App->>Edge: Retry once with bearer token
        Edge->>API: Forward retried request
        API-->>Edge: Return API response
        Edge-->>App: Return API response
        Note over App,SecureStore: Terminal failure clears session
        Note over App,SecureStore: Unavailable refresh stays retryable
    end

    rect rgb(255, 248, 240)
        Note over User,API: Picked-file upload
        User->>App: Choose a file
        App->>App: Open native picker
        App->>App: Await copy into app cache
        App->>App: Validate size and type
        App->>Edge: Send multipart to /api/v1
        Edge->>API: Forward multipart request
        API-->>Edge: Return upload response
        Edge-->>App: Return upload response
        App->>App: Release cached copy
    end
```

Ứng dụng dùng Expo Router; sơ đồ tuyến và màn hình được sở hữu tại [route map](../mobile/src/navigation/route-map.ts) và [registry tuyến](../mobile/src/navigation/routes.ts). Một singleton [`apiClient`](../mobile/src/api/client.ts) phục vụ các facade REST `/api/v1`. Access token chỉ nằm trong bộ nhớ; refresh token nằm trong [SecureStore session store](../mobile/src/auth/session-store.ts), còn trao đổi/làm mới OIDC gọi issuer riêng.

Lớp tệp gốc trong [native file adapter](../mobile/src/api/native-file-adapter.ts) dùng thao tác `expo-file-system` bất đồng bộ để sao chép tệp đã chọn vào app cache trước khi tải lên; lớp này cũng sở hữu chọn, lưu và chia sẻ tệp. In bảng điểm/bảng kết quả và nhập điểm hàng loạt được chuyển sang web qua [màn bảng điểm](../mobile/src/screens/academic/TranscriptScreen.tsx) và [màn chấm điểm giảng viên](../mobile/src/screens/operations/LecturerGradingScreen.tsx).

Cache truy vấn theo tài khoản chỉ giữ dữ liệu trong bộ nhớ: có thể hiện dữ liệu cũ sau lỗi mạng, nhưng không có kho offline bền vững hoặc ghi offline ([query cache](../mobile/src/hooks/query-cache.ts), [screen query hook](../mobile/src/hooks/useScreenQuery.ts)). Lane check-in được bật tại thời điểm build bằng `EXPO_PUBLIC_LANE_CHECKIN` và tắt mặc định ([lane flags](../mobile/src/config/lane-flags.ts)). Reverse proxy phụ thuộc môi trường; cấu hình edge hiện có trong repo là [Caddy](../ops/caddy/Caddyfile).

### Quy tắc phân chia ranh giới mạng (Boundary Rules):
1. **Một Cổng API Duy Nhất**: Ứng dụng Java (`restful-api`) là dịch vụ duy nhất sở hữu và công khai các route `/api/v1/**` ra bên ngoài.
2. **Cách ly Dịch vụ RAG**: Dịch vụ `rag-service` chạy trên cổng nội bộ `4011`, tuyệt đối không mở port ra internet trong Docker Compose. Mọi truy vấn từ Frontend đều phải đi qua cổng kiểm soát của REST API (`/api/v1/assistant/chat`), nơi thực hiện xác thực người dùng và kiểm tra hạn ngạch.
3. **Phân quyền xác thực Client**:
   - Web Client — direct lane (mặc định khi BFF tắt): cookie HTTP-only `cc_access_token`/`cc_refresh_token` với `SameSite=Lax`, cộng token double-submit `cc_csrf` (không HttpOnly).
   - Web Client — BFF lane: `__Host-cu_session` với `SameSite=Strict`; `cc_csrf` cũng `Strict`. Cả hai lane web đều dựa trên CSRF token cho request ghi.
   - Mobile Client: Sử dụng OAuth2-compatible Bearer Access & Refresh Tokens.
   - Cả hai client đều tuân thủ cùng một bản hợp đồng OpenAPI (`/v3/api-docs`).

---

## 2. Mô hình Sở hữu Dữ liệu (Domain Ownership)

PostgreSQL là nguồn dữ liệu duy nhất (Single Source of Truth) của hệ thống. Cơ sở dữ liệu được phân chia thành các schema độc lập và quản lý hoàn toàn bằng **Flyway Migrations**:

```mermaid
erDiagram
    USER ||--|| STUDENT : "liên kết định danh"
    USER ||--|| LECTURER : "liên kết định danh"
    DEPARTMENT ||--o{ MAJOR : "quản lý đào tạo"
    MAJOR ||--o{ STUDENT : "thuộc ngành"
    COURSE ||--o{ SECTION : "mở lớp học phần"
    SEMESTER ||--o{ SECTION : "thuộc học kỳ"
    CLASSROOM ||--o{ SECTION : "xếp phòng học"
    LECTURER ||--o{ SECTION : "giảng dạy"
    STUDENT ||--o{ ENROLLMENT : "đăng ký học"
    SECTION ||--o{ ENROLLMENT : "tiếp nhận"
    ENROLLMENT ||--|| GRADE : "có điểm tổng kết"
    THESIS_ROUND ||--o{ THESIS_TOPIC : "đợt đề tài"
    THESIS_TOPIC ||--o{ THESIS_GROUP : "phân công"
    STUDENT ||--o{ THESIS_GROUP_MEMBER : "thành viên nhóm"
    KNOWLEDGE_REVISION ||--|| KNOWLEDGE_SNAPSHOT : "xuất bản thành"
    ANNOUNCEMENT ||--o{ NOTIFICATION : "phát sinh thông báo"
```

1. **`campuscore_auth`**:
   - Lưu trữ `User`, `Role`, `Session`, `RefreshToken`, `AuditLog`.
   - Mật khẩu được mã hóa bằng thuật toán `BCrypt` với chi phí tính toán (strength factor) 10.
2. **`academic`**:
   - Quản lý cây danh mục đào tạo: `Department` -> `Major` -> `Student`, `Lecturer`.
   - Cấu trúc môn học & lịch: `Course`, `Classroom`, `Semester`, `AcademicYear`.
   - Thực thể giao dịch: `Section` (Lớp học phần), `Enrollment` (Đăng ký), `Grade` (Điểm thành phần & điểm thi).
   - Sử dụng mã định danh ổn định (ví dụ: mã số sinh viên `21110001`, mã học phần `MATH140101`).
3. **`thesis`**:
   - Quản lý vòng đời luận văn tốt nghiệp: `ThesisRound`, `ThesisTopic`, `ThesisGroup`, `ThesisGroupMember`.
   - Định danh thực thể hoàn toàn bằng `UUIDv4`.
4. **`assistant`**:
   - Quản lý tri thức RAG: `KnowledgeRevision`, `KnowledgeSnapshot`, `AssistantTurn`, `AssistantTurnLease`.
5. **`engagement`**:
   - Quản lý tin tức và cảnh báo: `Announcement`, `Notification`.
6. **`notifications`**:
   - Hạ tầng phát sinh thông báo riêng khỏi bảng tin `engagement`.

---

## 3. Động cơ Chống Race Condition Đăng ký Học phần 4 Lớp

### Thách thức Kỹ thuật
Trong đợt mở cổng đăng ký tín chỉ (ví dụ: 08:00 sáng), hàng ngàn sinh viên click nút đồng thời để tranh chấp 10 chỗ trống cuối cùng của một lớp học phần chất lượng cao. Nếu chỉ sử dụng logic kiểm tra đơn giản (`if (count < capacity) insert()`), hiện tượng **Race Condition** và **Overselling** chắc chắn xảy ra, dẫn đến sĩ số thực tế vượt quá sức chứa của phòng học.

### Mô hình Phòng thủ 4 Lớp

```mermaid
sequenceDiagram
    autonumber
    actor Student as Sinh viên (Browser)
    participant Web as Next.js Web Portal
    participant API as Spring Boot REST API
    participant DB as PostgreSQL Database

    Student->>Web: Nhấn "Đăng ký" môn học
    Web->>Web: Sinh Idempotency-Key (UUIDv4)
    Web->>API: POST /api/v1/me/enrollments (SectionId, Key)

    activate API
    API->>API: Kiểm tra Header & Quyền STUDENT
    API->>DB: BEGIN TRANSACTION (Isolation: Read Committed)

    API->>DB: Lớp 1: SELECT * FROM academic."Section" WHERE "id" = :id FOR UPDATE
    Note over DB: Khóa dòng độc quyền (Pessimistic Row Lock).<br/>Các giao dịch khác cùng vào Section này buộc phải chờ tuần tự.

    API->>DB: Lớp 2: UPDATE academic."Section" SET "enrolledCount" = "enrolledCount" + 1 WHERE "id" = :id AND "enrolledCount" < "capacity"
    alt Hết chỗ ("enrolledCount" >= "capacity")
        DB-->>API: 0 dòng bị cập nhật (Cập nhật thất bại)
        API->>DB: ROLLBACK
        API-->>Web: HTTP 409 Conflict (SECTION_FULL)
        Web-->>Student: Báo lỗi: Lớp học phần đã đủ sĩ số!
    else Còn chỗ ("enrolledCount" < "capacity")
        DB-->>API: 1 dòng cập nhật thành công
        API->>DB: Lớp 3: INSERT INTO academic."Enrollment" (studentId, sectionId, status) VALUES (..., 'ENROLLED')
        alt Đã đăng ký trước đó
            DB-->>API: Vi phạm Unique Constraint (academic_enrollment_active_student_section_uq)
            API->>DB: ROLLBACK
            API-->>Web: HTTP 409 Conflict (ENROLLMENT_DUPLICATE)
            Web-->>Student: Báo lỗi: Bạn đã có tên trong lớp này!
        else Đăng ký mới hợp lệ
            DB-->>API: Insert thành công
            API->>DB: COMMIT TRANSACTION
            API-->>Web: HTTP 200 OK (EnrollmentResponse)
            Web-->>Student: Thông báo đăng ký thành công & Cập nhật TKB!
        end
    end
    deactivate API
```

1. **Lớp 1: Khóa dòng bi quan (Pessimistic Row Lock)**
   Câu lệnh `SELECT ... FOR UPDATE` tuần tự hóa các yêu cầu cạnh tranh cùng một lớp học phần tại tầng lưu trữ PostgreSQL, loại bỏ hoàn toàn các hiện tượng đọc bẩn (Dirty Read) hoặc đọc không thể lặp lại (Non-repeatable Read).
2. **Lớp 2: Cập nhật điều kiện nguyên tử (Atomic Conditional Update)**
   Câu lệnh SQL `SET "enrolledCount" = "enrolledCount" + 1 WHERE "id" = :id AND "enrolledCount" < "capacity"` đảm bảo mức tăng trưởng sĩ số được kiểm chứng ngay tại thời điểm ghi dữ liệu xuống đĩa. Nếu lớp đã chạm ngưỡng, không có dòng nào bị ảnh hưởng và giao dịch bị hủy bỏ.
3. **Lớp 3: Chỉ mục duy nhất cục bộ (Partial Unique Index)**
   Chỉ mục `CREATE UNIQUE INDEX academic_enrollment_active_student_section_uq ON academic."Enrollment" ("studentId", "sectionId") WHERE "status" IN ('ENROLLED', 'PENDING', 'CONFIRMED')` tạo nên một chốt chặn cơ sở dữ liệu bất biến. Ngay cả khi có sự cố logic phần mềm, DB sẽ từ chối ngay lập tức bản ghi thứ hai đang hiệu lực của cùng một sinh viên trong một lớp.
4. **Lớp 4: Khóa chống lặp yêu cầu mạng (Idempotency Key)**
   Mọi thao tác thay đổi trạng thái đều bắt buộc truyền `Idempotency-Key` dạng UUIDv4. Nếu mạng bị chập chờn và client gửi lại request, hệ thống sẽ trả về kết quả đã xử lý trước đó mà không trừ thêm sĩ số lớp học.

---

## 4. Kiến trúc Trợ lý AI (CampusCore RAG Assistant)

```mermaid
sequenceDiagram
    autonumber
    actor User as Sinh viên / Giảng viên
    participant Web as Next.js Web
    participant API as REST API (:4010)
    participant Sidecar as rag-service (:4011)
    participant DB as PostgreSQL Snapshot
    participant DeepSeek as DeepSeek V4 Flash

    User->>Web: Đặt câu hỏi quy chế đào tạo
    Web->>API: POST /api/v1/assistant/chat (Session Cookie)

    activate API
    API->>API: Kiểm tra JWT Token & Session
    API->>API: AssistantInputGuard: Quét Prompt Injection song ngữ (VI/EN)
    alt Phát hiện tấn công Jailbreak
        API-->>Web: HTTP 200 OK (reasonCode=PROMPT_INJECTION, terminalStatus=REJECTED)
    else Hợp lệ
        API->>DB: CAS Quota Check (Tối đa 20 lượt/ngày)
        alt Hết hạn ngạch
            API-->>Web: HTTP 200 OK (reasonCode=QUOTA_EXCEEDED)
        else Còn quota
            API->>Sidecar: POST /internal/rag/assistant
            activate Sidecar
            Sidecar->>DB: Tìm kiếm Lexical BM25 trên snapshot
            DB-->>Sidecar: Trích đoạn quy chế liên quan
            alt Đạt độ tương quan cao
                Sidecar-->>API: 200 OK (Answer + Citations [1], [2])
            else Câu hỏi suy luận khó & DEEPSEEK_ENABLED=true
                Sidecar->>DeepSeek: Gửi Context + Câu hỏi (Model Flash)
                DeepSeek-->>Sidecar: Phản hồi nội dung
                Sidecar->>Sidecar: Rà soát trích dẫn với snapshot
                Sidecar-->>API: 200 OK (Synthesized Answer + Citations)
            end
            deactivate Sidecar
            API-->>Web: Hiển thị câu trả lời có trích dẫn tài liệu thật
        end
    end
    deactivate API
```

- **Ngăn chặn Prompt-Injection Song ngữ (`AssistantInputGuard`)**: Bộ lọc phân tích cú pháp ở cả đầu vào và đầu ra nhằm triệt tiêu các nỗ lực tấn công prompt leak, model hijacking hoặc giả mạo phân quyền bằng tiếng Anh hoặc tiếng Việt.
- **Hạn ngạch nguyên tử (Atomic Quota Bucket)**: Giới hạn 20 lượt hỏi/người/ngày. Kỹ thuật Compare-And-Swap (CAS) ngăn chặn hoàn toàn việc gửi nhiều request đồng thời để vượt ngưỡng.
- **Truy hồi Lexical & LLM Fallback**:
  - Dữ liệu kiến thức được biên soạn và lưu trữ dưới dạng snapshot bất biến trong PostgreSQL.
  - Tìm kiếm Lexical (BM25 / Full-text search) trả về câu trả lời kèm trích dẫn văn bản quy chế chính xác trong vòng 50ms.
  - Khi cần suy luận sâu, ngữ cảnh được gửi đến `deepseek-v4-flash` (không dùng thinking, tối đa 6.000 ký tự). Nếu provider gặp sự cố, timeout hoặc hết tiền, API tự động chuyển về trả lời Lexical nguyên bản mà không bị gián đoạn.

---

## 5. Quy trình Kiểm duyệt Tri thức 2 Quản trị viên (Two-Admin Governance)

```mermaid
stateDiagram-v2
    [*] --> DRAFT: Admin 1 tạo bản thảo kiến thức
    DRAFT --> PENDING_REVIEW: Admin 1 gửi yêu cầu phê duyệt

    state PENDING_REVIEW {
        [*] --> AuthorityCheck: Kiểm tra danh tính Admin duyệt
        AuthorityCheck --> SelfApprovalRejected: Admin duyệt == Admin tạo (Báo lỗi 409)
        AuthorityCheck --> PrivacyGateCheck: Admin duyệt != Admin tạo (Hợp lệ)
        PrivacyGateCheck --> PrivacyFailed: Phát hiện PII / Dữ liệu mật
        PrivacyGateCheck --> PrivacyPassed: Dữ liệu sạch
    }

    SelfApprovalRejected --> PENDING_REVIEW: Chờ Admin khác xử lý
    PrivacyFailed --> DRAFT: Trả về yêu cầu chỉnh sửa
    PrivacyPassed --> PUBLISHED: Chấp thuận xuất bản

    PUBLISHED --> ATOMIC_PROMOTION: Cập nhật Snapshot RAG nguyên tử
    ATOMIC_PROMOTION --> LIVE: Trợ lý AI sẵn sàng phục vụ
    LIVE --> [*]
```

- **Four-Eyes Principle**: Mọi thay đổi về chính sách, học phí hay quy định đào tạo phải được duyệt bởi một Admin thứ hai khác với tác giả tạo bản nháp.
- **Privacy Gate**: Rà soát tự động trước khi xuất bản để loại trừ thông tin định danh cá nhân (PII), email riêng tư hoặc bí mật nội bộ.
- **Atomic Promotion**: Cập nhật snapshot trong một câu lệnh giao dịch đơn lẻ, loại trừ hiện tượng người dùng đọc phải snapshot đang cập nhật dở dang.

---

## 6. Thiết kế Giao diện Người dùng (UI Reference Language)

Giao diện người dùng của CampusCore được thiết kế dựa trên ngôn ngữ nhận diện học vụ của **HCMUTE**:
- **Khung vỏ xanh thể chế (Institutional Blue Shell)**: Màu primary `#003F87` cùng nền sáng `#F9F9FF` và điểm nhấn vàng HCMUTE, định nghĩa tập trung trong `frontend/src/app/globals.css`; giao diện hỗ trợ chủ đề sáng/tối và các biến thể màu accent (ví dụ `river-blue`).
- **Khung vỏ dashboard thống nhất**: Thanh điều hướng trên cùng (điều hướng, chuyển ngữ, đổi theme, chuông thông báo) kèm các thẻ chỉ số học tập dựng bằng `WorkspaceSurface`; khung chat Trợ lý AI là drawer riêng (`AssistantPanel`) và trạng thái cấm truy cập xử lý tập trung qua `WorkspaceForbiddenState`.
- **Bảng dữ liệu xanh đậm (Blue Header Tables)**: Hiển thị dày đặc thông tin điểm số, thời khóa biểu, danh sách lớp học phần theo chuẩn học vụ truyền thống.
- **Xử lý trạng thái tường minh**: Toàn bộ các trạng thái Tải dữ liệu (Loading skeleton), Dữ liệu rỗng (Empty state), Lỗi mạng (Error state), và Cấm truy cập (Forbidden 403) đều được xử lý với thông báo rõ ràng, song ngữ.

Sinh viên cần tra cứu kết quả đăng ký và lịch học cả sau khi đợt đăng ký đóng, nên quyền xem phải độc lập với thời hạn thêm/rút học phần và dữ liệu phải gắn với tài khoản, học kỳ đang xem. Điểm vào: [trang đăng ký](../frontend/src/app/dashboard/register/page.tsx), [tab điều hướng](../frontend/src/components/registration/registration-tabs.tsx) và [khung học phần đã đăng ký](../frontend/src/components/registration/registered-courses-panel.tsx); lịch học dùng [WeeklyGrid](../frontend/src/components/schedule/weekly-grid.tsx). Bằng chứng tương tác nằm trong [kiểm thử trình duyệt](../frontend/e2e/registration-details.spec.ts).

Kết quả chưa xác nhận khi mạng lỗi không được xem là chưa đăng ký: sinh viên cần biết độ tin cậy của dữ liệu trước khi quyết định tín chỉ hoặc lịch học. Ngữ cảnh tab, học kỳ và bộ lọc trong URL phục vụ việc chia sẻ, tải lại và quay về đúng góc nhìn; chủ sở hữu hợp đồng này là trang đăng ký và khung học phần đã đăng ký ở trên. Cùng một buổi học phải có tên thứ thống nhất và thứ tự thời gian rõ ràng ở mọi góc nhìn; ranh giới quy ước ngày học, kể cả dữ liệu Chủ Nhật cũ, nằm tại WeeklyGrid và [hàm xử lý lịch tuần](../frontend/src/lib/weekly-grid.ts). Các trường hợp biên được định nghĩa trong [kiểm thử lịch và nhãn thứ](../frontend/tests/registration-ux.test.js).

Trên màn hình hẹp, truy cập trợ lý phải giữ chỗ cho thao tác học phần và xem lịch; điểm sở hữu lựa chọn hiển thị nút nổi là [AssistantPanel](../frontend/src/components/assistant/AssistantPanel.tsx). Điều hướng bàn phím, tên điều khiển và thông báo lỗi phải giúp sinh viên hiểu trạng thái mà không phụ thuộc màu sắc hoặc thông báo thoáng qua. Các điểm vào là tab điều hướng, trang đăng ký và [nội dung song ngữ](../frontend/src/i18n/messages.ts); kiểm thử trình duyệt ở trên sở hữu các kịch bản tương tác, còn kết quả chạy và bằng chứng phát hành thuộc hồ sơ kế hoạch/phát hành.

---

## 7. Ranh giới ngoài phạm vi (Non-goals)

Các thành phần sau đây được xác định rõ ràng là **nằm ngoài phạm vi của đồ án môn học** để giữ cho hệ thống tập trung vào bài toán cốt lõi:
- **Tài chính & Cổng thanh toán trực tuyến** (Finance, Payment gateways).
- **Phân tích kinh doanh nâng cao & Dashboard BI** (Analytics, Data warehouse).
- **Hệ thống hỗ trợ Helpdesk & Ticket** (Support ticketing system).
- **Hạ tầng phân tán phức tạp**: Cụm Redis, RabbitMQ, Kafka, MinIO, Nginx, Kubernetes, Cloudflare tunnels.
- **Cơ sở dữ liệu Vector chuyên dụng** (Milvus, Pinecone, Qdrant): Thay vào đó, CampusCore chứng minh năng lực RAG xuất sắc thông qua PostgreSQL snapshot và Lexical BM25 deterministic ranking.

---

*Tài liệu kiến trúc hệ thống CampusCore — Bản cập nhật phục vụ thẩm định kỹ thuật đồ án.*
