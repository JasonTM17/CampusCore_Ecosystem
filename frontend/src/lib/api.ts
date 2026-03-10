import axios from 'axios';
import { LoginResponse, ApiResponse, User, Section, Enrollment, WaitlistEntry, Semester, Department, Course } from '@/types/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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

  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
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

  getAll: async (params?: { page?: number; limit?: number; status?: string }): Promise<ApiResponse<Enrollment[]>> => {
    const response = await api.get<ApiResponse<Enrollment[]>>('/enrollments', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Enrollment> => {
    const response = await api.get<Enrollment>(`/enrollments/${id}`);
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
  getAll: async (): Promise<ApiResponse<Department[]>> => {
    const response = await api.get<ApiResponse<Department[]>>('/departments');
    return response.data;
  },
};

// Courses API
export const coursesApi = {
  getAll: async (params?: { page?: number; limit?: number; departmentId?: string }): Promise<ApiResponse<Course[]>> => {
    const response = await api.get<ApiResponse<Course[]>>('/courses', { params });
    return response.data;
  },
};

export default api;
