import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Card,
  DataNotice,
  Divider,
  FilterChip,
  IconChip,
  ListRow,
  ScreenSpacer,
  SectionCard,
  SectionHeading,
  Sheet,
  SheetHeader,
  StatStrip,
  StatePanel,
  StatusPill,
  UiText,
} from '../../components/Ui';
import { Avatar } from '../../components/ui/avatar';
import { SearchBar } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
import type { AppLocale } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import { useTheme } from '../../design/theme';
import type { MobileScreenProps } from '../../navigation/types';
import { LaneEntries } from '../lanes/LaneEntries';
import { HandoffButton, isOpsPreview } from './lecturer-ui';
import { normalizeOperationsSearch } from './lecturer-model';
import { useOpsCopy, WebOnlyPanel } from './shared/helpers';
import { useOpsStyles } from './shared/styles';

type LocalizedPreviewValue = Record<AppLocale, string>;

interface StudentDirectoryItem {
  id: string;
  studentCode: string;
  name: string;
  email: string;
  department: LocalizedPreviewValue;
  major: LocalizedPreviewValue;
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
    department: { vi: 'Công nghệ thông tin', en: 'Information Technology' },
    major: { vi: 'Kỹ thuật phần mềm', en: 'Software Engineering' },
    cohort: 'K22',
    status: 'ACTIVE',
    gpa: 3.52,
  },
  {
    id: 'st-2',
    studentCode: '2023BA0192',
    name: 'Phạm Anh Thư',
    email: 'thu.pham@ute.edu.vn',
    department: { vi: 'Kinh tế', en: 'Economics' },
    major: { vi: 'Quản trị kinh doanh', en: 'Business Administration' },
    cohort: 'K23',
    status: 'ACTIVE',
    gpa: 3.68,
  },
  {
    id: 'st-3',
    studentCode: '2024IT0871',
    name: 'Lê Khánh Vy',
    email: 'vy.le@ute.edu.vn',
    department: { vi: 'Công nghệ thông tin', en: 'Information Technology' },
    major: { vi: 'Khoa học máy tính', en: 'Computer Science' },
    cohort: 'K24',
    status: 'ACTIVE',
    gpa: 3.4,
  },
  {
    id: 'st-4',
    studentCode: '2021EE0115',
    name: 'Trần Hoàng Nam',
    email: 'nam.tran@ute.edu.vn',
    department: { vi: 'Điện - Điện tử', en: 'Electrical and Electronics Engineering' },
    major: { vi: 'Kỹ thuật điều khiển & TĐH', en: 'Control Engineering and Automation' },
    cohort: 'K21',
    status: 'GRADUATED',
    gpa: 3.25,
  },
  {
    id: 'st-5',
    studentCode: '2022ME0304',
    name: 'Đỗ Quang Huy',
    email: 'huy.do@ute.edu.vn',
    department: { vi: 'Cơ khí', en: 'Mechanical Engineering' },
    major: { vi: 'Kỹ thuật cơ điện tử', en: 'Mechatronics Engineering' },
    cohort: 'K22',
    status: 'SUSPENDED',
    gpa: 2.9,
  },
];

interface LecturerDirectoryItem {
  id: string;
  lecturerCode: string;
  title: LocalizedPreviewValue;
  name: string;
  department: LocalizedPreviewValue;
  email: string;
  phone: string;
  status: 'AVAILABLE' | 'FULL';
  groupsCount: number;
  studentsCount: number;
  maxStudents: number;
  researchAreas: LocalizedPreviewValue;
}

const SAMPLE_LECTURERS: LecturerDirectoryItem[] = [
  {
    id: 'gv-1',
    lecturerCode: 'GV001',
    title: { vi: 'PGS. TS.', en: 'Assoc. Prof., PhD' },
    name: 'Nguyễn Văn A',
    department: { vi: 'Khoa Công nghệ Thông tin', en: 'Faculty of Information Technology' },
    email: 'nva@hcmute.edu.vn',
    phone: '028 3722 1223',
    status: 'AVAILABLE',
    groupsCount: 5,
    studentsCount: 12,
    maxStudents: 20,
    researchAreas: { vi: 'Trí tuệ nhân tạo, Thị giác máy tính', en: 'Artificial Intelligence, Computer Vision' },
  },
  {
    id: 'gv-2',
    lecturerCode: 'GV002',
    title: { vi: 'TS.', en: 'PhD' },
    name: 'Trần Thị B',
    department: { vi: 'Hệ thống Thông tin', en: 'Information Systems' },
    email: 'ttb@hcmute.edu.vn',
    phone: '028 3722 1224',
    status: 'AVAILABLE',
    groupsCount: 8,
    studentsCount: 18,
    maxStudents: 20,
    researchAreas: { vi: 'Khai phá dữ liệu, Hệ thống thông tin', en: 'Data Mining, Information Systems' },
  },
  {
    id: 'gv-3',
    lecturerCode: 'GV003',
    title: { vi: 'PGS. TS.', en: 'Assoc. Prof., PhD' },
    name: 'Lê Hoàng C',
    department: { vi: 'Khoa Điện - Điện tử', en: 'Faculty of Electrical and Electronics Engineering' },
    email: 'lhc@hcmute.edu.vn',
    phone: '028 3722 1225',
    status: 'FULL',
    groupsCount: 10,
    studentsCount: 20,
    maxStudents: 20,
    researchAreas: { vi: 'Hệ thống nhúng, IoT công nghiệp', en: 'Embedded Systems, Industrial IoT' },
  },
  {
    id: 'gv-4',
    lecturerCode: 'GV004',
    title: { vi: 'ThS.', en: 'MSc' },
    name: 'Vũ Đình D',
    department: { vi: 'Kỹ thuật Phần mềm', en: 'Software Engineering' },
    email: 'vdd@hcmute.edu.vn',
    phone: '028 3722 1226',
    status: 'AVAILABLE',
    groupsCount: 1,
    studentsCount: 10,
    maxStudents: 15,
    researchAreas: { vi: 'Kiến trúc phần mềm, DevOps & Cloud', en: 'Software Architecture, DevOps & Cloud' },
  },
];

export function AdminDashboardScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy } = useOpsCopy();
  const preview = isOpsPreview();

  return (
    <WebOnlyPanel title={copy.adminDashboardTitle} path="/admin">
      {preview ? (
        <View>
          <DataNotice message={copy.previewNotice} />
          <StatStrip
            style={styles.stats}
            items={[
              { icon: 'school-outline', label: copy.adminStudentsTitle, value: '18,420' },
              { icon: 'account-tie-outline', label: copy.adminLecturersTitle, value: '940' },
              { icon: 'book-open-page-variant-outline', label: copy.metricSections, value: '1,250' },
            ]}
          />
        </View>
      ) : null}

      <SectionCard icon="folder-account-outline" title={copy.shortcutsTitle}>
        <ListRow
          icon="school-outline"
          title={copy.adminStudentsTitle}
          subtitle={copy.adminStudentsHint}
          onPress={() => navigation.navigate('admin.students')}
          trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
        />
        <Divider />
        <ListRow
          icon="account-tie-outline"
          title={copy.adminLecturersTitle}
          subtitle={copy.adminLecturersHint}
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
  const { formatNumber, locale } = useLocale();
  const { window } = useTheme();
  const numColumns = window.class === 'compact' || window.fontScale >= 1.3 ? 1 : 2;
  const preview = isOpsPreview();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedStudent, setSelectedStudent] = useState<StudentDirectoryItem | null>(null);

  const needle = normalizeOperationsSearch(search.trim());
  const filtered = SAMPLE_STUDENTS.filter((item) => {
    const matchesSearch =
      needle === '' ||
      normalizeOperationsSearch(item.name).includes(needle) ||
      normalizeOperationsSearch(item.studentCode).includes(needle) ||
      normalizeOperationsSearch(item.email).includes(needle) ||
      normalizeOperationsSearch(item.department[locale]).includes(needle);
    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <WebOnlyPanel title={copy.adminStudentsTitle} path="/admin/users"
      list={preview ? {
        data: filtered,
        keyExtractor: (item, index) => String(item.id),
        numColumns,
        columnWrapperStyle: numColumns > 1 ? styles.columns : undefined,
        empty: <StatePanel kind="empty" title={copy.noMatch} />,
        renderItem: ({ item: student }) => (
          <Card key={student.id} style={[styles.rosterCard, numColumns > 1 ? { width: '48.5%' } : undefined]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${student.name}, ${student.studentCode}`}
              onPress={() => setSelectedStudent(student)}
              style={styles.directoryRow}
            >
              <Avatar decorative name={student.name} size="sm" />
              <View style={styles.directoryCopy}>
                <View style={styles.directoryTop}>
                  <UiText variant="label" style={styles.directoryTopTitle}>{student.name}</UiText>
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
                  {`${student.studentCode} · ${student.department[locale]}`}
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
          scroll
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
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedStudent.department[locale]}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.major}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedStudent.major[locale]}</UiText>
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
              <UiText variant="bodyMedium" style={styles.detailValue}>{formatNumber(selectedStudent.gpa, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</UiText>
            </View>
            <HandoffButton label={copy.openOnWeb} path="/admin/users" />
          </View>
        </Sheet>
      ) : null}
    </>,
      } : undefined}
    >
      {preview ? (
        <View>
          <View style={styles.previewNotice}><DataNotice message={copy.previewNotice} /></View>
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
        </View>
      ) : null}
    </WebOnlyPanel>
  );
}

export function AdminLecturersScreen() {
  const styles = useOpsStyles();
  const { copy } = useOpsCopy();
  const { locale } = useLocale();
  const { window } = useTheme();
  const numColumns = window.class === 'compact' || window.fontScale >= 1.3 ? 1 : 2;
  const preview = isOpsPreview();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE'>('ALL');
  const [selectedLecturer, setSelectedLecturer] = useState<LecturerDirectoryItem | null>(null);

  const needle = normalizeOperationsSearch(search.trim());
  const filtered = SAMPLE_LECTURERS.filter((item) => {
    const matchesSearch =
      needle === '' ||
      normalizeOperationsSearch(item.name).includes(needle) ||
      normalizeOperationsSearch(item.department[locale]).includes(needle) ||
      normalizeOperationsSearch(item.email).includes(needle);
    const matchesFilter = filter === 'ALL' || item.status === 'AVAILABLE';
    return matchesSearch && matchesFilter;
  });

  return (
    <WebOnlyPanel title={copy.adminLecturersTitle} path="/admin/lecturers"
      list={preview ? {
        data: filtered,
        keyExtractor: (item, index) => String(item.id),
        numColumns,
        columnWrapperStyle: numColumns > 1 ? styles.columns : undefined,
        empty: <StatePanel kind="empty" title={copy.noMatch} />,
        renderItem: ({ item: lecturer }) => (
          <Card key={lecturer.id} style={[styles.scheduleCard, numColumns > 1 ? { width: '48.5%' } : undefined]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${lecturer.title[locale]} ${lecturer.name}, ${lecturer.department[locale]}`}
              onPress={() => setSelectedLecturer(lecturer)}
              style={styles.directoryRow}
            >
              <Avatar decorative name={lecturer.name} size="sm" />
              <View style={styles.directoryCopy}>
                <View style={styles.directoryTop}>
                  <UiText variant="label" style={styles.directoryTopTitle}>{`${lecturer.title[locale]} ${lecturer.name}`}</UiText>
                  <StatusPill
                    label={lecturer.status === 'AVAILABLE' ? copy.filterAvailable : copy.statusFull}
                    tone={lecturer.status === 'AVAILABLE' ? 'success' : 'warning'}
                  />
                </View>
                <UiText variant="bodySmall" tone="muted">
                  {lecturer.department[locale]}
                </UiText>
                <View style={styles.slotRow}>
                  <IconChip icon="account-group-outline" size={32} tone="neutral" />
                  <UiText variant="bodySmall" tone="muted" style={{ flex: 1 }}>
                    {`${copy.supervising}: ${fillCopy(countForm(lecturer.groupsCount, copy.groupsCountOne, copy.groupsCount), { n: lecturer.groupsCount })} · ${fillCopy(copy.studentsQuota, { current: lecturer.studentsCount, max: lecturer.maxStudents })}`}
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
          scroll
          visible={Boolean(selectedLecturer)}
          onClose={() => setSelectedLecturer(null)}
          title={copy.lecturerDetail}
        >
          <SheetHeader
            title={`${selectedLecturer.title[locale]} ${selectedLecturer.name}`}
            subtitle={selectedLecturer.department[locale]}
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
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedLecturer.department[locale]}</UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.supervising}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>
                {`${fillCopy(countForm(selectedLecturer.groupsCount, copy.groupsCountOne, copy.groupsCount), { n: selectedLecturer.groupsCount })} · ${fillCopy(copy.studentsQuota, { current: selectedLecturer.studentsCount, max: selectedLecturer.maxStudents })}`}
              </UiText>
            </View>
            <View style={styles.detailRow}>
              <UiText variant="label" style={styles.detailLabel}>{copy.research}</UiText>
              <UiText variant="bodyMedium" style={styles.detailValue}>{selectedLecturer.researchAreas[locale]}</UiText>
            </View>
            <HandoffButton label={copy.openOnWeb} path="/admin/lecturers" />
          </View>
        </Sheet>
      ) : null}
    </>,
      } : undefined}
    >
      {preview ? (
        <View>
          <View style={styles.previewNotice}><DataNotice message={copy.previewNotice} /></View>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder={copy.searchLecturers}
            accessibilityLabel={copy.searchLecturers}
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
        </View>
      ) : null}
    </WebOnlyPanel>
  );
}
