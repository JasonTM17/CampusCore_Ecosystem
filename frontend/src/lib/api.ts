import axios from 'axios';
import { LoginResponse, ApiResponse, User, Section, Enrollment, WaitlistEntry, Semester, Department, Course, StudentGradeRecord, StudentTranscript, TranscriptResponse } from '@/types/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/auth/login', { email, password });
    return response.data;
  },

  register: async (data: { email: string; password: string; firstName: string; lastName: string }): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/auth/register', data);
    return response.data;
  },

  me: async (): Promise<User> => {
    const response = await api.get<User>('/auth/me');
    return response.data;
  },

  updateProfile: async (data: { firstName?: string; lastName?: string; phone?: string; dateOfBirth?: string; address?: string }): Promise<User> => {
    const response = await api.put<User>('/auth/profile', data);
    return response.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },

  changePassword: async (oldPassword: string, newPassword: string): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>('/auth/change-password', { oldPassword, newPassword });
    return response.data;
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>('/auth/forgot-password', { email });
    return response.data;
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>('/auth/reset-password', { token, newPassword });
    return response.data;
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const response = await api.get<{ message: string }>('/auth/verify-email', { params: { token } });
    return response.data;
  },

  resendVerification: async (email: string): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>('/auth/resend-verification', { email });
    return response.data;
  },
};

// Sections API
export const sectionsApi = {
  getAll: async (params?: { page?: number; limit?: number; semesterId?: string; departmentId?: string; courseId?: string }): Promise<ApiResponse<Section[]>> => {
    const response = await api.get<ApiResponse<Section[]>>('/sections', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Section> => {
    const response = await api.get<Section>(`/sections/${id}`);
    return response.data;
  },

  getSectionGrades: async (sectionId: string): Promise<any> => {
    const response = await api.get<any>(`/sections/${sectionId}/grades`);
    return response.data;
  },

  getMySchedule: async (semesterId?: string): Promise<any[]> => {
    const response = await api.get<any[]>('/sections/my/schedule', { params: { semesterId } });
    return response.data;
  },

  getMyGradingSections: async (semesterId?: string): Promise<any[]> => {
    const response = await api.get<any[]>('/sections/my/grading', { params: { semesterId } });
    return response.data;
  },

  updateSectionGrades: async (sectionId: string, grades: { enrollmentId: string; finalGrade: number; letterGrade: string }[]): Promise<{ message: string }> => {
    const response = await api.put<{ message: string }>(`/sections/${sectionId}/grades`, { grades });
    return response.data;
  },

  publishSectionGrades: async (sectionId: string): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>(`/sections/${sectionId}/grades/publish`);
    return response.data;
  },
};

// Enrollments API
export const enrollmentsApi = {
  enroll: async (sectionId: string): Promise<Enrollment | WaitlistEntry> => {
    const response = await api.post<Enrollment | WaitlistEntry>('/enrollments/enroll', { sectionId });
    return response.data;
  },

  drop: async (enrollmentId: string): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>(`/enrollments/${enrollmentId}/drop`, {});
    return response.data;
  },

  getMyEnrollments: async (semesterId?: string): Promise<Enrollment[]> => {
    const response = await api.get<Enrollment[]>('/enrollments/my', { params: { semesterId } });
    return response.data;
  },

  getAll: async (params?: { page?: number; limit?: number; status?: string; semesterId?: string; studentId?: string; courseId?: string; sectionId?: string }): Promise<ApiResponse<Enrollment[]>> => {
    const response = await api.get<ApiResponse<Enrollment[]>>('/enrollments', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Enrollment> => {
    const response = await api.get<Enrollment>(`/enrollments/${id}`);
    return response.data;
  },

  update: async (id: string, data: { status?: string; finalGrade?: number; letterGrade?: string }): Promise<Enrollment> => {
    const response = await api.put<Enrollment>(`/enrollments/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/enrollments/${id}`);
    return response.data;
  },

  exportCsv: async (params?: { status?: string; semesterId?: string; studentId?: string; courseId?: string }): Promise<string> => {
    const response = await api.get<string>('/enrollments/export/csv', { params });
    return response.data;
  },
};

// Semesters API
export const semestersApi = {
  getAll: async (): Promise<ApiResponse<Semester[]>> => {
    const response = await api.get<ApiResponse<Semester[]>>('/semesters');
    return response.data;
  },
};

// Departments API
export const departmentsApi = {
  getAll: async (params?: { page?: number; limit?: number }): Promise<ApiResponse<Department[]>> => {
    const response = await api.get<ApiResponse<Department[]>>('/departments', { params });
    return response.data;
  },
  getById: async (id: string): Promise<Department> => {
    const response = await api.get<Department>(`/departments/${id}`);
    return response.data;
  },
  create: async (data: Partial<Department>): Promise<Department> => {
    const response = await api.post<Department>('/departments', data);
    return response.data;
  },
  update: async (id: string, data: Partial<Department>): Promise<Department> => {
    const response = await api.put<Department>(`/departments/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/departments/${id}`);
    return response.data;
  },
};

// Courses API
export const coursesApi = {
  getAll: async (params?: { page?: number; limit?: number; departmentId?: string }): Promise<ApiResponse<Course[]>> => {
    const response = await api.get<ApiResponse<Course[]>>('/courses', { params });
    return response.data;
  },
  getById: async (id: string): Promise<Course> => {
    const response = await api.get<Course>(`/courses/${id}`);
    return response.data;
  },
  create: async (data: Partial<Course>): Promise<Course> => {
    const response = await api.post<Course>('/courses', data);
    return response.data;
  },
  update: async (id: string, data: Partial<Course>): Promise<Course> => {
    const response = await api.put<Course>(`/courses/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/courses/${id}`);
    return response.data;
  },
};

// Grades API
export const gradesApi = {
  getMyGrades: async (semesterId?: string): Promise<StudentGradeRecord[]> => {
    const response = await api.get<StudentGradeRecord[]>('/enrollments/my/grades', { params: { semesterId } });
    return response.data;
  },

  getMyTranscript: async (semesterId?: string): Promise<TranscriptResponse> => {
    const response = await api.get<TranscriptResponse>('/enrollments/my/transcript', { params: { semesterId } });
    return response.data;
  },
};

// Admin Users API
export const usersApi = {
  getAll: async (params?: { page?: number; limit?: number; status?: string; search?: string }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/users', { params });
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post<any>('/users', data);
    return response.data;
  },
  update: async (id: string, data: any): Promise<any> => {
    const response = await api.put<any>(`/users/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/users/${id}`);
    return response.data;
  },
};

// Admin Semesters API
export const adminSemestersApi = {
  getAll: async (params?: { page?: number; limit?: number }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/semesters', { params });
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post<any>('/semesters', data);
    return response.data;
  },
  update: async (id: string, data: any): Promise<any> => {
    const response = await api.put<any>(`/semesters/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/semesters/${id}`);
    return response.data;
  },
};

// Admin Sections API
export const adminSectionsApi = {
  getAll: async (params?: { page?: number; limit?: number; semesterId?: string; departmentId?: string; courseId?: string }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/sections', { params });
    return response.data;
  },
  getById: async (id: string): Promise<any> => {
    const response = await api.get<any>(`/sections/${id}`);
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post<any>('/sections', data);
    return response.data;
  },
  update: async (id: string, data: any): Promise<any> => {
    const response = await api.put<any>(`/sections/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/sections/${id}`);
    return response.data;
  },
};

// Admin Lecturers API
export const lecturersApi = {
  getAll: async (params?: { page?: number; limit?: number }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/lecturers', { params });
    return response.data;
  },
  getById: async (id: string): Promise<any> => {
    const response = await api.get<any>(`/lecturers/${id}`);
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post<any>('/lecturers', data);
    return response.data;
  },
  update: async (id: string, data: any): Promise<any> => {
    const response = await api.put<any>(`/lecturers/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/lecturers/${id}`);
    return response.data;
  },
};

// Admin Classrooms API
export const classroomsApi = {
  getAll: async (params?: { page?: number; limit?: number }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/classrooms', { params });
    return response.data;
  },
  getById: async (id: string): Promise<any> => {
    const response = await api.get<any>(`/classrooms/${id}`);
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post<any>('/classrooms', data);
    return response.data;
  },
  update: async (id: string, data: any): Promise<any> => {
    const response = await api.put<any>(`/classrooms/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/classrooms/${id}`);
    return response.data;
  },
};

// Admin Academic Years API
export const academicYearsApi = {
  getAll: async (params?: { page?: number; limit?: number }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/academic-years', { params });
    return response.data;
  },
  getById: async (id: string): Promise<any> => {
    const response = await api.get<any>(`/academic-years/${id}`);
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post<any>('/academic-years', data);
    return response.data;
  },
  update: async (id: string, data: any): Promise<any> => {
    const response = await api.put<any>(`/academic-years/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/academic-years/${id}`);
    return response.data;
  },
};

// Analytics API
export const analyticsApi = {
  getOverview: async (): Promise<any> => {
    const response = await api.get<any>('/analytics/overview');
    return response.data;
  },

  getEnrollmentsBySemester: async (): Promise<any[]> => {
    const response = await api.get<any[]>('/analytics/enrollments-by-semester');
    return response.data;
  },

  getSectionOccupancy: async (): Promise<any[]> => {
    const response = await api.get<any[]>('/analytics/section-occupancy');
    return response.data;
  },

  getGradeDistribution: async (): Promise<any[]> => {
    const response = await api.get<any[]>('/analytics/grade-distribution');
    return response.data;
  },

  getEnrollmentTrends: async (): Promise<any[]> => {
    const response = await api.get<any[]>('/analytics/enrollment-trends');
    return response.data;
  },
};

// Finance API
export const financeApi = {
  // Student endpoints
  getMyInvoices: async (semesterId?: string): Promise<any[]> => {
    const response = await api.get<any[]>('/finance/my/invoices', { params: { semesterId } });
    return response.data;
  },

  getMyInvoiceById: async (id: string): Promise<any> => {
    const response = await api.get<any>(`/finance/my/invoices/${id}`);
    return response.data;
  },

  createMyPayment: async (data: { invoiceId: string; amount: number; method: string; transactionId?: string }): Promise<any> => {
    const response = await api.post<any>('/finance/my/payments', data);
    return response.data;
  },

  // Admin endpoints
  getAllInvoices: async (params?: { page?: number; limit?: number; status?: string; semesterId?: string; studentId?: string }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/finance/invoices', { params });
    return response.data;
  },

  getInvoiceById: async (id: string): Promise<any> => {
    const response = await api.get<any>(`/finance/invoices/${id}`);
    return response.data;
  },

  createInvoice: async (data: any): Promise<any> => {
    const response = await api.post<any>('/finance/invoices', data);
    return response.data;
  },

  updateInvoice: async (id: string, data: { status?: string; notes?: string }): Promise<any> => {
    const response = await api.put<any>(`/finance/invoices/${id}`, data);
    return response.data;
  },

  deleteInvoice: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/finance/invoices/${id}`);
    return response.data;
  },

  generateStudentInvoice: async (studentId: string, semesterId: string): Promise<any> => {
    const response = await api.post<any>(`/finance/invoices/generate/student/${studentId}/semester/${semesterId}`);
    return response.data;
  },

  generateSemesterInvoices: async (semesterId: string): Promise<any> => {
    const response = await api.post<any>(`/finance/invoices/generate/semester/${semesterId}`);
    return response.data;
  },

  // Admin payments
  getAllPayments: async (params?: { page?: number; limit?: number; status?: string; invoiceId?: string; studentId?: string }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/finance/payments', { params });
    return response.data;
  },

  createPayment: async (data: any): Promise<any> => {
    const response = await api.post<any>('/finance/payments', data);
    return response.data;
  },

  exportInvoicesCsv: async (params?: { status?: string; semesterId?: string; studentId?: string }): Promise<string> => {
    const response = await api.get<string>('/finance/invoices/export/csv', { params });
    return response.data;
  },

  exportPaymentsCsv: async (params?: { status?: string; invoiceId?: string; studentId?: string }): Promise<string> => {
    const response = await api.get<string>('/finance/payments/export/csv', { params });
    return response.data;
  },
};

// Announcements API
export const announcementsApi = {
  getMy: async (params?: { page?: number; limit?: number }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/announcements/my', { params });
    return response.data;
  },
  // Admin
  getAll: async (params?: { page?: number; limit?: number; semesterId?: string; sectionId?: string; priority?: string }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/announcements', { params });
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post<any>('/announcements', data);
    return response.data;
  },
  update: async (id: string, data: any): Promise<any> => {
    const response = await api.put<any>(`/announcements/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/announcements/${id}`);
    return response.data;
  },
};

// Notifications API
export const notificationsApi = {
  getMy: async (params?: { page?: number; limit?: number; isRead?: boolean }): Promise<ApiResponse<any>> => {
    const response = await api.get<ApiResponse<any>>('/notifications/my', { params });
    return response.data;
  },
  markRead: async (id: string): Promise<any> => {
    const response = await api.patch<any>(`/notifications/my/${id}/read`, {});
    return response.data;
  },
  markAllRead: async (): Promise<{ updated: number }> => {
    const response = await api.patch<{ updated: number }>('/notifications/my/read-all', {});
    return response.data;
  },
};

export default api;
