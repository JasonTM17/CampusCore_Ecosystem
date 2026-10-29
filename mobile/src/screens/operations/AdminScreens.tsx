import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  FilterChip,
  IconChip,
  ListRow,
  ScreenShell,
  ScreenSpacer,
  SectionCard,
  SectionHeading,
  Sheet,
  SheetHeader,
  StatStrip,
  StatusPill,
  UiText,
} from '../../components/Ui';
import { SearchBar } from '../../components/ui/primitives';
import type { MobileScreenProps } from '../../navigation/types';
import { LaneEntries } from '../lanes/LaneEntries';
import { HandoffButton } from './lecturer-ui';
import { useOpsCopy, WebOnlyPanel } from './shared/helpers';
import { useOpsStyles } from './shared/styles';

interface StudentDirectoryItem {
  id: string;
  studentCode: string;
  name: string;
  email: string;
  department: string;
  major: string;
  cohort: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'GRADUATED';
  gpa: number;
}

const SAMPLE_STUDENTS: StudentDirectoryItem[] = [
  {
    id: 'st-1',
    studentCode: '2022SE0417',
    name: 'Nguyễn Đức Minh',
    email: 'minh.nguyen@ute.edu.vn',
    department: 'Công nghệ thông tin',
    major: 'Kỹ thuật phần mềm',
    cohort: 'K22',
    status: 'ACTIVE',
    gpa: 3.52,
  },
  {
    id: 'st-2',
    studentCode: '2023BA0192',
    name: 'Phạm Anh Thư',
    email: 'thu.pham@ute.edu.vn',
    department: 'Kinh tế',
    major: 'Quản trị kinh doanh',
    cohort: 'K23',
    status: 'ACTIVE',
    gpa: 3.68,
  },
  {
    id: 'st-3',
    studentCode: '2024IT0871',
    name: 'Lê Khánh Vy',
    email: 'vy.le@ute.edu.vn',
    department: 'Công nghệ thông tin',
    major: 'Khoa học máy tính',
    cohort: 'K24',
    status: 'ACTIVE',
    gpa: 3.4,
  },
  {
    id: 'st-4',
    studentCode: '2021EE0115',
    name: 'Trần Hoàng Nam',
    email: 'nam.tran@ute.edu.vn',
    department: 'Điện - Điện tử',
    major: 'Kỹ thuật điều khiển & TĐH',
    cohort: 'K21',
    status: 'GRADUATED',
    gpa: 3.25,
  },
  {
    id: 'st-5',
    studentCode: '2022ME0304',
    name: 'Đỗ Quang Huy',
    email: 'huy.do@ute.edu.vn',
    department: 'Cơ khí',
    major: 'Kỹ thuật cơ điện tử',
    cohort: 'K22',
    status: 'SUSPENDED',
    gpa: 2.9,
  },
];

interface LecturerDirectoryItem {
  id: string;
  lecturerCode: string;
  title: string;
  name: string;
  department: string;
  email: string;
  phone: string;
  status: 'AVAILABLE' | 'FULL';
  groupsCount: number;
  studentsCount: number;
  maxStudents: number;
  researchAreas: string;
}

const SAMPLE_LECTURERS: LecturerDirectoryItem[] = [
  {
    id: 'gv-1',
    lecturerCode: 'GV001',
    title: 'PGS. TS.',
    name: 'Nguyễn Văn A',
    department: 'Khoa Công nghệ Thông tin',
    email: 'nva@hcmute.edu.vn',
    phone: '028 3722 1223',
    status: 'AVAILABLE',
    groupsCount: 5,
    studentsCount: 12,
    maxStudents: 20,
    researchAreas: 'Trí tuệ nhân tạo, Thị giác máy tính',
  },
  {
    id: 'gv-2',
    lecturerCode: 'GV002',
    title: 'TS.',
    name: 'Trần Thị B',
    department: 'Hệ thống Thông tin',
    email: 'ttb@hcmute.edu.vn',
    phone: '028 3722 1224',
    status: 'AVAILABLE',
    groupsCount: 8,
    studentsCount: 18,
    maxStudents: 20,
    researchAreas: 'Khai phá dữ liệu, Hệ thống thông tin',
  },
  {
    id: 'gv-3',
    lecturerCode: 'GV003',
    title: 'PGS. TS.',
    name: 'Lê Hoàng C',
    department: 'Khoa Điện - Điện tử',
    email: 'lhc@hcmute.edu.vn',
    phone: '028 3722 1225',
    status: 'FULL',
    groupsCount: 10,
    studentsCount: 20,
    maxStudents: 20,
    researchAreas: 'Hệ thống nhúng, IoT công nghiệp',
  },
  {
    id: 'gv-4',
    lecturerCode: 'GV004',
    title: 'ThS.',
    name: 'Vũ Đình D',
    department: 'Kỹ thuật Phần mềm',
    email: 'vdd@hcmute.edu.vn',
    phone: '028 3722 1226',
    status: 'AVAILABLE',
    groupsCount: 4,
    studentsCount: 10,
    maxStudents: 15,
    researchAreas: 'Kiến trúc phần mềm, DevOps & Cloud',
  },
];

const initialsOf = (fullName: string): string =>
  fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export function AdminDashboardScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy } = useOpsCopy();

  return (
    <WebOnlyPanel title={copy.adminDashboardTitle} path="/admin">
      <StatStrip
        style={styles.stats}
        items={[
          { icon: 'school-outline', label: copy.adminStudentsTitle, value: '18,420' },
          { icon: 'account-tie-outline', label: copy.adminLecturersTitle, value: '940' },
          { icon: 'book-open-page-variant-outline', label: copy.metricSections, value: '1,250' },
        ]}
      />

      <SectionCard icon="folder-account-outline" title={copy.shortcutsTitle}>
        <ListRow
          icon="school-outline"
          title={copy.adminStudentsTitle}
          subtitle="18,420 sinh viên · Tra cứu & hồ sơ"
          onPress={() => navigation.navigate('admin.students')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <ListRow
          icon="account-tie-outline"
          title={copy.adminLecturersTitle}
          subtitle="940 giảng viên · Danh bạ & phân công"
          onPress={() => navigation.navigate('admin.lecturers')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
      </SectionCard>

      <ScreenSpacer />
      <LaneEntries groups={['admin', 'staff']} navigation={navigation} />

      <ScreenSpacer />
      <SectionHeading title={copy.handoffTitle} />
      <HandoffButton label={copy.openOnWeb} path="/admin" />
    </WebOnlyPanel>
  );
}

export function AdminStudentsScreen() {
  const styles = useOpsStyles();
  const { copy } = useOpsCopy();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedStudent, setSelectedStudent] = useState<StudentDirectoryItem | null>(null);

  const needle = search.trim().toLowerCase();
  const filtered = SAMPLE_STUDENTS.filter((item) => {
    const matchesSearch =
      needle === '' ||
      item.name.toLowerCase().includes(needle) ||
      item.studentCode.toLowerCase().includes(needle) ||
      item.email.toLowerCase().includes(needle) ||
      item.department.toLowerCase().includes(needle);
    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <WebOnlyPanel title={copy.adminStudentsTitle} path="/admin/users"
      list={{ data: filtered, keyExtractor: (item, index) => String(item.id),
        renderItem: ({ item: student }) => (
          <Card key={student.id} style={styles.rosterCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${student.name}, ${student.studentCode}`}
              onPress={() => setSelectedStudent(student)}
              style={styles.directoryRow}
            >
              <View style={styles.avatar}>
                <UiText style={styles.avatarText}>{initialsOf(student.name)}</UiText>
              </View>
              <View style={styles.directoryCopy}>
                <View style={styles.directoryTop}>
                  <UiText variant="label">{student.name}</UiText>
                  <StatusPill
                    label={
                      student.status === 'ACTIVE'
                        ? copy.filterActive
                        : student.status === 'SUSPENDED'
                        ? copy.filterSuspended
                        : copy.filterGraduated
                    }
                    tone={
                      student.status === 'ACTIVE'
                        ? 'success'
                        : student.status === 'SUSPENDED'
                        ? 'warning'
                        : 'neutral'
                    }
                  />
                </View>
                <UiText variant="bodySmall" tone="muted">
                  {`${student.studentCode} · ${student.department}`}
                </UiText>
              </View>
            </Pressable>
          </Card>
        ),
        footer: <><View style={styles.stack}>
      </View>

      <ScreenSpacer />
      <HandoffButton label={copy.openOnWeb} path="/admin/users" />

      {selectedStudent ? (
        <Sheet
          visible={Boolean(selectedStudent)}
          onClose={() => setSelectedStudent(null)}
          title={copy.studentDetail}
        >
          <SheetHeader
            title={selectedStudent.name}
            subtitle={`${selectedStudent.studentCode} · ${selectedStudent.cohort}`}
            closeLabel={copy.close}
            onClose={() => setSelectedStudent(null)}
          />
          <View style={styles.sheetBody}>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.studentId}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedStudent.studentCode}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.email}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedStudent.email}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.department}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedStudent.department}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.major}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedStudent.major}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.status}</UiText>
              <StatusPill
                label={
                  selectedStudent.status === 'ACTIVE'
                    ? copy.filterActive
                    : selectedStudent.status === 'SUSPENDED'
                    ? copy.filterSuspended
                    : copy.filterGraduated
                }
                tone={
                  selectedStudent.status === 'ACTIVE'
                    ? 'success'
                    : selectedStudent.status === 'SUSPENDED'
                    ? 'warning'
                    : 'neutral'
                }
              />
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>GPA</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedStudent.gpa.toFixed(2)}</UiText>
            </View>
            <Button
              icon="open-in-new"
              label={copy.openOnWeb}
              variant="secondary"
              onPress={() => setSelectedStudent(null)}
            />
          </View>
        </Sheet>
      ) : null}
    </>,
      }}
    >
      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder={copy.searchStudents}
        accessibilityLabel={copy.searchStudents}
        style={styles.searchBar}
      />

      <View style={styles.filterChipsRow}>
        <FilterChip
          label={copy.filterAll}
          selected={statusFilter === 'ALL'}
          onPress={() => setStatusFilter('ALL')}
        />
        <FilterChip
          label={copy.filterActive}
          selected={statusFilter === 'ACTIVE'}
          onPress={() => setStatusFilter('ACTIVE')}
        />
        <FilterChip
          label={copy.filterSuspended}
          selected={statusFilter === 'SUSPENDED'}
          onPress={() => setStatusFilter('SUSPENDED')}
        />
        <FilterChip
          label={copy.filterGraduated}
          selected={statusFilter === 'GRADUATED'}
          onPress={() => setStatusFilter('GRADUATED')}
        />
      </View>

      <View style={styles.stack}>
        </View></WebOnlyPanel>
  );
}

export function AdminLecturersScreen() {
  const styles = useOpsStyles();
  const { copy } = useOpsCopy();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE'>('ALL');
  const [selectedLecturer, setSelectedLecturer] = useState<LecturerDirectoryItem | null>(null);

  const needle = search.trim().toLowerCase();
  const filtered = SAMPLE_LECTURERS.filter((item) => {
    const matchesSearch =
      needle === '' ||
      item.name.toLowerCase().includes(needle) ||
      item.department.toLowerCase().includes(needle) ||
      item.email.toLowerCase().includes(needle);
    const matchesFilter = filter === 'ALL' || item.status === 'AVAILABLE';
    return matchesSearch && matchesFilter;
  });

  return (
    <WebOnlyPanel title={copy.adminLecturersTitle} path="/admin/lecturers"
      list={{ data: filtered, keyExtractor: (item, index) => String(item.id),
        renderItem: ({ item: lecturer }) => (
          <Card key={lecturer.id} style={styles.scheduleCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${lecturer.title} ${lecturer.name}, ${lecturer.department}`}
              onPress={() => setSelectedLecturer(lecturer)}
              style={styles.directoryRow}
            >
              <View style={styles.avatar}>
                <UiText style={styles.avatarText}>{initialsOf(lecturer.name)}</UiText>
              </View>
              <View style={styles.directoryCopy}>
                <View style={styles.directoryTop}>
                  <UiText variant="label">{`${lecturer.title} ${lecturer.name}`}</UiText>
                  <StatusPill
                    label={lecturer.status === 'AVAILABLE' ? copy.filterAvailable : 'Đủ chỉ tiêu'}
                    tone={lecturer.status === 'AVAILABLE' ? 'success' : 'warning'}
                  />
                </View>
                <UiText variant="bodySmall" tone="muted">
                  {lecturer.department}
                </UiText>
                <View style={styles.slotRow}>
                  <IconChip icon="account-group-outline" size={32} tone="neutral" />
                  <UiText variant="bodySmall" tone="muted" style={{ flex: 1 }}>
                    {`${copy.supervising}: ${lecturer.groupsCount} nhóm · ${lecturer.studentsCount}/${lecturer.maxStudents} SV`}
                  </UiText>
                </View>
              </View>
            </Pressable>
          </Card>
        ),
        footer: <><View style={styles.stack}>
      </View>

      <ScreenSpacer />
      <HandoffButton label={copy.openOnWeb} path="/admin/lecturers" />

      {selectedLecturer ? (
        <Sheet
          visible={Boolean(selectedLecturer)}
          onClose={() => setSelectedLecturer(null)}
          title={copy.lecturerDetail}
        >
          <SheetHeader
            title={`${selectedLecturer.title} ${selectedLecturer.name}`}
            subtitle={selectedLecturer.department}
            closeLabel={copy.close}
            onClose={() => setSelectedLecturer(null)}
          />
          <View style={styles.sheetBody}>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.lecturerId}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedLecturer.lecturerCode}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.email}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedLecturer.email}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.phone}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedLecturer.phone}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.department}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedLecturer.department}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.supervising}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>
                {`${selectedLecturer.groupsCount} nhóm · ${selectedLecturer.studentsCount}/${selectedLecturer.maxStudents} SV`}
              </UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>Nghiên cứu</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedLecturer.researchAreas}</UiText>
            </View>
            <Button
              icon="open-in-new"
              label={copy.openOnWeb}
              variant="secondary"
              onPress={() => setSelectedLecturer(null)}
            />
          </View>
        </Sheet>
      ) : null}
    </>,
      }}
    >
      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder={copy.searchSections}
        accessibilityLabel={copy.searchSections}
        style={styles.searchBar}
      />

      <View style={styles.filterChipsRow}>
        <FilterChip
          label={copy.filterAll}
          selected={filter === 'ALL'}
          onPress={() => setFilter('ALL')}
        />
        <FilterChip
          label={copy.filterAvailable}
          selected={filter === 'AVAILABLE'}
          onPress={() => setFilter('AVAILABLE')}
        />
      </View>

      <View style={styles.stack}>
        </View></WebOnlyPanel>
  );
}
