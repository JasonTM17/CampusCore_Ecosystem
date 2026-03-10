// API Response Types
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// User & Auth Types
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth?: string;
  address?: string;
  status: string;
  createdAt: string;
  // Linked identities from JWT
  studentId?: string | null;
  lecturerId?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

// Student Types
export interface Student {
  id: string;
  userId: string;
  studentId: string;
  curriculumId: string;
  year: number;
  status: string;
  admissionDate: string;
  createdAt: string;
  user?: User;
  curriculum?: Curriculum;
}

// Course & Section Types
export interface Course {
  id: string;
  code: string;
  name: string;
  description?: string;
  credits: number;
  departmentId: string;
  isActive: boolean;
  createdAt: string;
  department?: Department;
}

export interface Section {
  id: string;
  sectionNumber: string;
  courseId: string;
  semesterId: string;
  lecturerId?: string;
  classroomId?: string;
  capacity: number;
  enrolledCount: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  maxCredits?: number;
  createdAt: string;
  course?: Course & { department?: Department };
  semester?: Semester;
  lecturer?: Lecturer;
  classroom?: Classroom;
  schedules?: SectionSchedule[];
}

export interface SectionSchedule {
  id: string;
  sectionId: string;
  classroomId: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  classroom?: Classroom;
}

export interface Classroom {
  id: string;
  building: string;
  roomNumber: string;
  capacity: number;
  type: string;
  isActive: boolean;
}

// Enrollment Types
export interface Enrollment {
  id: string;
  studentId: string;
  sectionId: string;
  semesterId: string;
  status: 'PENDING' | 'CONFIRMED' | 'DROPPED' | 'COMPLETED' | 'CANCELLED';
  enrolledAt: string;
  droppedAt?: string;
  gradeStatus: 'DRAFT' | 'PUBLISHED' | 'APPEALED';
  finalGrade?: number;
  letterGrade?: string;
  createdAt: string;
  student?: Student;
  section?: Section;
  semester?: Semester;
}

// Waitlist Types
export interface WaitlistEntry {
  id: string;
  studentId: string;
  sectionId: string;
  position: number;
  status: 'ACTIVE' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED';
  addedAt: string;
  convertedAt?: string;
  student?: Student;
  section?: Section;
}

// Academic Types
export interface Semester {
  id: string;
  name: string;
  type: string;
  academicYearId: string;
  startDate: string;
  endDate: string;
  registrationStart?: string;
  registrationEnd?: string;
  addDropStart?: string;
  addDropEnd?: string;
  status: 'DRAFT' | 'ACTIVE' | 'REGISTRATION_OPEN' | 'ADD_DROP_OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'ARCHIVED';
  createdAt: string;
  academicYear?: AcademicYear;
}

export interface AcademicYear {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  facultyId: string;
  isActive: boolean;
  createdAt: string;
  faculty?: Faculty;
}

export interface Faculty {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Curriculum {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  academicYearId: string;
  totalCredits: number;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Lecturer {
  id: string;
  userId: string;
  departmentId: string;
  employeeId: string;
  title?: string;
  specialization?: string;
  office?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  user?: User;
  department?: Department;
}
