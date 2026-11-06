-- Each announcement keeps the summary that matches its own title and body.
-- V64 assigned one summary to every id in a group; this forward migration
-- replaces those copies by id and does not change any other column.

UPDATE engagement."Announcement"
SET "summary" = 'Khoa Công nghệ Thông tin khánh thành cụm máy chủ điện toán hiệu năng cao 8 GPU NVIDIA A100, lưu trữ Ceph 500TB và mạng InfiniBand 200Gbps cho nghiên cứu Big Data và AI.'
WHERE "id" = 'announcement-ute-bigdata-ai-center';

UPDATE engagement."Announcement"
SET "summary" = 'Nhà trường đưa vào vận hành 04 phòng thí nghiệm trí tuệ nhân tạo và dữ liệu lớn tại tòa nhà C1 và B2, với máy chủ GPU cho học tập và nghiên cứu.'
WHERE "id" = 'announcement-v32-smart-campus';

UPDATE engagement."Announcement"
SET "summary" = 'Ngày hội UTE Tech Career Expo 2026 diễn ra ngày 23/10/2026 tại Khu A, với hơn 60 tập đoàn và 1.200 vị trí thực tập sinh, kỹ sư phần mềm, AI và Cloud DevOps.'
WHERE "id" = 'announcement-ute-career-fair-tech-2026';

UPDATE engagement."Announcement"
SET "summary" = 'Hơn 60 tập đoàn công nghệ có mặt tại sảnh tòa nhà A1 để tuyển dụng thực tập sinh và kỹ sư chính thức.'
WHERE "id" = 'announcement-v32-job-fair';

UPDATE engagement."Announcement"
SET "summary" = 'FPT Software phỏng vấn 150 chỉ tiêu thực tập OJT và Fresher vào ngày 25/09/2026 tại Sảnh Lớn, gồm Java, Fullstack, Embedded và AI.'
WHERE "id" = 'announcement-ute-fpt-ojt-career-day';

UPDATE engagement."Announcement"
SET "summary" = 'Hội đồng học bổng công bố đối soát GPA và điểm rèn luyện đợt 1: xuất sắc từ 3.60 được 120% học phí, giỏi từ 3.20 được 100% và khá từ 2.50 được 50%.'
WHERE "id" = 'announcement-ute-scholarship-dr-criteria';

UPDATE engagement."Announcement"
SET "summary" = 'Học bổng Samsung Talent Program 2026 tài trợ 54 triệu đồng mỗi suất, khóa thuật toán và đồ án tại Samsung Lab; hạn nộp hồ sơ là 15/10/2026.'
WHERE "id" = 'announcement-ute-samsung-scholarship-2026';

UPDATE engagement."Announcement"
SET "summary" = 'Học bổng Intel STEM 2026 dành cho nữ sinh kỹ thuật, 30 triệu đồng mỗi suất và thực tập có lương; phỏng vấn từ 20/10/2026 đến 25/10/2026.'
WHERE "id" = 'announcement-ute-intel-stem-women-2026';

UPDATE engagement."Announcement"
SET "summary" = 'Học bổng khuyến khích học tập xét hồ sơ tự động cho sinh viên có GPA từ 3.2 trở lên và điểm rèn luyện khá.'
WHERE "id" = 'announcement-v26-scholarship';

UPDATE engagement."Announcement"
SET "summary" = 'Phòng Đào tạo mở đăng ký học phần học kỳ 1 năm học 2026-2027 trên CampusUTE, trần 28 tín chỉ và phân luồng theo khóa từ ngày 25/08/2026.'
WHERE "id" = 'announcement-ute-course-reg-official';

UPDATE engagement."Announcement"
SET "summary" = 'Nhà trường mở đợt đăng ký học phần học kỳ 1; sinh viên kiểm tra điều kiện tiên quyết, lịch học và số chỗ trước khi xác nhận.'
WHERE "id" = 'announcement-registration-window';

UPDATE engagement."Announcement"
SET "summary" = 'Khoa Công nghệ Thông tin tổ chức bảo vệ khóa luận đợt 2; sinh viên cần từ 110 tín chỉ, nhóm từ 1 đến 3 người và nộp phiếu trước 25/09/2026.'
WHERE "id" = 'announcement-ute-thesis-registration-fall';

UPDATE engagement."Announcement"
SET "summary" = 'Nhà trường mở vòng đăng ký luận văn tốt nghiệp cho sinh viên năm cuối; xem danh sách đề tài, đăng ký nhóm và kiểm tra tín chỉ tích lũy trước hạn.'
WHERE "id" = 'announcement-v26-thesis-round';

UPDATE engagement."Announcement"
SET "summary" = 'Nhà trường phát động giải thưởng nghiên cứu khoa học và khởi nghiệp 2026-2027, hỗ trợ mỗi đề tài từ 10 đến 30 triệu đồng cho AI, IoT và chuyển đổi số.'
WHERE "id" = 'announcement-ute-student-scientific-research-awards';

UPDATE engagement."Announcement"
SET "summary" = 'Ban Giám hiệu phát động nghiên cứu khoa học sinh viên 2026-2027 với tổng giải thưởng 500 triệu đồng; hạn đăng ký đề tài tại văn phòng khoa là 30/10.'
WHERE "id" = 'announcement-v32-ute-research';

UPDATE engagement."Announcement"
SET "summary" = 'UTE Innovation Award 2026 có hơn 300 triệu đồng giải thưởng và tối đa 20 triệu đồng mỗi mẫu thử; hạn nộp đề cương là 30/10/2026.'
WHERE "id" = 'announcement-ute-innovation-awards-2026';
