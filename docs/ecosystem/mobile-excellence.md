# Mobile excellence v2 - hợp đồng thiết kế và dependency (M02)

Phạm vi: nâng app native `mobile/` (Expo SDK 57, RN 0.86.3, React 19.2.3) lên chất lượng cao cho nhiều thiết bị, kế thừa design system của web. Không làm lại miền C2; xem `mobile-policy.md`, `mobile-matrix.md`, `contracts/ecosystem/domain-contracts.md` §13-§14. Nhãn bằng chứng: PASS/FAIL/BLOCKED_CAPABILITY/NOT_RUN; bằng chứng local không chứng minh thiết bị thật.

## 1. Design system một nguồn

- Nguồn: `contracts/ecosystem/tokens.json`; sinh `mobile/src/design/tokens.ts` và `frontend/src/lib/design-tokens.ts` bằng `scripts/sync-tokens.mjs` (không sửa tay adapter). Gate: `node scripts/sync-tokens.mjs --check`, kèm `git status --porcelain` trước/sau.
- M03 lane A mở rộng token **additive**: bảng màu tối ngữ nghĩa (kiểm tương phản từng cặp, không sao chép giá trị chưa kiểm), màu vai trò (student/lecturer/admin/super-admin theo `frontend/DESIGN.md`), thang chữ thích ứng, elevation, motion (có phương án reduce-motion), haptics ưu tiên, breakpoints.
- Giữ neo hiện có: primary `#003F87`, nền `#F9F9FF`, Be Vietnam Pro, nhịp 4 px, vùng chạm 44.

## 2. Lớp kích thước cửa sổ (quyết định M02)

Theo chiều rộng cửa sổ thực tế (`useWindowDimensions`, không theo tên máy): **compact** < 600 dp; **medium** 600 dp đến < 840 dp; **expanded** >= 840 dp. Nguồn: Android Developers "Use window size classes" (compact <600, medium 600-839, expanded 840-1199 theo bảng chính thức; các lớp large/extra-large hoãn, nằm ngoài cam kết v2). Thêm cờ `landscape` và `fontScale`. Điện thoại nhỏ/lớn xử lý bằng reflow trong lớp compact (không thêm lớp thứ tư). Split-view/gập: đọc kích thước cửa sổ thực, không giả định màn hình vật lý. Ngưỡng này là token ngữ nghĩa; đổi cần kiểm tra thiết bị (M06/M07).

## 3. Dependency đã đóng băng (R13)

Cài bằng `npx expo install`, `npx expo install --check` exit 0, `npm test` 57/57 và `npm run typecheck` exit 0 sau khi cài.

| Gói | Phiên bản | Ghi chú |
|---|---|---|
| expo | ~57.0.31 | nâng theo `--check` (drift sẵn có) |
| expo-notifications | ~57.0.24 | công bố 2026-10-22 (6 ngày): ngoại lệ có lý do, đúng pin SDK 57 mà `--check` yêu cầu; push cần dev build, không chạy trong Expo Go |
| expo-haptics | ~57.0.3 | |
| jest ~29.7.0, jest-expo ~57.0.6, @types/jest ^29.5.14 | devDependencies | preset SDK 57 |
| @testing-library/react-native ^14.1.0 + test-renderer ^1.3.1 | devDependencies | RNTL 14: `render()` bất đồng bộ; không dùng react-test-renderer (không hỗ trợ React 19+) |

Không thêm: reanimated, gesture-handler, flash-list, expo-image, expo-updates, expo-localization, crash SDK (YAGNI/R14). `mobile/jest.config.js` ánh xạ `expo-modules-core` do npm lồng gói dưới `expo/node_modules`; script `npm run test:component --prefix mobile` tách khỏi bộ `node --test` hiện có.

## 4. Khóa i18n đóng băng (R20)

`mobile/src/i18n/assistant-messages.ts` và `mobile/src/i18n/notifications-messages.ts` (file mới của lane B) dùng English làm shape gốc và `vi satisfies Record<keyof typeof en, string>` để bắt thiếu/thừa khóa. Lane A chỉ import tên khóa dưới đây. Live region `a11y*` chỉ thông báo đổi trạng thái, không đọc từng token.

| File / key | VI | EN |
|---|---|---|
| assistant `streamingStatus` | Đang tạo câu trả lời… | Answering… |
| assistant `completedStatus` | Đã nhận câu trả lời. | Answer received. |
| assistant `stoppedStatus` | Đã dừng câu trả lời. | Answer stopped. |
| assistant `interruptedStatus` | Kết nối bị gián đoạn. Câu trả lời chưa được xác nhận. | Connection lost. The answer is unconfirmed. |
| assistant `retryAction` | Thử lại yêu cầu này | Retry this request |
| assistant `retryingStatus` | Đang thử lại cùng yêu cầu… | Retrying the same request… |
| assistant `busy` | Một câu trả lời đang được xử lý. | An answer is already in progress. |
| assistant `rateLimited` | Bạn vừa gửi quá nhiều yêu cầu. Hãy thử lại sau {seconds} giây. | Too many requests. Try again in {seconds} seconds. |
| assistant `quotaExceeded` | Bạn đã dùng hết hạn mức trợ lý hôm nay. | You have used today’s assistant allowance. |
| assistant `streamInvalid` | Không thể đọc đầy đủ câu trả lời. Hãy thử lại. | The answer could not be read completely. Try again. |
| assistant `sessionExpired` | Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại. | Your session expired. Please sign in again. |
| assistant `forbidden` | Tài khoản hiện không được phép dùng trợ lý. | This account cannot use the assistant. |
| assistant `unavailable` | Trợ lý hiện chưa sẵn sàng. | The assistant is unavailable right now. |
| assistant `cancelFailed` | Chưa thể dừng yêu cầu. Hãy đợi câu trả lời hoặc thử lại. | The request could not be stopped. Wait for the answer or try again. |
| assistant `a11yStreaming` | Trợ lý đang tạo câu trả lời. | The assistant is generating a response. |
| assistant `a11yCompleted` | Trợ lý đã trả lời. | The assistant has answered. |
| assistant `a11yStopped` | Đã dừng câu trả lời. | Answer stopped. |
| assistant `a11yInterrupted` | Kết nối bị gián đoạn. | Connection lost. |
| notifications `permissionTitle` | Cho phép thông báo | Allow notifications |
| notifications `permissionRationale` | Nhận cập nhật quan trọng về việc học và hoạt động bạn đã đăng ký. | Get important updates about your studies and activities you joined. |
| notifications `enableAction` | Bật thông báo | Enable notifications |
| notifications `permissionDenied` | Quyền thông báo đang tắt. Bạn có thể bật trong cài đặt thiết bị. | Notifications are off. You can turn them on in device settings. |
| notifications `unavailable` | Thông báo đẩy chưa được bật trên ứng dụng này. | Push notifications are not available in this app yet. |
| notifications `registrationFailed` | Không thể bật thông báo. Hãy thử lại. | Notifications could not be enabled. Try again. |
| notifications `unregisterFailed` | Chưa thể cập nhật lựa chọn thông báo. | Notification preference could not be updated. |
| notifications `deviceUpdateFailed` | Không thể cập nhật thiết bị cho thông báo. | This device could not be updated for notifications. |
| notifications `openFailed` | Không thể mở thông báo này. | This notification could not be opened. |

## 5. Bản đồ hệ sinh thái

Bản đồ mặt sản phẩm (native, portal, hub, module API, host/subdomain, quy tắc tách subdomain) được tích hợp vào `mobile-matrix.md` ở M05. Mặc định: route trong portal và module trong API; chỉ tách host khi có chủ sở hữu, ranh giới auth, vận hành và ngân sách riêng.

## 6. Kỳ vọng BLOCKED_CAPABILITY trên host này (R12)

Không emulator/`expo run:*`/gradle: canary SSE trên RN, đo hiệu năng thiết bị, TalkBack/VoiceOver thủ công, build EAS, push thật, kiểm chứng gập/tablet vật lý. Các mục này kết thúc BLOCKED_CAPABILITY kèm lý do; test component/a11y tự động, parity token, contract và Java vẫn chạy local.
