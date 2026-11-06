package io.campuscore.restfulapi.engagement;

import java.util.Map;

/** Expected announcement summaries after the forward repair migration. */
final class DistinctAnnouncementSummaries {
    static final Map<String, String> BY_ID = Map.ofEntries(
            Map.entry("announcement-ute-bigdata-ai-center",
                    "Khoa Công nghệ Thông tin khánh thành cụm máy chủ điện toán hiệu năng cao 8 GPU NVIDIA A100, lưu trữ Ceph 500TB và mạng InfiniBand 200Gbps cho nghiên cứu Big Data và AI."),
            Map.entry("announcement-v32-smart-campus",
                    "Nhà trường đưa vào vận hành 04 phòng thí nghiệm trí tuệ nhân tạo và dữ liệu lớn tại tòa nhà C1 và B2, với máy chủ GPU cho học tập và nghiên cứu."),
            Map.entry("announcement-ute-career-fair-tech-2026",
                    "Ngày hội UTE Tech Career Expo 2026 diễn ra ngày 23/10/2026 tại Khu A, với hơn 60 tập đoàn và 1.200 vị trí thực tập sinh, kỹ sư phần mềm, AI và Cloud DevOps."),
            Map.entry("announcement-v32-job-fair",
                    "Hơn 60 tập đoàn công nghệ có mặt tại sảnh tòa nhà A1 để tuyển dụng thực tập sinh và kỹ sư chính thức."),
            Map.entry("announcement-ute-fpt-ojt-career-day",
                    "FPT Software phỏng vấn 150 chỉ tiêu thực tập OJT và Fresher vào ngày 25/09/2026 tại Sảnh Lớn, gồm Java, Fullstack, Embedded và AI."),
            Map.entry("announcement-ute-scholarship-dr-criteria",
                    "Hội đồng học bổng công bố đối soát GPA và điểm rèn luyện đợt 1: xuất sắc từ 3.60 được 120% học phí, giỏi từ 3.20 được 100% và khá từ 2.50 được 50%."),
            Map.entry("announcement-ute-samsung-scholarship-2026",
                    "Học bổng Samsung Talent Program 2026 tài trợ 54 triệu đồng mỗi suất, khóa thuật toán và đồ án tại Samsung Lab; hạn nộp hồ sơ là 15/10/2026."),
            Map.entry("announcement-ute-intel-stem-women-2026",
                    "Học bổng Intel STEM 2026 dành cho nữ sinh kỹ thuật, 30 triệu đồng mỗi suất và thực tập có lương; phỏng vấn từ 20/10/2026 đến 25/10/2026."),
            Map.entry("announcement-v26-scholarship",
                    "Học bổng khuyến khích học tập xét hồ sơ tự động cho sinh viên có GPA từ 3.2 trở lên và điểm rèn luyện khá."),
            Map.entry("announcement-ute-course-reg-official",
                    "Phòng Đào tạo mở đăng ký học phần học kỳ 1 năm học 2026-2027 trên CampusUTE, trần 28 tín chỉ và phân luồng theo khóa từ ngày 25/08/2026."),
            Map.entry("announcement-registration-window",
                    "Nhà trường mở đợt đăng ký học phần học kỳ 1; sinh viên kiểm tra điều kiện tiên quyết, lịch học và số chỗ trước khi xác nhận."),
            Map.entry("announcement-ute-thesis-registration-fall",
                    "Khoa Công nghệ Thông tin tổ chức bảo vệ khóa luận đợt 2; sinh viên cần từ 110 tín chỉ, nhóm từ 1 đến 3 người và nộp phiếu trước 25/09/2026."),
            Map.entry("announcement-v26-thesis-round",
                    "Nhà trường mở vòng đăng ký luận văn tốt nghiệp cho sinh viên năm cuối; xem danh sách đề tài, đăng ký nhóm và kiểm tra tín chỉ tích lũy trước hạn."),
            Map.entry("announcement-ute-student-scientific-research-awards",
                    "Nhà trường phát động giải thưởng nghiên cứu khoa học và khởi nghiệp 2026-2027, hỗ trợ mỗi đề tài từ 10 đến 30 triệu đồng cho AI, IoT và chuyển đổi số."),
            Map.entry("announcement-v32-ute-research",
                    "Ban Giám hiệu phát động nghiên cứu khoa học sinh viên 2026-2027 với tổng giải thưởng 500 triệu đồng; hạn đăng ký đề tài tại văn phòng khoa là 30/10."),
            Map.entry("announcement-ute-innovation-awards-2026",
                    "UTE Innovation Award 2026 có hơn 300 triệu đồng giải thưởng và tối đa 20 triệu đồng mỗi mẫu thử; hạn nộp đề cương là 30/10/2026."));

    static final Map<String, String> TITLES = Map.ofEntries(
            Map.entry("announcement-ute-bigdata-ai-center",
                    "Khởi động Phòng Nghiên cứu Dữ liệu lớn (Big Data) & Trí tuệ Nhân tạo Khoa CNTT HCM-UTE"),
            Map.entry("announcement-v32-smart-campus",
                    "Khánh thành Hệ thống Phòng thí nghiệm Trí tuệ Nhân tạo & Dữ liệu lớn"),
            Map.entry("announcement-ute-career-fair-tech-2026",
                    "Ngày hội việc làm và Kết nối doanh nghiệp công nghệ thông tin UTE Tech Career Expo 2026"),
            Map.entry("announcement-v32-job-fair",
                    "Ngày hội việc làm và Kết nối doanh nghiệp công nghệ UTE Career Expo"),
            Map.entry("announcement-ute-fpt-ojt-career-day",
                    "Ngày hội Tuyển dụng Thực tập tốt nghiệp OJT & Fresher cùng FPT Software 2026"),
            Map.entry("announcement-ute-scholarship-dr-criteria",
                    "Thông báo xét cấp Học bổng Khuyến khích học tập & Tiêu chuẩn Điểm rèn luyện (ĐRL) đợt 1"),
            Map.entry("announcement-ute-samsung-scholarship-2026",
                    "Học bổng Tài năng Công nghệ Samsung Talent Program (STP) 2026"),
            Map.entry("announcement-ute-intel-stem-women-2026",
                    "Chương trình Học bổng Nữ sinh Kỹ thuật Intel STEM Scholarship 2026"),
            Map.entry("announcement-v26-scholarship",
                    "Học bổng khuyến khích học tập đợt này"),
            Map.entry("announcement-ute-course-reg-official",
                    "Kế hoạch tổ chức đăng ký học phần chính thức Học kỳ 1 năm học 2026-2027"),
            Map.entry("announcement-registration-window",
                    "Mở đợt đăng ký học phần học kỳ 1"),
            Map.entry("announcement-ute-thesis-registration-fall",
                    "Thông báo mở đợt đăng ký Khóa luận tốt nghiệp (KLTN) & Tiểu luận chuyên ngành Khoa CNTT"),
            Map.entry("announcement-v26-thesis-round",
                    "Mở vòng đăng ký luận văn tốt nghiệp"),
            Map.entry("announcement-ute-student-scientific-research-awards",
                    "Phát động Giải thưởng Nghiên cứu Khoa học Sinh viên và Khởi nghiệp Đổi mới Sáng tạo 2026-2027"),
            Map.entry("announcement-v32-ute-research",
                    "Phát động Giải thưởng Nghiên cứu Khoa học Sinh viên 2026-2027"),
            Map.entry("announcement-ute-innovation-awards-2026",
                    "Phát động Giải thưởng Sinh viên Nghiên cứu Khoa học UTE Innovation Award 2026"));

    private DistinctAnnouncementSummaries() {
    }
}
