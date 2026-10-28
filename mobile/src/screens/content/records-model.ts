// Student records read models: the conduct summary and the certificate
// information composed from conduct plus curriculum. Nothing here invents a
// request, a status or a classification the server did not return.

export interface ConductActivity {
  id: string;
  title: string;
  category?: string | null;
  organizer?: string | null;
  activityDate?: string | null;
  points?: number | null;
}

export interface ConductCriterion {
  code: string;
  nameVi?: string | null;
  nameEn?: string | null;
  score: number;
  maxScore: number;
}

export interface ConductTerm {
  id: string;
  semesterId?: string | null;
  semesterName: string;
  totalScore: number | null;
  classification: string | null;
  classificationVi: string | null;
  status: string | null;
  evaluatorName: string | null;
  criteria: ConductCriterion[];
  activities: ConductActivity[];
}

export interface ConductModel {
  studentCode: string | null;
  fullName: string | null;
  cumulativeAverage: number | null;
  cumulativeClassificationVi: string | null;
  terms: ConductTerm[];
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
/** The backend stringifies a missing student record as the literal "null". */
const studentCode = (value: unknown): string | null => {
  const raw = text(value);
  return raw && raw !== 'null' && raw !== 'undefined' ? raw : null;
};

function parseTerm(raw: unknown, index: number): ConductTerm | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const name = text(row.semesterName);
  if (!name) return null;
  const criteria = Array.isArray(row.criteria)
    ? (row.criteria as Record<string, unknown>[]).flatMap((entry) => {
        const score = num(entry?.score);
        const maxScore = num(entry?.maxScore);
        const criterionCode = text(entry?.code);
        return score === null || maxScore === null || !criterionCode
          ? []
          : [{ code: criterionCode, nameVi: text(entry.nameVi), nameEn: text(entry.nameEn), score, maxScore }];
      })
    : [];
  const activities = Array.isArray(row.activities)
    ? (row.activities as Record<string, unknown>[]).flatMap((entry, at) => {
        const title = text(entry?.title);
        return title
          ? [{
              id: text(entry.id) ?? `${index}-${at}`,
              title,
              category: text(entry.category),
              organizer: text(entry.organizer),
              activityDate: text(entry.activityDate),
              points: num(entry.points),
            }]
          : [];
      })
    : [];
  return {
    id: text(row.id) ?? text(row.semesterId) ?? `term-${index}`,
    semesterId: text(row.semesterId),
    semesterName: name,
    totalScore: num(row.totalScore),
    classification: text(row.classification),
    classificationVi: text(row.classificationVi),
    status: text(row.status),
    evaluatorName: text(row.evaluatorName),
    criteria,
    activities,
  };
}

/** Null when the body is not a conduct summary; the screen then shows its error state instead of an empty record. */
export function parseConduct(raw: unknown): ConductModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (!('history' in body) && !('currentSemester' in body) && !('cumulativeAverageScore' in body) && !('studentCode' in body)) {
    return null;
  }
  const seen = new Set<string>();
  const terms: ConductTerm[] = [];
  const candidates = [body.currentSemester, ...(Array.isArray(body.history) ? body.history : [])];
  candidates.forEach((entry, index) => {
    const term = parseTerm(entry, index);
    if (term && !seen.has(term.id)) {
      seen.add(term.id);
      terms.push(term);
    }
  });
  return {
    studentCode: studentCode(body.studentCode),
    fullName: text(body.fullName),
    cumulativeAverage: num(body.cumulativeAverageScore),
    cumulativeClassificationVi: text(body.cumulativeClassificationVi),
    terms,
  };
}

export interface CertificateInfo {
  studentCode: string | null;
  fullName: string | null;
  programName: string | null;
  creditsEarned: number;
  creditsRequired: number | null;
  mandatoryRemaining: number;
  conductAverage: number | null;
  conductClassificationVi: string | null;
  /** False when neither source returned anything: the screen then shows an empty state. */
  hasData: boolean;
}

interface CurriculumLike {
  curriculum?: { name?: string | null; nameVi?: string | null; nameEn?: string | null; totalCredits?: number | null } | null;
  courses?: ReadonlyArray<{ credits?: number | null; isMandatory?: boolean; status?: string }> | null;
}

export function composeCertificateInfo(
  conduct: ConductModel | null,
  curriculum: CurriculumLike | null,
  locale: 'vi' | 'en' = 'vi',
): CertificateInfo {
  const courses = curriculum?.courses ?? [];
  const earned = courses
    .filter((course) => course.status === 'COMPLETED')
    .reduce((sum, course) => sum + (typeof course.credits === 'number' ? course.credits : 0), 0);
  const remaining = courses.filter((course) => course.isMandatory && course.status !== 'COMPLETED').length;
  const program = curriculum?.curriculum;
  const name = locale === 'en' ? program?.nameEn ?? program?.name : program?.nameVi ?? program?.name;
  return {
    studentCode: conduct?.studentCode ?? null,
    fullName: conduct?.fullName ?? null,
    programName: text(name),
    creditsEarned: earned,
    creditsRequired: num(program?.totalCredits),
    mandatoryRemaining: remaining,
    conductAverage: conduct?.cumulativeAverage ?? null,
    conductClassificationVi: conduct?.cumulativeClassificationVi ?? null,
    hasData: Boolean(conduct || curriculum),
  };
}
