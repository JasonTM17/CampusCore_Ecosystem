/** Lecturer-portal copy (teaching schedule, grade import, profile redirect). */
export interface LecturerSurfacesCopy {
  schedule: {
    eyebrow: string; title: string; description: string; selectSemester: string;
    allSemesters: string; loading: string; unavailableTitle: string; emptyTitle: string;
    emptyDescription: string; weeklyAgenda: string; weeklyGrid: string;
    assignedSectionsList: string; noTeachingSlot: string; noTeachingSlotHint: string;
    items: string; item: string; sectionPrefix: string; roomPending: string;
    today: string; viewGrid: string; viewDay: string; viewList: string; print: string;
    totalSections: string; totalSlots: string; totalStudents: string;
    clickToViewDetails: string; courseCode: string; courseName: string; section: string;
    department: string; day: string; time: string; classroom: string; enrolled: string;
    actions: string; studentsSuffix: string; printEmail: string;
  };
  gradeImport: {
    title: string; chooseFile: string; pasteAria: string; pastePlaceholder: string; fillTable: string;
  };
  profile: { redirecting: string };
}

export const lecturerSurfacesEn: LecturerSurfacesCopy = {
  schedule: {
    eyebrow: 'Lecturer area', title: 'Teaching schedule',
    description: 'Lecturer semester teaching timetable and class schedule.',
    selectSemester: 'Select semester for teaching schedule', allSemesters: 'All semesters',
    loading: 'Loading teaching schedule', unavailableTitle: 'Teaching schedule unavailable',
    emptyTitle: 'No teaching assignments yet',
    emptyDescription: 'Once class sections are assigned, teaching meetings will appear here in the weekly schedule.',
    weeklyAgenda: 'Weekly teaching agenda', weeklyGrid: 'Weekly timetable grid',
    assignedSectionsList: 'Teaching class sections list', noTeachingSlot: 'No teaching slot scheduled.',
    noTeachingSlotHint: 'Teaching slots for the selected day will appear here.',
    items: 'items', item: 'item', sectionPrefix: 'Section', roomPending: 'Pending room',
    today: 'TODAY', viewGrid: 'Weekly Grid', viewDay: 'Day View', viewList: 'List View',
    print: 'Print Schedule', totalSections: 'Classes', totalSlots: 'Sessions / week',
    totalStudents: 'Students', clickToViewDetails: 'Click on any class to view complete details',
    courseCode: 'Code', courseName: 'Course Title', section: 'Section',
    department: 'Department', day: 'Day', time: 'Time', classroom: 'Room',
    enrolled: 'Enrolled', actions: 'Details', studentsSuffix: 'students', printEmail: 'Email:',
  },
  gradeImport: {
    title: 'Import scores from a CSV/TSV file', chooseFile: 'Choose a CSV file',
    pasteAria: 'Paste grade rows', pastePlaceholder: 'Or paste grade rows here…',
    fillTable: 'Fill the grade table',
  },
  profile: { redirecting: 'Redirecting to Profile Settings...' },
};

export const lecturerSurfacesVi: LecturerSurfacesCopy = {
  schedule: {
    eyebrow: 'Cổng Giảng viên', title: 'Lịch giảng dạy',
    description: 'Thời khóa biểu giảng dạy và lịch công tác học kỳ của giảng viên.',
    selectSemester: 'Chọn học kỳ cho lịch giảng dạy', allSemesters: 'Tất cả học kỳ',
    loading: 'Đang tải lịch giảng dạy', unavailableTitle: 'Lịch giảng dạy chưa sẵn sàng',
    emptyTitle: 'Chưa có phân công giảng dạy',
    emptyDescription: 'Khi lớp học phần được phân công, các buổi giảng dạy sẽ xuất hiện tại đây theo lịch tuần.',
    weeklyAgenda: 'Lịch dạy theo tuần', weeklyGrid: 'Lưới thời khóa biểu',
    assignedSectionsList: 'Danh sách lớp học phần giảng dạy', noTeachingSlot: 'Chưa có ca giảng dạy nào.',
    noTeachingSlotHint: 'Các ca giảng dạy của ngày đã chọn sẽ xuất hiện tại đây.',
    items: 'mục', item: 'mục', sectionPrefix: 'Lớp HP', roomPending: 'Chưa xếp phòng',
    today: 'HÔM NAY', viewGrid: 'Lưới tuần', viewDay: 'Theo ngày', viewList: 'Danh sách',
    print: 'In lịch giảng dạy', totalSections: 'Lớp học phần', totalSlots: 'Buổi dạy / tuần',
    totalStudents: 'Tổng sinh viên', clickToViewDetails: 'Bấm vào lớp học phần để xem chi tiết đầy đủ',
    courseCode: 'Mã HP', courseName: 'Tên học phần', section: 'Lớp HP',
    department: 'Khoa / Bộ môn', day: 'Thứ', time: 'Giờ dạy', classroom: 'Phòng học',
    enrolled: 'Sĩ số', actions: 'Chi tiết', studentsSuffix: 'sinh viên', printEmail: 'Email:',
  },
  gradeImport: {
    title: 'Nhập điểm từ tệp CSV/TSV', chooseFile: 'Chọn tệp CSV',
    pasteAria: 'Dán bảng điểm', pastePlaceholder: 'Hoặc dán các dòng điểm vào đây…',
    fillTable: 'Điền vào bảng điểm',
  },
  profile: { redirecting: 'Đang chuyển tiếp đến Hồ sơ cá nhân & Cài đặt...' },
};
