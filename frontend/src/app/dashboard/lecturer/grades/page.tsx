'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, GraduationCap, Users } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { sectionsApi, semestersApi } from '@/lib/api';
import { GradingSection, Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import {
  WorkspaceMetricCard,
  WorkspacePanel,
} from '@/components/dashboard/WorkspaceSurface';

export default function LecturerGradesPage() {
  const { hasAccess, isLoading: authLoading } = useRequireAuth(['LECTURER']);
  const [sections, setSections] = useState<GradingSection[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSemesters = useCallback(async () => {
    const response = await semestersApi.getAll();
    setSemesters(response.data ?? []);
  }, []);

  const fetchSections = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await sectionsApi.getMyGradingSections(
        selectedSemester || undefined,
      );
      setSections(data);
    } catch {
      setError('Grade management data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSemester]);

  useEffect(() => {
    if (hasAccess) {
      void fetchSemesters();
    }
  }, [fetchSemesters, hasAccess]);

  useEffect(() => {
    if (hasAccess) {
      void fetchSections();
    }
  }, [fetchSections, hasAccess]);

  const selectedSemesterName = useMemo(() => {
    return (
      semesters.find((semester) => semester.id === selectedSemester)?.name ??
      'all semesters'
    );
  }, [selectedSemester, semesters]);

  const publishReadyCount = sections.filter((section) => section.canPublish).length;
  const totalGradedEntries = sections.reduce(
    (sum, section) => sum + section.gradedCount,
    0,
  );

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading grade management" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Lecturer workspace</SectionEyebrow>}
        title="Grade management"
        description={`Track grading progress for ${selectedSemesterName}, then move publish-ready sections into the final review step.`}
        actions={
          <div className="min-w-[220px]">
            <Select
              aria-label="Select semester for grade management"
              value={selectedSemester}
              onChange={(event) => setSelectedSemester(event.target.value)}
              options={[
                { value: '', label: 'All semesters' },
                ...semesters.map((semester) => ({
                  value: semester.id,
                  label: semester.name,
                })),
              ]}
            />
          </div>
        }
      />

      {error ? (
        <ErrorState
          title="Grade management unavailable"
          description={error}
          onRetry={() => void fetchSections()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading grade management" />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <WorkspaceMetricCard
              label="Sections"
              value={sections.length.toLocaleString()}
              icon={<FileText className="h-5 w-5" />}
              detail="Active grading responsibilities for the selected semester remain grouped in one queue."
              toneClassName="bg-blue-500/12 text-blue-600 dark:text-blue-400"
            />
            <WorkspaceMetricCard
              label="Grades captured"
              value={totalGradedEntries.toLocaleString()}
              icon={<Users className="h-5 w-5" />}
              detail="Recorded grade entries stay visible before you move any section to final publishing."
              toneClassName="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
            />
            <WorkspaceMetricCard
              label="Ready to publish"
              value={publishReadyCount.toLocaleString()}
              icon={<GraduationCap className="h-5 w-5" />}
              detail="Sections that can move into the final review step are highlighted without changing the grading contract."
              toneClassName="bg-violet-500/12 text-violet-600 dark:text-violet-400"
            />
          </div>

          <WorkspacePanel
            title="Grade management queue"
            description="Filter by semester, review section progress, and continue into the detail route that owns grade entry and publishing."
            contentClassName="space-y-4"
          >
            {sections.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No grading sections yet"
                description="Sections with grading responsibility will appear here once the teaching load is assigned."
                className="min-h-[260px] border-none bg-transparent px-0 py-0"
              />
            ) : (
              sections.map((section) => (
                <div
                  key={section.id}
                  className="rounded-lg border border-border/70 bg-card px-5 py-5"
                >
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-foreground">
                            {section.courseCode} - {section.courseName}
                          </h2>
                          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            Section {section.sectionNumber}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {section.departmentName} - {section.semester}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                        <span>{section.credits} credits</span>
                        <span>{section.enrolledCount} enrolled</span>
                        <span>{section.gradedCount} graded</span>
                        <span>{section.publishedCount} published</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-3 xl:min-w-[200px] xl:items-end">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          section.canPublish
                            ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                            : section.gradeStatus === 'PARTIAL'
                              ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                              : 'bg-secondary text-foreground'
                        }`}
                      >
                        {section.canPublish ? 'Ready to publish' : section.gradeStatus}
                      </span>
                      <Link href={`/dashboard/lecturer/grades/${section.id}`}>
                        <Button>
                          {section.gradedCount > 0 ? 'Manage grades' : 'Enter grades'}
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            )}
          </WorkspacePanel>
        </>
      )}
    </div>
  );
}
