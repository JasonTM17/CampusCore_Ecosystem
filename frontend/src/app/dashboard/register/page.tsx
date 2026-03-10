'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { sectionsApi, enrollmentsApi, semestersApi, departmentsApi, coursesApi } from '@/lib/api';
import { Section, Enrollment, WaitlistEntry, Semester, Department, Course } from '@/types/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, BookOpen, Users, Clock, MapPin, AlertCircle, CheckCircle } from 'lucide-react';

export default function RegisterPage() {
  const { user, logout } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState<string | null>(null);
  const [selectedSemester, setSelectedSemester] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sectionsRes, enrollmentsRes, semestersRes, departmentsRes] = await Promise.all([
          sectionsApi.getAll({ limit: 100 }),
          enrollmentsApi.getMyEnrollments(),
          semestersApi.getAll(),
          departmentsApi.getAll(),
        ]);
        
        setSections(sectionsRes.data);
        setEnrollments(enrollmentsRes);
        setSemesters(semestersRes.data);
        setDepartments(departmentsRes.data);
        
        if (semestersRes.data.length > 0) {
          setSelectedSemester(semestersRes.data[0].id);
        }
      } catch (error) {
        toast.error('Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const fetchCourses = async () => {
      if (selectedDepartment) {
        try {
          const coursesRes = await coursesApi.getAll({ departmentId: selectedDepartment });
          setCourses(coursesRes.data);
        } catch (error) {
          toast.error('Failed to load courses');
        }
      } else {
        setCourses([]);
      }
    };
    fetchCourses();
  }, [selectedDepartment]);

  const filteredSections = useMemo(() => {
    return sections.filter(section => {
      if (selectedSemester && section.semesterId !== selectedSemester) return false;
      if (selectedCourse && section.courseId !== selectedCourse) return false;
      if (selectedDepartment && section.course?.departmentId !== selectedDepartment) return false;
      return true;
    });
  }, [sections, selectedSemester, selectedCourse, selectedDepartment]);

  const enrolledSectionIds = useMemo(() => {
    return new Set(enrollments.map(e => e.sectionId));
  }, [enrollments]);

  const handleEnroll = async (sectionId: string) => {
    if (!user?.studentId) {
      toast.error('Student profile not found. Please log in as a student.');
      return;
    }

    setIsEnrolling(sectionId);
    try {
      const result = await enrollmentsApi.enroll(sectionId);
      
      // Check if added to waitlist
      if ('position' in result && result.status === 'ACTIVE') {
        toast.success(`Added to waitlist at position #${result.position}`);
      } else {
        toast.success('Successfully enrolled!');
      }
      
      // Refresh enrollments
      const enrollmentsRes = await enrollmentsApi.getMyEnrollments();
      setEnrollments(enrollmentsRes);
    } catch (error: any) {
      const message = error.response?.data?.message || 'Enrollment failed';
      toast.error(message);
    } finally {
      setIsEnrolling(null);
    }
  };

  const getDayName = (day: number) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[day] || '';
  };

  const getSeatsLeft = (section: Section) => {
    const confirmed = enrollments.filter(e => 
      e.sectionId === section.id && 
      (e.status === 'CONFIRMED' || e.status === 'PENDING')
    ).length;
    return section.capacity - confirmed;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-xl font-bold">CampusCore</Link>
            <span className="text-gray-500">|</span>
            <span className="text-gray-600">Course Registration</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">Welcome, {user?.firstName}</span>
            <Button variant="outline" onClick={logout}>Logout</Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Filters */}
          <div className="lg:w-1/4">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold mb-4">Filters</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
                  <select
                    value={selectedSemester}
                    onChange={(e) => setSelectedSemester(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                  >
                    <option value="">All Semesters</option>
                    {semesters.map(semester => (
                      <option key={semester.id} value={semester.id}>
                        {semester.name} ({semester.type})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                  >
                    <option value="">All Departments</option>
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                  <select
                    value={selectedCourse}
                    onChange={(e) => setSelectedCourse(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                    disabled={!selectedDepartment}
                  >
                    <option value="">All Courses</option>
                    {courses.map(course => (
                      <option key={course.id} value={course.id}>
                        {course.code} - {course.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Sections List */}
          <div className="lg:w-3/4">
            <h2 className="text-xl font-bold mb-4">Available Sections</h2>
            
            {filteredSections.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No sections available with the selected filters</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredSections.map(section => {
                  const seatsLeft = getSeatsLeft(section);
                  const isEnrolled = enrolledSectionIds.has(section.id);
                  const isFull = seatsLeft <= 0;

                  return (
                    <div key={section.id} className="bg-white rounded-lg shadow-sm border p-6">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-semibold">
                              {section.course?.code} - {section.course?.name}
                            </h3>
                            <span className="text-sm text-gray-500">
                              Section {section.sectionNumber}
                            </span>
                          </div>
                          
                          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              <span>{section.course?.credits} credits</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className={isFull ? 'text-red-500' : 'text-green-500'}>
                                {seatsLeft} / {section.capacity} seats left
                              </span>
                            </div>
                            {section.lecturer && (
                              <div className="flex items-center gap-1">
                                <span>Prof. {section.lecturer.user?.firstName} {section.lecturer.user?.lastName}</span>
                              </div>
                            )}
                            {section.classroom && (
                              <div className="flex items-center gap-1">
                                <MapPin className="h-4 w-4" />
                                <span>{section.classroom.building} {section.classroom.roomNumber}</span>
                              </div>
                            )}
                          </div>

                          {/* Schedule */}
                          {section.schedules && section.schedules.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                              {section.schedules.map((schedule, idx) => (
                                <span 
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-sm"
                                >
                                  <Clock className="h-3 w-3" />
                                  {getDayName(schedule.dayOfWeek)} {schedule.startTime}-{schedule.endTime}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="ml-4">
                          {isEnrolled ? (
                            <Button disabled variant="secondary">
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Enrolled
                            </Button>
                          ) : isFull ? (
                            <Button disabled variant="outline">
                              Full
                            </Button>
                          ) : (
                            <Button 
                              onClick={() => handleEnroll(section.id)}
                              disabled={isEnrolling === section.id}
                            >
                              {isEnrolling === section.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : null}
                              Enroll
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
