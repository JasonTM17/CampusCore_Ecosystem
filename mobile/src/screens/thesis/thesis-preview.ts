// Fixed sample data for preview mode. Preview never calls the network and never
// mutates; the screens disable every write while it is active.

import type { AppLocale } from '../../i18n/locale';
import type {
  ThesisGroup,
  ThesisProgress,
  ThesisReport,
  ThesisRound,
  ThesisSupervisor,
  ThesisTopic,
} from './thesis-model';

const ROUND_ID = 'preview-round';

export interface ThesisPreview {
  rounds: ThesisRound[];
  topics: ThesisTopic[];
  supervisors: Record<string, ThesisSupervisor[]>;
  group: ThesisGroup;
  progress: ThesisProgress;
  report: ThesisReport | null;
}

const copy = {
  vi: {
    round: 'Khóa luận tốt nghiệp đợt 1',
    topics: [
      ['Trợ lý học vụ có kiểm chứng nguồn', 'Xây dựng trợ lý trả lời quy chế và hướng dẫn học vụ, mọi câu trả lời kèm nguồn trích dẫn.'],
      ['Phân tích dữ liệu điểm danh theo học phần', 'Thu thập và trực quan hóa tỷ lệ điểm danh để sớm phát hiện sinh viên có nguy cơ.'],
      ['Ứng dụng di động tra cứu thư viện', 'Tìm tài liệu, đặt mượn và nhận nhắc hạn trả trên điện thoại.'],
    ],
    leader: 'Nguyễn Minh An',
    members: ['Trần Quốc Bảo', 'Lê Thu Hà'],
    advisors: [['Phạm', 'Hoàng Nam'], ['Võ', 'Thị Lan']],
  },
  en: {
    round: 'Graduation thesis round 1',
    topics: [
      ['Source-verified academic assistant', 'Build an assistant that answers regulations and guidance, every answer citing its sources.'],
      ['Attendance analytics by course section', 'Collect and chart attendance rates to spot at-risk students early.'],
      ['Mobile library lookup app', 'Search titles, reserve copies and get due-date reminders on a phone.'],
    ],
    leader: 'An Nguyen Minh',
    members: ['Bao Tran Quoc', 'Ha Le Thu'],
    advisors: [['Pham', 'Nam Hoang'], ['Vo', 'Lan Thi']],
  },
} as const;

export function thesisPreview(locale: AppLocale): ThesisPreview {
  const text = copy[locale];
  const topics: ThesisTopic[] = text.topics.map(([title, description], index) => ({
    id: `preview-topic-${index + 1}`,
    roundId: ROUND_ID,
    departmentId: index === 2 ? 'KTPM' : 'CNTT',
    title,
    description,
    maxGroups: 3,
    status: 'PUBLISHED',
  }));
  const supervisors: Record<string, ThesisSupervisor[]> = {};
  topics.forEach((topic, index) => {
    const [lastName, firstName] = text.advisors[index % text.advisors.length];
    supervisors[topic.id] = [{ lecturerId: `preview-lecturer-${(index % 2) + 1}`, supervisorOrder: 1, firstName, lastName, email: null }];
  });
  const group: ThesisGroup = {
    id: 'preview-group',
    roundId: ROUND_ID,
    leaderStudentId: 'preview-student-1',
    topicId: topics[0].id,
    status: 'ASSIGNED',
    approvalStatus: 'PENDING',
    memberStudentIds: ['preview-student-1', 'preview-student-2', 'preview-student-3'],
    members: [
      { studentId: 'preview-student-1', displayName: text.leader, isLeader: true, memberOrder: 1 },
      { studentId: 'preview-student-2', displayName: text.members[0], isLeader: false, memberOrder: 2 },
      { studentId: 'preview-student-3', displayName: text.members[1], isLeader: false, memberOrder: 3 },
    ],
  };
  return {
    rounds: [{
      id: ROUND_ID,
      name: text.round,
      status: 'REGISTRATION_OPEN',
      registrationStart: '2026-08-25T00:00:00Z',
      registrationEnd: '2026-09-30T23:59:59Z',
      thesisType: 'KLTN',
      reportDeadline: '2026-12-15T23:59:59Z',
      proposalPublishAt: '2026-08-20T00:00:00Z',
      defenseDate: '2027-01-20T00:00:00Z',
    }],
    topics,
    supervisors,
    group,
    progress: {
      roundId: ROUND_ID,
      roundStatus: 'REGISTRATION_OPEN',
      participationState: 'PARTICIPATING',
      currentMilestone: 'GROUP_APPROVED',
      completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED'],
      attentionState: 'NONE',
      groupId: group.id,
      groupStatus: group.status,
      approvalStatus: group.approvalStatus,
      memberCount: group.memberStudentIds.length,
      topicId: topics[0].id,
      topicTitle: topics[0].title,
    },
    report: null,
  };
}
