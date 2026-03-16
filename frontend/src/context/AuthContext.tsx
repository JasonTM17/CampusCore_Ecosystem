'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types/api';
import { authApi } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isStudent: boolean;
  isLecturer: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const userData = await authApi.me();
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
    } catch {
      // Token invalid, clear storage
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      setUser(null);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');
      const storedUser = localStorage.getItem('user');
      
      if (token && storedUser) {
        try {
          // Set user from storage first for fast load
          setUser(JSON.parse(storedUser));
          
          // Then validate token in background
          await refreshUser();
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    localStorage.setItem('accessToken', response.accessToken);
    localStorage.setItem('refreshToken', response.refreshToken);
    localStorage.setItem('user', JSON.stringify(response.user));
    setUser(response.user);
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout API errors
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      setUser(null);
      window.location.href = '/login';
    }
  };

  const isStudent = user?.roles?.includes('STUDENT') ?? false;
  const isLecturer = user?.roles?.includes('LECTURER') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const isSuperAdmin = user?.roles?.includes('SUPER_ADMIN') ?? false;

  return (
    <AuthContext.Provider value={{ 
      user, 
      isLoading, 
      isStudent, 
      isLecturer, 
      isAdmin, 
      isSuperAdmin, 
      login, 
      logout,
      refreshUser 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Hook for protected routes
export function useRequireAuth(requiredRoles?: ('STUDENT' | 'LECTURER' | 'ADMIN' | 'SUPER_ADMIN')[]) {
  const { user, isLoading } = useAuth();
  const router = typeof window !== 'undefined' ? require('next/navigation').useRouter() : null;
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router?.push('/login');
      return;
    }

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.some(role => {
        if (role === 'ADMIN') return user.roles?.includes('ADMIN') || user.roles?.includes('SUPER_ADMIN');
        return user.roles?.includes(role);
      });

      if (!hasRole) {
        // Redirect to appropriate dashboard based on role
        if (user.roles?.includes('ADMIN') || user.roles?.includes('SUPER_ADMIN')) {
          router?.push('/admin');
        } else if (user.roles?.includes('LECTURER')) {
          router?.push('/dashboard/lecturer');
        } else {
          router?.push('/dashboard');
        }
        return;
      }
    }

    setHasAccess(true);
  }, [user, isLoading, requiredRoles, router]);

  return { user, isLoading, hasAccess };
}
