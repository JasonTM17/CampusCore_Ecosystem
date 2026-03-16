import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // Create Academic Year
  const academicYear = await prisma.academicYear.create({
    data: {
      year: 2025,
      startDate: new Date('2025-01-15'),
      endDate: new Date('2025-12-15'),
      isCurrent: true,
    },
  });
  console.log('Created Academic Year:', academicYear.year);

  // Create Semesters
  const springSemester = await prisma.semester.create({
    data: {
      name: 'Spring 2025',
      type: 'SPRING',
      academicYearId: academicYear.id,
      startDate: new Date('2025-01-15'),
      endDate: new Date('2025-05-15'),
      registrationStart: new Date('2024-12-01'),
      registrationEnd: new Date('2025-01-14'),
      addDropStart: new Date('2025-01-15'),
      addDropEnd: new Date('2025-02-01'),
      status: 'IN_PROGRESS',
    },
  });

  const summerSemester = await prisma.semester.create({
    data: {
      name: 'Summer 2025',
      type: 'SUMMER',
      academicYearId: academicYear.id,
      startDate: new Date('2025-06-01'),
      endDate: new Date('2025-08-15'),
      registrationStart: new Date('2025-04-01'),
      registrationEnd: new Date('2025-05-31'),
      status: 'REGISTRATION_OPEN',
    },
  });

  const fallSemester = await prisma.semester.create({
    data: {
      name: 'Fall 2025',
      type: 'FALL',
      academicYearId: academicYear.id,
      startDate: new Date('2025-09-01'),
      endDate: new Date('2025-12-31'),
      registrationStart: new Date('2025-07-01'),
      registrationEnd: new Date('2025-08-31'),
      status: 'CLOSED',
    },
  });
  console.log('Created Semesters');

  // Create Faculty
  const facCS = await prisma.faculty.create({
    data: {
      name: 'Faculty of Computer Science',
      code: 'FCS',
      description: 'Faculty of Computer Science and Information Technology',
      isActive: true,
    },
  });

  const facEngineering = await prisma.faculty.create({
    data: {
      name: 'Faculty of Engineering',
      code: 'FE',
      description: 'Faculty of Engineering',
      isActive: true,
    },
  });

  const facBusiness = await prisma.faculty.create({
    data: {
      name: 'Faculty of Business Administration',
      code: 'FBA',
      description: 'Faculty of Business Administration',
      isActive: true,
    },
  });
  console.log('Created Faculties');

  // Create Departments
  const deptCS = await prisma.department.create({
    data: {
      name: 'Computer Science',
      code: 'CS',
      description: 'Department of Computer Science',
      facultyId: facCS.id,
      isActive: true,
    },
  });

  const deptSE = await prisma.department.create({
    data: {
      name: 'Software Engineering',
      code: 'SE',
      description: 'Department of Software Engineering',
      facultyId: facCS.id,
      isActive: true,
    },
  });

  const deptCE = await prisma.department.create({
    data: {
      name: 'Computer Engineering',
      code: 'CE',
      description: 'Department of Computer Engineering',
      facultyId: facEngineering.id,
      isActive: true,
    },
  });

  const deptBA = await prisma.department.create({
    data: {
      name: 'Business Administration',
      code: 'BA',
      description: 'Department of Business Administration',
      facultyId: facBusiness.id,
      isActive: true,
    },
  });
  console.log('Created Departments');

  // Create Curriculum
  const curriculumCS = await prisma.curriculum.create({
    data: {
      name: 'Computer Science 2025',
      code: 'CS2025',
      departmentId: deptCS.id,
      academicYearId: academicYear.id,
      totalCredits: 150,
      description: 'Computer Science Curriculum 2025',
      isActive: true,
    },
  });

  const curriculumSE = await prisma.curriculum.create({
    data: {
      name: 'Software Engineering 2025',
      code: 'SE2025',
      departmentId: deptSE.id,
      academicYearId: academicYear.id,
      totalCredits: 152,
      description: 'Software Engineering Curriculum 2025',
      isActive: true,
    },
  });
  console.log('Created Curriculums');

  // Create User Roles
  const studentRole = await prisma.role.upsert({
    where: { name: 'STUDENT' },
    update: {},
    create: { name: 'STUDENT', description: 'Student role' },
  });

  const lecturerRole = await prisma.role.upsert({
    where: { name: 'LECTURER' },
    update: {},
    create: { name: 'LECTURER', description: 'Lecturer role' },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Admin role' },
  });
  console.log('Created Roles');

  // Create Admin User
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@campuscore.edu',
      firstName: 'Admin',
      lastName: 'User',
      password: '$2a$10$rVqKxKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx', // password: admin123
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.create({
    data: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });
  console.log('Created Admin User');

  // Create Lecturer Users and Lecturers
  const lecturer1 = await prisma.user.create({
    data: {
      email: 'john.doe@campuscore.edu',
      firstName: 'John',
      lastName: 'Doe',
      password: '$2a$10$rVqKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx',
      status: 'ACTIVE',
    },
  });

  const lecturer1Profile = await prisma.lecturer.create({
    data: {
      userId: lecturer1.id,
      departmentId: deptCS.id,
      employeeId: 'EMP001',
      title: 'Dr.',
      specialization: 'Artificial Intelligence',
      office: 'Room 301',
      phone: '1234567890',
      isActive: true,
    },
  });

  await prisma.userRole.create({
    data: { userId: lecturer1.id, roleId: lecturerRole.id },
  });

  const lecturer2 = await prisma.user.create({
    data: {
      email: 'jane.smith@campuscore.edu',
      firstName: 'Jane',
      lastName: 'Smith',
      password: '$2a$10$rVqKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx',
      status: 'ACTIVE',
    },
  });

  const lecturer2Profile = await prisma.lecturer.create({
    data: {
      userId: lecturer2.id,
      departmentId: deptSE.id,
      employeeId: 'EMP002',
      title: 'Dr.',
      specialization: 'Software Engineering',
      office: 'Room 302',
      phone: '1234567891',
      isActive: true,
    },
  });

  await prisma.userRole.create({
    data: { userId: lecturer2.id, roleId: lecturerRole.id },
  });

  const lecturer3 = await prisma.user.create({
    data: {
      email: 'bob.wilson@campuscore.edu',
      firstName: 'Bob',
      lastName: 'Wilson',
      password: '$2a$10$rVqKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx',
      status: 'ACTIVE',
    },
  });

  const lecturer3Profile = await prisma.lecturer.create({
    data: {
      userId: lecturer3.id,
      departmentId: deptCE.id,
      employeeId: 'EMP003',
      title: 'Prof.',
      specialization: 'Computer Networks',
      office: 'Room 401',
      phone: '1234567892',
      isActive: true,
    },
  });

  await prisma.userRole.create({
    data: { userId: lecturer3.id, roleId: lecturerRole.id },
  });

  const lecturer4 = await prisma.user.create({
    data: {
      email: 'alice.johnson@campuscore.edu',
      firstName: 'Alice',
      lastName: 'Johnson',
      password: '$2a$10$rVqKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx',
      status: 'ACTIVE',
    },
  });

  const lecturer4Profile = await prisma.lecturer.create({
    data: {
      userId: lecturer4.id,
      departmentId: deptBA.id,
      employeeId: 'EMP004',
      title: 'Dr.',
      specialization: 'Business Management',
      office: 'Room 501',
      phone: '1234567893',
      isActive: true,
    },
  });

  await prisma.userRole.create({
    data: { userId: lecturer4.id, roleId: lecturerRole.id },
  });
  console.log('Created Lecturers');

  // Create Student Users and Students
  const students = [];
  const studentData = [
    { email: 'student1@campuscore.edu', firstName: 'Michael', lastName: 'Brown', studentId: 'CS001' },
    { email: 'student2@campuscore.edu', firstName: 'Sarah', lastName: 'Davis', studentId: 'CS002' },
    { email: 'student3@campuscore.edu', firstName: 'David', lastName: 'Miller', studentId: 'SE001' },
    { email: 'student4@campuscore.edu', firstName: 'Emily', lastName: 'Wilson', studentId: 'CE001' },
    { email: 'student5@campuscore.edu', firstName: 'James', lastName: 'Taylor', studentId: 'BA001' },
  ];

  for (const s of studentData) {
    const user = await prisma.user.create({
      data: {
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        password: '$2a$10$rVqKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx',
        status: 'ACTIVE',
      },
    });

    const student = await prisma.student.create({
      data: {
        userId: user.id,
        studentId: s.studentId,
        curriculumId: s.studentId.startsWith('CS') ? curriculumCS.id : curriculumSE.id,
        year: 1,
        status: 'ACTIVE',
        admissionDate: new Date('2024-09-01'),
      },
    });

    await prisma.userRole.create({
      data: { userId: user.id, roleId: studentRole.id },
    });

    students.push({ user, student });
  }
  console.log('Created Students');

  // Create Classrooms
  const classrooms = [];
  for (let i = 1; i <= 10; i++) {
    const room = await prisma.classroom.create({
      data: {
        building: i <= 5 ? 'Building A' : 'Building B',
        roomNumber: `Room ${100 + i}`,
        capacity: 30 + i * 5,
        type: i <= 3 ? 'LECTURE' : 'LAB',
        isActive: true,
      },
    });
    classrooms.push(room);
  }
  console.log('Created Classrooms');

  // Create Courses
  const courses = [
    { code: 'CS101', name: 'Introduction to Programming', credits: 3, dept: deptCS },
    { code: 'CS201', name: 'Data Structures', credits: 4, dept: deptCS },
    { code: 'CS301', name: 'Algorithms', credits: 4, dept: deptCS },
    { code: 'CS401', name: 'Artificial Intelligence', credits: 3, dept: deptCS },
    { code: 'SE201', name: 'Software Engineering Principles', credits: 3, dept: deptSE },
    { code: 'SE301', name: 'Database Systems', credits: 4, dept: deptSE },
    { code: 'SE401', name: 'Web Development', credits: 3, dept: deptSE },
    { code: 'CE201', name: 'Computer Architecture', credits: 3, dept: deptCE },
    { code: 'CE301', name: 'Computer Networks', credits: 4, dept: deptCE },
    { code: 'BA101', name: 'Introduction to Business', credits: 3, dept: deptBA },
    { code: 'BA201', name: 'Management Principles', credits: 3, dept: deptBA },
  ];

  const createdCourses = [];
  for (const c of courses) {
    const course = await prisma.course.create({
      data: {
        code: c.code,
        name: c.name,
        credits: c.credits,
        departmentId: c.dept.id,
        isActive: true,
      },
    });
    createdCourses.push(course);
  }
  console.log('Created Courses');

  // Create Sections for Spring Semester
  const sections = [];
  const lecturers = [lecturer1Profile, lecturer2Profile, lecturer3Profile, lecturer4Profile];

  for (let i = 0; i < createdCourses.length; i++) {
    const course = createdCourses[i];
    const lecturer = lecturers[i % lecturers.length];
    const classroom = classrooms[i % classrooms.length];

    // Create Section 1
    const section1 = await prisma.section.create({
      data: {
        sectionNumber: '01',
        courseId: course.id,
        semesterId: springSemester.id,
        lecturerId: lecturer.id,
        classroomId: classroom.id,
        capacity: 40,
        enrolledCount: 0,
        status: 'OPEN',
      },
    });

    // Create Section Schedule
    const days = [1, 3]; // Monday, Wednesday
    for (const day of days) {
      await prisma.sectionSchedule.create({
        data: {
          sectionId: section1.id,
          classroomId: classroom.id,
          dayOfWeek: day,
          startTime: `${9 + (i % 3)}:00`,
          endTime: `${10 + (i % 3)}:30`,
        },
      });
    }
    sections.push(section1);

    // Create Section 2 for some courses
    if (i < 5) {
      const section2 = await prisma.section.create({
        data: {
          sectionNumber: '02',
          courseId: course.id,
          semesterId: springSemester.id,
          lecturerId: lecturers[(i + 1) % lecturers.length].id,
          classroomId: classrooms[(i + 1) % classrooms.length].id,
          capacity: 35,
          enrolledCount: 0,
          status: 'OPEN',
        },
      });

      await prisma.sectionSchedule.create({
        data: {
          sectionId: section2.id,
          classroomId: classrooms[(i + 1) % classrooms.length].id,
          dayOfWeek: 2, // Tuesday
          startTime: `${13 + (i % 3)}:00`,
          endTime: `${14 + (i % 3)}:30`,
        },
      });

      await prisma.sectionSchedule.create({
        data: {
          sectionId: section2.id,
          classroomId: classrooms[(i + 1) % classrooms.length].id,
          dayOfWeek: 4, // Thursday
          startTime: `${13 + (i % 3)}:00`,
          endTime: `${14 + (i % 3)}:30`,
        },
      });
      sections.push(section2);
    }
  }
  console.log('Created Sections and Schedules');

  // Create Enrollments for students in Spring Semester
  for (const { student } of students) {
    // Enroll in 3-4 courses
    const numCourses = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numCourses && i < sections.length; i++) {
      const section = sections[i];
      
      // Check if already enrolled
      const existingEnrollment = await prisma.enrollment.findFirst({
        where: { studentId: student.id, sectionId: section.id },
      });

      if (!existingEnrollment) {
        const enrollment = await prisma.enrollment.create({
          data: {
            studentId: student.id,
            sectionId: section.id,
            semesterId: springSemester.id,
            status: 'CONFIRMED',
            enrolledAt: new Date(),
            gradeStatus: Math.random() > 0.5 ? 'PUBLISHED' : 'DRAFT',
          },
        });

        // Add some grades for completed courses
        if (enrollment.gradeStatus === 'PUBLISHED') {
          await prisma.enrollment.update({
            where: { id: enrollment.id },
            data: {
              finalGrade: 70 + Math.floor(Math.random() * 30),
              letterGrade: getLetterGrade(70 + Math.floor(Math.random() * 30)),
            },
          });
        }

        // Update section enrolled count
        await prisma.section.update({
          where: { id: section.id },
          data: { enrolledCount: { increment: 1 } },
        });
      }
    }
  }
  console.log('Created Enrollments for Spring');

  // Create Fall Semester enrollments (completed with grades)
  const fallSections = await prisma.section.findMany({
    where: { semesterId: fallSemester.id },
    include: { course: true },
  });

  if (fallSections.length === 0) {
    // Create Fall sections
    for (let i = 0; i < 6; i++) {
      const course = createdCourses[i];
      const classroom = classrooms[i % classrooms.length];

      const fallSection = await prisma.section.create({
        data: {
          sectionNumber: '01',
          courseId: course.id,
          semesterId: fallSemester.id,
          lecturerId: lecturers[i % lecturers.length].id,
          classroomId: classroom.id,
          capacity: 40,
          enrolledCount: students.length,
          status: 'CLOSED',
        },
      });

      // Enroll students
      for (const { student } of students) {
        const enrollment = await prisma.enrollment.create({
          data: {
            studentId: student.id,
            sectionId: fallSection.id,
            semesterId: fallSemester.id,
            status: 'COMPLETED',
            enrolledAt: new Date('2024-09-01'),
            droppedAt: null,
            gradeStatus: 'PUBLISHED',
            finalGrade: 65 + Math.floor(Math.random() * 35),
            letterGrade: 'B',
          },
        });

        // Update with proper letter grade
        const grade = 65 + Math.floor(Math.random() * 35);
        await prisma.enrollment.update({
          where: { id: enrollment.id },
          data: {
            finalGrade: grade,
            letterGrade: getLetterGrade(grade),
          },
        });
      }
    }
  }
  console.log('Created Enrollments for Fall (completed)');

  // Create Invoices for students
  for (const { student } of students) {
    // Spring invoice
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${springSemester.name.replace(' ', '')}-${student.studentId}`,
        studentId: student.id,
        semesterId: springSemester.id,
        status: 'PENDING',
        subtotal: 3000,
        discount: student.studentId.startsWith('CS') ? 300 : 0,
        total: 2700,
        dueDate: new Date('2025-02-15'),
        paidAmount: 0,
        balance: 2700,
      },
    });

    // Fall invoice (paid)
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${fallSemester.name.replace(' ', '')}-${student.studentId}`,
        studentId: student.id,
        semesterId: fallSemester.id,
        status: 'PAID',
        subtotal: 3000,
        discount: student.studentId.startsWith('CS') ? 300 : 0,
        total: 2700,
        dueDate: new Date('2024-10-15'),
        paidAmount: 2700,
        balance: 0,
        paidAt: new Date('2024-10-01'),
      },
    });
  }
  console.log('Created Invoices');

  // Create Announcements
  await prisma.announcement.create({
    data: {
      title: 'Spring 2025 Registration Open',
      content: 'Course registration for Spring 2025 semester is now open. Please register through the student portal.',
      priority: 'HIGH',
      semesterId: springSemester.id,
      createdById: adminUser.id,
      isPublished: true,
      publishedAt: new Date(),
    },
  });

  await prisma.announcement.create({
    data: {
      title: 'Midterm Examination Schedule',
      content: 'Midterm examinations will be held from March 15-20, 2025. Please check your schedule.',
      priority: 'MEDIUM',
      semesterId: springSemester.id,
      createdById: adminUser.id,
      isPublished: true,
      publishedAt: new Date(),
    },
  });
  console.log('Created Announcements');

  console.log('Seed completed successfully!');
}

function getLetterGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
