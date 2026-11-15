# Phase 4 — Trang Đăng ký học phần + Học phí chuyên nghiệp

## Mục tiêu
Hai trang mới theo UX cổng trường ĐH thật (PTIT/UEF/Banner-style).

## `/vi/dang-ky-hoc-phan` (thay bảng đăng ký trong dashboard)
- Layout 3 vùng: rail trái = cây CTĐT (Năm → Kỳ → Môn, trạng thái: đã đạt/đang học/đủ ĐK/thiếu tiên quyết từ `/me/registration/roadmap` mới); giữa = catalog nhóm theo Khoa → nhóm môn với filter modes (CTĐT/chưa học/học lại/theo khoa/tìm kiếm); phải = giỏ đăng ký + TKB xung đột + hạn mức tín chỉ.
- Backend: `GET /me/registration/roadmap` (Student→Curriculum→CurriculumCourse join Enrollment/Grade → per-course status + prereq satisfied); mở rộng `/me/registration/sections` với `mode`, `departmentId`, server-side search.
- Redirect `/vi/dashboard/register` → trang mới (giữ deep-link cũ).
- Wishlist (đăng ký nguyện vọng): bảng `academic."RegistrationWish"` (studentId, courseId, termId, createdAt) + `me/registration/wishes` endpoints — nếu scope vượt, tách PR riêng.

## `/vi/hoc-phi` (bursar)
- Tổng quan tài khoản: công nợ, hold badge; bảng hoá đơn theo kỳ; chi tiết invoice (từng môn × tín chỉ × đơn giá); nút "Thanh toán" demo → confirm → Payment → cập nhật; link biên lai/PDF nếu renderer sẵn có.
- Cảnh báo nợ/hold trên trang đăng ký (banner từ `/me/bursar/holds`).

## Nghiệm thu
- E2E: student đăng nhập → vào `/vi/dang-ky-hoc-phan` → thấy CTĐT roadmap → đăng ký môn → slip; `/vi/hoc-phi` hiển thị hoá đơn, thanh toán demo PAID.
- i18n vi+en đầy đủ; mobile vẫn dùng API cũ được (không bắt buộc đổi).
- Devin Review + CI xanh trước merge.
