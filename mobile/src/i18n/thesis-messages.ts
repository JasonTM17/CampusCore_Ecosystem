// Student thesis copy. Vietnamese is the default; every key exists in both locales.

import type { AppLocale } from './locale';

export interface ThesisCopy {
  topicsTitle: string;
  detailTitle: string;
  registrationTitle: string;
  progressTitle: string;
  roundTitle: string;
  advisorsTitle: string;

  tabTopics: string;
  tabRound: string;
  tabAdvisors: string;
  viewLabel: string;

  search: string;
  searchLabel: string;
  loadMore: string;
  loadingMore: string;
  loading: string;
  retry: string;
  refresh: string;
  cancel: string;
  remove: string;
  save: string;
  back: string;
  topicCount: string;

  roundPicker: string;
  roundChange: string;
  roundPickTitle: string;
  roundPickCurrent: string;
  noRounds: string;
  noRoundsBody: string;
  roundRegistration: string;
  roundReportDeadline: string;
  roundDefense: string;
  roundProposalPublish: string;
  roundType: string;

  emptyTopics: string;
  emptyTopicsFiltered: string;
  topicDepartment: string;
  topicGroupsMax: string;
  topicBrief: string;
  topicNotFound: string;
  openTopic: string;
  register: string;
  myGroup: string;
  supervisors: string;
  supervisorsEmpty: string;
  advisorsEmpty: string;
  advisorsBody: string;
  advisorTopics: string;
  advisorsCapped: string;
  advisorsLoadFailed: string;

  groupTitle: string;
  groupCreate: string;
  groupNone: string;
  groupRule: string;
  groupMembersCount: string;
  groupLeader: string;
  groupMember: string;
  groupRejectedReason: string;
  members: string;
  memberSearch: string;
  memberSearchHint: string;
  memberSearchEmpty: string;
  memberAdd: string;
  memberRemove: string;
  memberRemoveTitle: string;
  memberRemoveBody: string;
  memberSearching: string;
  topicStep: string;
  topicAssign: string;
  topicAssigned: string;
  topicChoose: string;
  topicChange: string;
  leaderOnly: string;
  windowClosed: string;
  stepGroup: string;
  stepMembers: string;
  stepTopic: string;
  saved: string;
  previewOnly: string;
  previewNotice: string;

  progressPercent: string;
  progressNoGroup: string;
  progressNoGroupBody: string;
  startRegistration: string;
  finalScore: string;
  askAssistant: string;
  askAssistantTopic: string;
  attention: Record<string, string>;
  milestones: Record<string, string>;
  milestoneCurrent: string;
  milestoneDone: string;
  milestonePending: string;

  report: string;
  reportNone: string;
  reportOnlyLeader: string;
  reportNeedsApproval: string;
  reportTitle: string;
  reportNote: string;
  reportUrl: string;
  reportUrlHint: string;
  reportOpenLink: string;
  reportFile: string;
  reportFileHint: string;
  reportPick: string;
  reportUpload: string;
  reportUploadCancel: string;
  reportUploading: string;
  reportDownload: string;
  reportDownloading: string;
  reportRemoveFile: string;
  reportRemoveFileTitle: string;
  reportRemoveFileBody: string;
  reportSubmit: string;
  reportUpdate: string;
  reportClearLink: string;
  reportSubmitted: string;
  reportUpdated: string;
  reportFileRemoved: string;
  reportFileSaved: string;
  reportFileUnavailable: string;
  reportFileFailed: string;
  reportPicked: string;
  reportSubmittedAt: string;
  reportDeadline: string;
  validation: {
    titleLong: string;
    noteLong: string;
    urlInvalid: string;
    artifactRequired: string;
    fileType: string;
    fileSize: string;
    fileEmpty: string;
  };

  status: Record<string, string>;
  errors: {
    generic: string;
    session: string;
    forbidden: string;
    offline: string;
    notFound: string;
    conflict: string;
    unavailable: string;
    codes: Record<string, string>;
  };
}

const vi: ThesisCopy = {
  topicsTitle: 'Đề tài khóa luận',
  detailTitle: 'Chi tiết đề tài',
  registrationTitle: 'Đăng ký khóa luận',
  progressTitle: 'Tiến độ khóa luận',
  roundTitle: 'Đợt khóa luận',
  advisorsTitle: 'Giảng viên hướng dẫn',

  tabTopics: 'Đề tài',
  tabRound: 'Đợt',
  tabAdvisors: 'Giảng viên',
  viewLabel: 'Nội dung hiển thị',

  search: 'Tìm đề tài',
  searchLabel: 'Tìm trong các đề tài đã tải',
  loadMore: 'Tải thêm',
  loadingMore: 'Đang tải thêm',
  loading: 'Đang tải',
  retry: 'Thử lại',
  refresh: 'Làm mới',
  cancel: 'Hủy',
  remove: 'Gỡ',
  save: 'Lưu',
  back: 'Quay lại',
  topicCount: '{count} đề tài',

  roundPicker: 'Đợt đang xem',
  roundChange: 'Đổi đợt',
  roundPickTitle: 'Chọn đợt',
  roundPickCurrent: 'Đang xem',
  noRounds: 'Chưa có đợt khóa luận',
  noRoundsBody: 'Đợt mới sẽ hiện ở đây khi khoa mở.',
  roundRegistration: 'Đăng ký',
  roundReportDeadline: 'Hạn nộp báo cáo',
  roundDefense: 'Bảo vệ',
  roundProposalPublish: 'Công bố đề tài',
  roundType: 'Loại',

  emptyTopics: 'Chưa có đề tài được công bố',
  emptyTopicsFiltered: 'Không có đề tài khớp',
  topicDepartment: 'Bộ môn',
  topicGroupsMax: 'Tối đa {count} nhóm',
  topicBrief: 'Mô tả',
  topicNotFound: 'Không tìm thấy đề tài',
  openTopic: 'Xem đề tài',
  register: 'Đăng ký đề tài',
  myGroup: 'Nhóm của tôi',
  supervisors: 'Giảng viên hướng dẫn',
  supervisorsEmpty: 'Chưa phân công giảng viên',
  advisorsEmpty: 'Chưa có giảng viên hướng dẫn',
  advisorsBody: 'Tổng hợp từ các đề tài đã công bố trong đợt.',
  advisorTopics: '{count} đề tài',
  advisorsCapped: 'Hiển thị tối đa {count} đề tài đầu tiên.',
  advisorsLoadFailed: 'Một số đề tài chưa tải được giảng viên.',

  groupTitle: 'Nhóm',
  groupCreate: 'Tạo nhóm',
  groupNone: 'Bạn chưa có nhóm trong đợt này',
  groupRule: 'Mỗi nhóm cần từ 3 đến 5 thành viên.',
  groupMembersCount: '{count} thành viên',
  groupLeader: 'Nhóm trưởng',
  groupMember: 'Thành viên',
  groupRejectedReason: 'Lý do từ chối',
  members: 'Thành viên',
  memberSearch: 'Mã hoặc tên sinh viên',
  memberSearchHint: 'Nhập ít nhất 2 ký tự',
  memberSearchEmpty: 'Không tìm thấy sinh viên',
  memberAdd: 'Thêm',
  memberRemove: 'Gỡ khỏi nhóm',
  memberRemoveTitle: 'Gỡ thành viên?',
  memberRemoveBody: 'Thành viên sẽ rời nhóm. Bạn có thể thêm lại sau.',
  memberSearching: 'Đang tìm',
  topicStep: 'Đề tài',
  topicAssign: 'Xác nhận đề tài',
  topicAssigned: 'Đã chọn đề tài',
  topicChoose: 'Chọn đề tài',
  topicChange: 'Đổi đề tài',
  leaderOnly: 'Chỉ nhóm trưởng thực hiện được.',
  windowClosed: 'Đợt chưa mở đăng ký.',
  stepGroup: 'Nhóm',
  stepMembers: 'Thành viên',
  stepTopic: 'Đề tài',
  saved: 'Đã lưu',
  previewOnly: 'Chỉ xem mẫu',
  previewNotice: 'Dữ liệu mẫu. Đăng nhập để đăng ký thật.',

  progressPercent: '{value}%',
  progressNoGroup: 'Bạn chưa tham gia đợt này',
  progressNoGroupBody: 'Tạo nhóm và chọn đề tài để bắt đầu.',
  startRegistration: 'Bắt đầu đăng ký',
  finalScore: 'Điểm cuối',
  askAssistant: 'Hỏi trợ lý luận văn',
  askAssistantTopic: 'Hỏi trợ lý về đề tài',
  attention: {
    NONE: '',
    NOT_PARTICIPATING: 'Bạn chưa tham gia đợt này.',
    GROUP_REJECTED: 'Nhóm bị từ chối. Xem lý do và chỉnh sửa nhóm.',
    GROUP_CANCELLED: 'Nhóm đã bị hủy.',
    GROUP_INVALID_MEMBER_COUNT: 'Số thành viên chưa hợp lệ. Cần từ 3 đến 5.',
    PROGRESS_INCONSISTENT: 'Tiến độ chưa nhất quán. Liên hệ khoa.',
    RESULT_NOT_AVAILABLE: 'Chưa có điểm cho đợt đã công bố.',
  },
  milestones: {
    ROUND_SELECTED: 'Chọn đợt',
    GROUP_CREATED: 'Lập nhóm',
    TOPIC_ASSIGNED: 'Chọn đề tài',
    GROUP_APPROVED: 'Nhóm được duyệt',
    REPORT_SUBMITTED: 'Nộp báo cáo',
    COUNCIL_ASSIGNED: 'Có hội đồng',
    SCORE_FINALIZED: 'Có điểm',
    RESULTS_PUBLISHED: 'Công bố kết quả',
  },
  milestoneCurrent: 'Hiện tại',
  milestoneDone: 'Xong',
  milestonePending: 'Chưa',

  report: 'Báo cáo',
  reportNone: 'Chưa nộp báo cáo',
  reportOnlyLeader: 'Chỉ nhóm trưởng nộp báo cáo.',
  reportNeedsApproval: 'Nộp được sau khi nhóm được duyệt.',
  reportTitle: 'Tiêu đề báo cáo',
  reportNote: 'Ghi chú',
  reportUrl: 'Liên kết báo cáo',
  reportUrlHint: 'Bắt đầu bằng http:// hoặc https://',
  reportOpenLink: 'Mở liên kết',
  reportFile: 'Tệp báo cáo',
  reportFileHint: 'PDF, DOC hoặc DOCX, tối đa 20 MB',
  reportPick: 'Chọn tệp',
  reportUpload: 'Tải tệp lên',
  reportUploadCancel: 'Hủy tải lên',
  reportUploading: 'Đang tải lên',
  reportDownload: 'Tải báo cáo',
  reportDownloading: 'Đang tải xuống',
  reportRemoveFile: 'Gỡ tệp',
  reportRemoveFileTitle: 'Gỡ tệp báo cáo?',
  reportRemoveFileBody: 'Liên kết báo cáo vẫn được giữ.',
  reportSubmit: 'Nộp báo cáo',
  reportUpdate: 'Lưu thay đổi',
  reportClearLink: 'Gỡ liên kết',
  reportSubmitted: 'Đã nộp báo cáo',
  reportUpdated: 'Đã cập nhật báo cáo',
  reportFileRemoved: 'Đã gỡ tệp',
  reportFileSaved: 'Đã lưu tệp',
  reportFileUnavailable: 'Thiết bị chưa hỗ trợ chọn tệp. Dùng liên kết báo cáo.',
  reportFileFailed: 'Không xử lý được tệp',
  reportPicked: 'Tệp đã chọn',
  reportSubmittedAt: 'Nộp lúc',
  reportDeadline: 'Hạn nộp',
  validation: {
    titleLong: 'Tiêu đề tối đa 240 ký tự.',
    noteLong: 'Ghi chú tối đa 500 ký tự.',
    urlInvalid: 'Liên kết phải bắt đầu bằng http:// hoặc https://.',
    artifactRequired: 'Nhập liên kết hoặc chọn tệp.',
    fileType: 'Chỉ nhận tệp PDF, DOC hoặc DOCX.',
    fileSize: 'Tệp tối đa 20 MB.',
    fileEmpty: 'Tệp rỗng.',
  },

  status: {
    DRAFT: 'Nháp',
    PROPOSAL_OPEN: 'Nhận đề xuất',
    PROPOSALS_PUBLISHED: 'Đã công bố đề tài',
    REGISTRATION_OPEN: 'Đang đăng ký',
    REGISTRATION_CLOSED: 'Đã đóng đăng ký',
    RESULTS_PUBLISHED: 'Đã công bố kết quả',
    CLOSED: 'Đã đóng',
    CANCELLED: 'Đã hủy',
    PUBLISHED: 'Đã công bố',
    APPROVED: 'Đã duyệt',
    REJECTED: 'Từ chối',
    ARCHIVED: 'Lưu trữ',
    ASSIGNED: 'Đã có đề tài',
    SUBMITTED: 'Đã nộp',
    COMPLETED: 'Hoàn thành',
    PENDING: 'Chờ duyệt',
  },
  errors: {
    generic: 'Không tải được dữ liệu khóa luận.',
    session: 'Phiên đã hết hạn. Đăng nhập lại.',
    forbidden: 'Bạn không có quyền xem nội dung này.',
    offline: 'Không có kết nối. Hiển thị dữ liệu đã lưu nếu có.',
    notFound: 'Không tìm thấy dữ liệu.',
    conflict: 'Dữ liệu đã thay đổi. Làm mới rồi thử lại.',
    unavailable: 'Dịch vụ tạm thời không khả dụng.',
    codes: {
      GROUP_TOO_SMALL: 'Nhóm cần ít nhất 3 thành viên.',
      GROUP_TOO_LARGE: 'Nhóm tối đa 5 thành viên.',
      GROUP_FULL: 'Nhóm đã đủ 5 thành viên.',
      STUDENT_ALREADY_IN_GROUP: 'Sinh viên đã ở trong nhóm này.',
      STUDENT_ACTIVE_IN_OTHER_GROUP: 'Sinh viên đang ở nhóm khác trong đợt này.',
      REGISTRATION_WINDOW_CLOSED: 'Đã hết thời gian đăng ký.',
      REGISTRATION_WINDOW_NOT_OPEN: 'Chưa đến thời gian đăng ký.',
      GROUP_OWNER_REQUIRED: 'Chỉ nhóm trưởng thực hiện được.',
      GROUP_MEMBER_REQUIRED: 'Bạn không thuộc nhóm này.',
      GROUP_STATE_CONFLICT: 'Trạng thái nhóm chưa cho phép thao tác này.',
      GROUP_APPROVAL_STATE_CONFLICT: 'Nhóm đã được xử lý duyệt.',
      LEADER_CANNOT_BE_REMOVED: 'Không thể gỡ nhóm trưởng.',
      MEMBER_NOT_FOUND: 'Không tìm thấy thành viên.',
      STUDENT_PROFILE_REQUIRED: 'Tài khoản chưa gắn hồ sơ sinh viên.',
      REPORT_DEADLINE_PASSED: 'Đã quá hạn nộp báo cáo.',
      REPORT_WINDOW_CLOSED: 'Đợt đã đóng nhận báo cáo.',
      REPORT_STORAGE_UNAVAILABLE: 'Kho lưu trữ tệp tạm thời không khả dụng.',
      REPORT_ARTIFACT_REQUIRED: 'Báo cáo cần có liên kết hoặc tệp.',
      FILE_REQUIRED: 'Chọn tệp báo cáo.',
      FILE_TOO_LARGE: 'Tệp tối đa 20 MB.',
      UNSUPPORTED_FILE_TYPE: 'Chỉ nhận tệp PDF, DOC hoặc DOCX.',
      INVALID_FILE_CONTENT: 'Nội dung tệp không khớp định dạng.',
      FILE_UNREADABLE: 'Không đọc được tệp.',
      VALIDATION_ERROR: 'Thông tin chưa hợp lệ.',
      ROUND_NOT_FOUND: 'Không tìm thấy đợt.',
      GROUP_NOT_FOUND: 'Không tìm thấy nhóm.',
    },
  },
};

const en: ThesisCopy = {
  topicsTitle: 'Thesis topics',
  detailTitle: 'Topic detail',
  registrationTitle: 'Thesis registration',
  progressTitle: 'Thesis progress',
  roundTitle: 'Thesis round',
  advisorsTitle: 'Advisors',

  tabTopics: 'Topics',
  tabRound: 'Round',
  tabAdvisors: 'Advisors',
  viewLabel: 'View',

  search: 'Search topics',
  searchLabel: 'Search the loaded topics',
  loadMore: 'Load more',
  loadingMore: 'Loading more',
  loading: 'Loading',
  retry: 'Retry',
  refresh: 'Refresh',
  cancel: 'Cancel',
  remove: 'Remove',
  save: 'Save',
  back: 'Back',
  topicCount: '{count} topics',

  roundPicker: 'Round',
  roundChange: 'Change round',
  roundPickTitle: 'Choose a round',
  roundPickCurrent: 'Viewing',
  noRounds: 'No thesis rounds yet',
  noRoundsBody: 'New rounds appear here once the faculty opens them.',
  roundRegistration: 'Registration',
  roundReportDeadline: 'Report deadline',
  roundDefense: 'Defense',
  roundProposalPublish: 'Topics published',
  roundType: 'Type',

  emptyTopics: 'No published topics',
  emptyTopicsFiltered: 'No matching topics',
  topicDepartment: 'Department',
  topicGroupsMax: 'Up to {count} groups',
  topicBrief: 'Brief',
  topicNotFound: 'Topic not found',
  openTopic: 'View topic',
  register: 'Register for this topic',
  myGroup: 'My group',
  supervisors: 'Advisors',
  supervisorsEmpty: 'No advisor assigned yet',
  advisorsEmpty: 'No advisors yet',
  advisorsBody: 'Collected from the topics published in this round.',
  advisorTopics: '{count} topics',
  advisorsCapped: 'Showing the first {count} topics only.',
  advisorsLoadFailed: 'Advisors could not be loaded for some topics.',

  groupTitle: 'Group',
  groupCreate: 'Create group',
  groupNone: 'You have no group in this round',
  groupRule: 'A group needs 3 to 5 members.',
  groupMembersCount: '{count} members',
  groupLeader: 'Leader',
  groupMember: 'Member',
  groupRejectedReason: 'Reason for rejection',
  members: 'Members',
  memberSearch: 'Student ID or name',
  memberSearchHint: 'Type at least 2 characters',
  memberSearchEmpty: 'No student found',
  memberAdd: 'Add',
  memberRemove: 'Remove from group',
  memberRemoveTitle: 'Remove member?',
  memberRemoveBody: 'The member leaves the group. You can add them again later.',
  memberSearching: 'Searching',
  topicStep: 'Topic',
  topicAssign: 'Confirm topic',
  topicAssigned: 'Topic selected',
  topicChoose: 'Choose a topic',
  topicChange: 'Change topic',
  leaderOnly: 'Only the group leader can do this.',
  windowClosed: 'Registration is not open for this round.',
  stepGroup: 'Group',
  stepMembers: 'Members',
  stepTopic: 'Topic',
  saved: 'Saved',
  previewOnly: 'Preview only',
  previewNotice: 'Sample data. Sign in to register for real.',

  progressPercent: '{value}%',
  progressNoGroup: 'You are not in this round',
  progressNoGroupBody: 'Create a group and choose a topic to begin.',
  startRegistration: 'Start registration',
  finalScore: 'Final score',
  askAssistant: 'Ask the thesis assistant',
  askAssistantTopic: 'Ask the assistant about this topic',
  attention: {
    NONE: '',
    NOT_PARTICIPATING: 'You are not in this round.',
    GROUP_REJECTED: 'The group was rejected. Review the reason and edit the group.',
    GROUP_CANCELLED: 'The group was cancelled.',
    GROUP_INVALID_MEMBER_COUNT: 'The member count is not valid. 3 to 5 are required.',
    PROGRESS_INCONSISTENT: 'Progress is inconsistent. Contact the faculty.',
    RESULT_NOT_AVAILABLE: 'No score is available for the published round.',
  },
  milestones: {
    ROUND_SELECTED: 'Round chosen',
    GROUP_CREATED: 'Group formed',
    TOPIC_ASSIGNED: 'Topic chosen',
    GROUP_APPROVED: 'Group approved',
    REPORT_SUBMITTED: 'Report submitted',
    COUNCIL_ASSIGNED: 'Council assigned',
    SCORE_FINALIZED: 'Score final',
    RESULTS_PUBLISHED: 'Results published',
  },
  milestoneCurrent: 'Current',
  milestoneDone: 'Done',
  milestonePending: 'Pending',

  report: 'Report',
  reportNone: 'No report submitted',
  reportOnlyLeader: 'Only the group leader submits the report.',
  reportNeedsApproval: 'Available once the group is approved.',
  reportTitle: 'Report title',
  reportNote: 'Note',
  reportUrl: 'Report link',
  reportUrlHint: 'Starts with http:// or https://',
  reportOpenLink: 'Open link',
  reportFile: 'Report file',
  reportFileHint: 'PDF, DOC or DOCX, up to 20 MB',
  reportPick: 'Choose file',
  reportUpload: 'Upload file',
  reportUploadCancel: 'Cancel upload',
  reportUploading: 'Uploading',
  reportDownload: 'Download report',
  reportDownloading: 'Downloading',
  reportRemoveFile: 'Remove file',
  reportRemoveFileTitle: 'Remove the report file?',
  reportRemoveFileBody: 'The report link is kept.',
  reportSubmit: 'Submit report',
  reportUpdate: 'Save changes',
  reportClearLink: 'Remove link',
  reportSubmitted: 'Report submitted',
  reportUpdated: 'Report updated',
  reportFileRemoved: 'File removed',
  reportFileSaved: 'File saved',
  reportFileUnavailable: 'This device cannot pick files yet. Use a report link.',
  reportFileFailed: 'The file could not be processed',
  reportPicked: 'Selected file',
  reportSubmittedAt: 'Submitted',
  reportDeadline: 'Deadline',
  validation: {
    titleLong: 'The title is limited to 240 characters.',
    noteLong: 'The note is limited to 500 characters.',
    urlInvalid: 'The link must start with http:// or https://.',
    artifactRequired: 'Enter a link or choose a file.',
    fileType: 'Only PDF, DOC or DOCX files are accepted.',
    fileSize: 'The file is limited to 20 MB.',
    fileEmpty: 'The file is empty.',
  },

  status: {
    DRAFT: 'Draft',
    PROPOSAL_OPEN: 'Accepting proposals',
    PROPOSALS_PUBLISHED: 'Topics published',
    REGISTRATION_OPEN: 'Registration open',
    REGISTRATION_CLOSED: 'Registration closed',
    RESULTS_PUBLISHED: 'Results published',
    CLOSED: 'Closed',
    CANCELLED: 'Cancelled',
    PUBLISHED: 'Published',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    ARCHIVED: 'Archived',
    ASSIGNED: 'Topic assigned',
    SUBMITTED: 'Submitted',
    COMPLETED: 'Completed',
    PENDING: 'Pending approval',
  },
  errors: {
    generic: 'Thesis data could not be loaded.',
    session: 'Your session expired. Sign in again.',
    forbidden: 'You do not have access to this content.',
    offline: 'You are offline. Saved data is shown when available.',
    notFound: 'Nothing found.',
    conflict: 'The data changed. Refresh and try again.',
    unavailable: 'The service is temporarily unavailable.',
    codes: {
      GROUP_TOO_SMALL: 'A group needs at least 3 members.',
      GROUP_TOO_LARGE: 'A group has at most 5 members.',
      GROUP_FULL: 'The group already has 5 members.',
      STUDENT_ALREADY_IN_GROUP: 'This student is already in the group.',
      STUDENT_ACTIVE_IN_OTHER_GROUP: 'This student is in another group this round.',
      REGISTRATION_WINDOW_CLOSED: 'Registration has closed.',
      REGISTRATION_WINDOW_NOT_OPEN: 'Registration has not opened yet.',
      GROUP_OWNER_REQUIRED: 'Only the group leader can do this.',
      GROUP_MEMBER_REQUIRED: 'You are not in this group.',
      GROUP_STATE_CONFLICT: 'The group state does not allow this action.',
      GROUP_APPROVAL_STATE_CONFLICT: 'The group approval was already decided.',
      LEADER_CANNOT_BE_REMOVED: 'The leader cannot be removed.',
      MEMBER_NOT_FOUND: 'Member not found.',
      STUDENT_PROFILE_REQUIRED: 'This account has no student profile.',
      REPORT_DEADLINE_PASSED: 'The report deadline has passed.',
      REPORT_WINDOW_CLOSED: 'The round no longer accepts reports.',
      REPORT_STORAGE_UNAVAILABLE: 'File storage is temporarily unavailable.',
      REPORT_ARTIFACT_REQUIRED: 'The report needs a link or a file.',
      FILE_REQUIRED: 'Choose the report file.',
      FILE_TOO_LARGE: 'The file is limited to 20 MB.',
      UNSUPPORTED_FILE_TYPE: 'Only PDF, DOC or DOCX files are accepted.',
      INVALID_FILE_CONTENT: 'The file content does not match its format.',
      FILE_UNREADABLE: 'The file could not be read.',
      VALIDATION_ERROR: 'Some details are not valid.',
      ROUND_NOT_FOUND: 'Round not found.',
      GROUP_NOT_FOUND: 'Group not found.',
    },
  },
};

export const thesisMessages: Record<AppLocale, ThesisCopy> = { vi, en };

export function fillThesisCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
