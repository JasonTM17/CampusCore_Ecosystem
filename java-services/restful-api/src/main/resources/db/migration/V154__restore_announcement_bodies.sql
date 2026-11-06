-- Restore the ten announcement bodies V61 copied and V68 left copied.
-- Each body is the original insert text from the earlier migration. No other column changes.

UPDATE engagement."Announcement"
SET content = $v154body1$Sinh viên kiểm tra điều kiện tiên quyết, lịch học và số chỗ trước khi xác nhận đăng ký.$v154body1$
WHERE "id" = 'announcement-registration-window';

UPDATE engagement."Announcement"
SET content = $v154body2$Sinh viên có GPA từ 3.2 trở lên và điểm rèn luyện khá xem xét hồ sơ tự động; kết quả công bố trong trung tâm thông báo.$v154body2$
WHERE "id" = 'announcement-v26-scholarship';

UPDATE engagement."Announcement"
SET content = $v154body3$Sinh viên năm cuối xem danh sách đề tài và đăng ký nhóm trước hạn; kiểm tra yêu cầu tín chỉ tích lũy.$v154body3$
WHERE "id" = 'announcement-v26-thesis-round';

UPDATE engagement."Announcement"
SET content = $v154body4$Nhà trường chính thức đưa vào vận hành 04 phòng Lab hiện đại tại tòa nhà C1 và B2 với hạ tầng máy chủ GPU chuyên dụng hỗ trợ sinh viên học tập và nghiên cứu.$v154body4$
WHERE "id" = 'announcement-v32-smart-campus';

UPDATE engagement."Announcement"
SET content = $v154body5$Hơn 60 tập đoàn công nghệ hàng đầu trong và ngoài nước sẽ có mặt trực tiếp tại sảnh tòa nhà A1 để tuyển dụng thực tập sinh và kỹ sư chính thức.$v154body5$
WHERE "id" = 'announcement-v32-job-fair';

UPDATE engagement."Announcement"
SET content = $v154body6$Ban Giám hiệu trường ĐH Công nghệ Kỹ thuật TP.HCM phát động phong trào nghiên cứu khoa học với tổng giá trị giải thưởng 500 triệu đồng. Các nhóm sinh viên đăng ký đề tài tại văn phòng khoa trước ngày 30/10.$v154body6$
WHERE "id" = 'announcement-v32-ute-research';

UPDATE engagement."Announcement"
SET content = $v154body7$<p>Trung tâm Nghiên cứu & Phát triển Samsung Việt Nam (SRV) phối hợp cùng Trường Đại học Sư phạm Kỹ thuật TP.HCM thông báo chương trình Học bổng Samsung Talent Program 2026:</p>
<ul>
  <li><strong>Giá trị học bổng:</strong> 54.000.000 VNĐ/suất tài trợ trực tiếp và tài trợ hoàn toàn khóa học Thuật toán nâng cao & Đồ án tốt nghiệp tại Samsung Lab.</li>
  <li><strong>Đối tượng dự tuyển:</strong> Sinh viên năm 3 và năm 4 các ngành Công nghệ Thông tin, Kỹ thuật Máy tính, Điện tử Viễn thông có GPA &ge; 2.80.</li>
  <li><strong>Đặc quyền:</strong> Được tiếp nhận chính thức vào làm việc tại Samsung R&D sau khi tốt nghiệp mà không phải trải qua kỳ thi tuyển dụng thông thường.</li>
  <li><strong>Hạn chót nhận hồ sơ:</strong> Trước 17:00 ngày 15/10/2026 tại Cổng thông tin Sinh viên.</li>
</ul>$v154body7$
WHERE "id" = 'announcement-ute-samsung-scholarship-2026';

UPDATE engagement."Announcement"
SET content = $v154body8$<p>Tập đoàn Intel Products Vietnam công bố gói học bổng khuyến khích tài năng nữ trong khối ngành kỹ thuật công nghệ:</p>
<ul>
  <li><strong>Mức học bổng:</strong> 30.000.000 VNĐ/suất cùng cơ hội thực tập có lương tại nhà máy Intel TP.HCM.</li>
  <li><strong>Điều kiện:</strong> Nữ sinh viên hệ chính quy các ngành Cơ khí, Điện - Điện tử, Tự động hóa, CNTT có kết quả học tập xếp loại Giỏi hoặc đạt giải thưởng NCKH.</li>
  <li><strong>Thời gian phỏng vấn:</strong> Dự kiến từ ngày 20/10/2026 đến ngày 25/10/2026.</li>
</ul>$v154body8$
WHERE "id" = 'announcement-ute-intel-stem-women-2026';

UPDATE engagement."Announcement"
SET content = $v154body9$<p>Phòng Quan hệ Doanh nghiệp trân trọng thông báo Ngày hội phỏng vấn tuyển dụng thực tập doanh nghiệp (OJT Kỳ 1 năm học 2026-2027):</p>
<ul>
  <li><strong>Vị trí tuyển dụng:</strong> 150 chỉ tiêu Thực tập sinh & Kỹ sư Fresher: Java Backend, React/Node.js Fullstack, Embedded Systems, C/C++ Automotive, AI/Data Engineer.</li>
  <li><strong>Thời gian tổ chức:</strong> 08:00 - 16:30 Thứ Sáu, ngày 25/09/2026 tại Sảnh Lớn Tòa nhà Trung tâm.</li>
  <li><strong>Quy trình:</strong> Phỏng vấn trực tiếp 1-1 với Technical Lead và nhận thư mời thực tập (Offer Letter) ngay trong ngày.</li>
</ul>$v154body9$
WHERE "id" = 'announcement-ute-fpt-ojt-career-day';

UPDATE engagement."Announcement"
SET content = $v154body10$<p>Nhằm thúc đẩy phong trào sáng tạo học thuật, Nhà trường chính thức phát động giải thưởng NCKH sinh viên năm học 2026-2027:</p>
<ul>
  <li><strong>Tổng kinh phí giải thưởng:</strong> Hơn 300.000.000 VNĐ cùng kinh phí hỗ trợ chế tạo mẫu thử nghiệm lên đến 20.000.000 VNĐ/đề tài.</li>
  <li><strong>Lĩnh vực dự thi:</strong> Trí tuệ nhân tạo, Thiết kế vi mạch, Tự động hóa công nghiệp, Ô tô điện thông minh, Năng lượng xanh và Chuyển đổi số.</li>
  <li><strong>Thời hạn đăng ký đề cương:</strong> Hạn chót ngày 30/10/2026 tại Văn phòng Đoàn trường hoặc gửi về email: nckh.sv@campuscore.edu.</li>
</ul>$v154body10$
WHERE "id" = 'announcement-ute-innovation-awards-2026';
