import { afterEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

let mockLecturerMode: 'full' | 'empty' = 'full';

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: 'live' }; },
  campusApi: {},
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/screens/lanes/LaneEntries', () => ({ LaneEntries: () => null }));
jest.mock('../../src/hooks/useScreenQuery', () => {
  const { campusIsoDate } = require('../../src/i18n/locale') as typeof import('../../src/i18n/locale');
  const schedule = [
    {
      sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204',
      courseNameVi: 'Kiến trúc phần mềm', courseNameEn: 'Software Architecture',
      semesterId: 'term-1', semesterName: 'HK1', semesterNameVi: 'Học kỳ 1', semesterNameEn: 'Semester 1',
      enrolledCount: 16, capacity: 40, credits: 3,
      departmentNameVi: 'Khoa Công nghệ thông tin', departmentNameEn: 'Faculty of Information Technology',
      status: 'OPEN',
      schedules: [
        { id: 'slot-a', dayOfWeek: 2, startTime: '08:00', endTime: '09:30', classroom: { building: 'A2', roomNumber: '204' } },
        { id: 'slot-b', dayOfWeek: 4, startTime: '13:30', endTime: '15:00', classroom: { building: 'A2', roomNumber: '205' } },
      ],
    },
    {
      sectionId: 'section-b', sectionNumber: '02', courseCode: 'BA312',
      courseNameVi: 'Phân tích kinh doanh', courseNameEn: 'Business Analytics',
      semesterId: 'term-1', semesterName: 'HK1', enrolledCount: 18, capacity: 35, credits: 3,
      status: 'CLOSED',
      schedules: [
        { id: 'slot-c', dayOfWeek: 3, startTime: '09:00', endTime: '10:30', classroom: { building: 'B1', roomNumber: '108' } },
      ],
    },
  ];
  const grading = [
    { sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204', courseNameVi: 'Kiến trúc phần mềm', courseNameEn: 'Software Architecture', semesterId: 'term-1', semester: 'HK1', semesterName: 'HK1', semesterNameVi: 'Học kỳ 1', semesterNameEn: 'Semester 1', enrolledCount: 16, gradedCount: 16, publishedCount: 0, canPublish: true, gradeStatus: 'DRAFT', credits: 3 },
    { sectionId: 'section-b', sectionNumber: '02', courseCode: 'BA312', courseNameVi: 'Phân tích kinh doanh', courseNameEn: 'Business Analytics', semesterId: 'term-1', semester: 'HK1', semesterName: 'HK1', enrolledCount: 18, gradedCount: 9, publishedCount: 0, canPublish: false, gradeStatus: 'DRAFT', credits: 3 },
  ];
  const announcements = {
    data: [{ id: 'notice-1', title: 'Lịch thi học kỳ', content: '<p>Xem lịch thi mới.</p>', createdAt: '2026-11-01T08:00:00Z' }],
    meta: { total: 3 },
  };
  const idle = {
    error: null,
    warning: null,
    errorStatus: null,
    isLoading: false,
    isStale: false,
    reload: jest.fn(async () => {}),
    setData: jest.fn(),
  };
  return {
    useScreenQuery: (key: string) => {
      const empty = mockLecturerMode === 'empty';
      if (key === 'lecturer:schedule') return { ...idle, data: empty ? [] : schedule };
      if (key === 'lecturer:grading') return { ...idle, data: empty ? [] : grading };
      if (key === 'lecturer:announcements') return { ...idle, data: empty ? { data: [], meta: { total: 0 } } : announcements };
      if (key === 'lecturer:profile') return { ...idle, data: { id: 'user-1', firstName: 'Minh' } };
      if (key.startsWith('lecturer:grades:')) {
        const sectionId = key.slice('lecturer:grades:'.length);
        return {
          ...idle,
          data: {
            sectionId,
            rows: empty ? [] : [{
              enrollmentId: 'enr-1', studentId: 'st-1', studentCode: '2022SE0417', studentName: 'Nguyen Minh',
              processScore: 8, finalExamScore: 9, letterGrade: 'A', gradeStatus: 'DRAFT',
            }],
          },
        };
      }
      if (key.startsWith('lecturer:sheet:')) {
        const rest = key.slice('lecturer:sheet:'.length);
        const split = rest.lastIndexOf(':');
        return {
          ...idle,
          data: {
            sectionId: rest.slice(0, split),
            date: rest.slice(split + 1) || campusIsoDate(),
            roster: [{ studentId: 'st-1', studentCode: '2022SE0417', firstName: 'Minh', lastName: 'Nguyen' }],
            marks: [],
          },
        };
      }
      if (key.startsWith('lecturer:attendance-summary:')) return { ...idle, data: { attendanceRate: 80, totalSessions: 4 } };
      return { ...idle, data: undefined };
    },
  };
});

import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { LecturerDashboardScreen } from '../../src/screens/operations/LecturerDashboardScreen';
import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';
import { LecturerScheduleScreen } from '../../src/screens/operations/LecturerScheduleScreen';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'lecturer' } as MobileScreenProps;

afterEach(() => {
  cleanup();
  mockLecturerMode = 'full';
});

const renderScreen = (node: Parameters<typeof render>[0], locale: 'vi' | 'en' = 'vi') => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale={locale}>
      {node}
    </LocaleProvider>
  </ThemeProvider>,
);

test('the dashboard quick actions and empty descriptions use the web copy', async () => {
  mockLecturerMode = 'full';
  await renderScreen(<LecturerDashboardScreen {...props} />);
  expect(screen.getByRole('header', { name: 'Tác vụ nhanh' })).toBeOnTheScreen();
  expect(screen.getByText('Mở các công cụ giảng viên thường dẫn đến tác vụ tiếp theo trong ngày.')).toBeOnTheScreen();
  expect(screen.getByText('Kiểm tra phòng học, lớp học phần và thời gian dạy của học kỳ hiện tại.')).toBeOnTheScreen();
  expect(screen.getByText('Xử lý hàng chờ chấm điểm và đưa các lớp học phần đã sẵn sàng sang bước công bố.')).toBeOnTheScreen();
  expect(screen.getByText('Xem các cập nhật chung ảnh hưởng đến lớp học phần và ngày giảng dạy của bạn.')).toBeOnTheScreen();
  expect(screen.queryByText('Các lớp học phần giảng dạy luôn hiển thị để quyết định về lịch và chấm điểm vẫn bám theo đúng học kỳ.')).toBeNull();
  expect(screen.getByText('Các lớp gần bước rà soát cuối luôn ở đây để việc chấm điểm vẫn là ưu tiên chính.')).toBeOnTheScreen();
});

test('an empty lecturer dashboard uses the web empty descriptions', async () => {
  mockLecturerMode = 'empty';
  await renderScreen(<LecturerDashboardScreen {...props} />);
  expect(screen.getByText('Các lớp có trách nhiệm chấm điểm sẽ xuất hiện tại đây khi được mở.')).toBeOnTheScreen();
  expect(screen.getByText('Các lớp được giao sẽ xuất hiện tại đây ngay khi học kỳ hiện tại được thiết lập.')).toBeOnTheScreen();
  expect(screen.getByText('Các thông báo chung cho Cổng Giảng viên sẽ xuất hiện ở đây sau khi được đăng.')).toBeOnTheScreen();
});

test('the teaching schedule opens on the weekly grid with the web load stats', async () => {
  mockLecturerMode = 'full';
  await renderScreen(<LecturerScheduleScreen {...props} />);
  expect(screen.getByRole('tab', { name: 'Lưới tuần', selected: true })).toBeOnTheScreen();
  expect(screen.getByLabelText('Lớp học phần: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText('Buổi dạy / tuần: 3')).toBeOnTheScreen();
  expect(screen.getByLabelText('Tổng sinh viên: 34')).toBeOnTheScreen();
  expect(screen.getByText('Lịch dạy theo tuần')).toBeOnTheScreen();
  expect(screen.getByLabelText('Lưới thời khóa biểu')).toBeOnTheScreen();
  expect(screen.getByText('Thứ Hai')).toBeOnTheScreen();
  expect(screen.getByLabelText('CS204-01, Thứ Hai, 08:00–09:30, A2-204')).toBeOnTheScreen();
  expect(screen.getByText('BA312')).toBeOnTheScreen();
  expect(screen.getByText('In lịch giảng dạy')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('tab', { name: 'Danh sách' }));
  expect(screen.getByRole('header', { name: 'Danh sách lớp học phần giảng dạy' })).toBeOnTheScreen();
});

test('the English teaching schedule uses the web grid labels and load stats', async () => {
  mockLecturerMode = 'full';
  await renderScreen(<LecturerScheduleScreen {...props} />, 'en');
  expect(screen.getByRole('tab', { name: 'Weekly Grid', selected: true })).toBeOnTheScreen();
  expect(screen.getByLabelText('Classes: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText('Sessions / week: 3')).toBeOnTheScreen();
  expect(screen.getByLabelText('Students: 34')).toBeOnTheScreen();
  expect(screen.getByText('Monday')).toBeOnTheScreen();
});

test('an empty teaching schedule uses the web empty title and description', async () => {
  mockLecturerMode = 'empty';
  await renderScreen(<LecturerScheduleScreen {...props} />);
  expect(screen.getByText('Chưa có phân công giảng dạy')).toBeOnTheScreen();
  expect(screen.getByText('Khi lớp học phần được phân công, các buổi giảng dạy sẽ xuất hiện tại đây theo lịch tuần.')).toBeOnTheScreen();
});

test('attendance shows the web description, sheet title, reset and print actions', async () => {
  mockLecturerMode = 'full';
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  expect(screen.getByText('KHU VỰC GIẢNG DẠY')).toBeOnTheScreen();
  expect(screen.queryByText('Theo dõi và điểm danh chuyên cần sinh viên theo từng lớp học phần và ngày học.')).toBeNull();
  expect(screen.getByText('Bảng điểm danh lớp học phần')).toBeOnTheScreen();
  expect(screen.getByText('Đánh dấu tất cả có mặt')).toBeOnTheScreen();
  expect(screen.getByText('In bảng điểm danh')).toBeOnTheScreen();
  expect(screen.getByLabelText('Nguyen Minh (2022SE0417): Có mặt')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Đặt lại' }));
  expect(screen.getByRole('header', { name: 'Đặt lại toàn bộ trạng thái?' })).toBeOnTheScreen();
  expect(screen.getByText('Mọi trạng thái và ghi chú đã đánh trong danh sách sẽ bị xóa. Thao tác này không thể hoàn tác.')).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Đặt lại' })[0]);
  expect(screen.getByLabelText('Nguyen Minh (2022SE0417): Chưa điểm danh')).toBeOnTheScreen();
});

test('an empty attendance load uses the web no-section copy', async () => {
  mockLecturerMode = 'empty';
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  expect(screen.getByText('Chưa có lớp giảng dạy')).toBeOnTheScreen();
  expect(screen.getByText('Hiện tại bạn chưa được phân công phụ trách lớp học phần nào.')).toBeOnTheScreen();
});

test('grade management shows the queue stats, section counts and entry description', async () => {
  mockLecturerMode = 'full';
  await renderScreen(<LecturerGradingScreen {...props} />);
  expect(screen.getByText('Theo dõi tiến độ chấm điểm cho tất cả học kỳ, rồi đưa các lớp học phần đã sẵn sàng sang bước rà soát cuối.')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Hàng chờ quản lý điểm' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Lớp học phần: 2, Các trách nhiệm chấm điểm đang hoạt động được gom vào cùng một hàng chờ theo học kỳ đã chọn.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Điểm đã nhập: 25, Các bản ghi điểm đã nhập luôn hiện ra trước khi bạn chuyển lớp học phần sang bước công bố cuối.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Sẵn sàng công bố: 1, Các lớp học phần có thể đi sang bước rà soát cuối được làm nổi bật mà không thay đổi quy trình chấm điểm.')).toBeOnTheScreen();
  expect(screen.getByText('Các trách nhiệm chấm điểm đang hoạt động được gom vào cùng một hàng chờ theo học kỳ đã chọn.')).toBeOnTheScreen();
  expect(screen.getByText('Các bản ghi điểm đã nhập luôn hiện ra trước khi bạn chuyển lớp học phần sang bước công bố cuối.')).toBeOnTheScreen();
  expect(screen.getByText('Các lớp học phần có thể đi sang bước rà soát cuối được làm nổi bật mà không thay đổi quy trình chấm điểm.')).toBeOnTheScreen();
  expect(screen.getByText('3 tín chỉ')).toBeOnTheScreen();
  expect(screen.getByText('In bảng điểm')).toBeOnTheScreen();
  expect(screen.getByText('16 đăng ký · 16 đã chấm · 0 đã công bố')).toBeOnTheScreen();
  expect(screen.getByText('Ghi nhận điểm cho Kiến trúc phần mềm, rà soát hồ sơ sinh viên và chỉ công bố khi lớp học phần đã sẵn sàng.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Sinh viên: 1')).toBeOnTheScreen();
  expect(screen.getByLabelText('Bản ghi đã chấm: 1')).toBeOnTheScreen();
});

test('an empty grade queue uses the web empty copy', async () => {
  mockLecturerMode = 'empty';
  await renderScreen(<LecturerGradingScreen {...props} />);
  expect(screen.getByText('Chưa có lớp học phần cần chấm điểm')).toBeOnTheScreen();
  expect(screen.getByText('Các lớp có trách nhiệm chấm điểm sẽ xuất hiện tại đây khi phân công giảng dạy đã sẵn sàng.')).toBeOnTheScreen();
});
