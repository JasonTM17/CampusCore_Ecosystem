import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

type SeedProfile = 'ui-rich' | 'observability' | 'load';

const profiles: Record<
  SeedProfile,
  {
    students: number;
    sectionsPerCourse: number;
    months: number;
    enrollmentsPerStudent: number;
  }
> = {
  'ui-rich': {
    students: 80,
    sectionsPerCourse: 2,
    months: 12,
    enrollmentsPerStudent: 5,
  },
  observability: {
    students: 240,
    sectionsPerCourse: 3,
    months: 18,
    enrollmentsPerStudent: 6,
  },
  load: {
    students: 1000,
    sectionsPerCourse: 4,
    months: 24,
    enrollmentsPerStudent: 7,
  },
};

const faculties = [
  {
    code: 'FCS',
    nameEn: 'Faculty of Computer Science',
    nameVi: 'Khoa Khoa học máy tính',
  },
  {
    code: 'FBA',
    nameEn: 'Faculty of Business Administration',
    nameVi: 'Khoa Quản trị kinh doanh',
  },
  {
    code: 'FDS',
    nameEn: 'Faculty of Data and Systems',
    nameVi: 'Khoa Dữ liệu và Hệ thống',
  },
];

const departments = [
  {
    code: 'CS',
    facultyCode: 'FCS',
    nameEn: 'Computer Science',
    nameVi: 'Khoa học máy tính',
  },
  {
    code: 'SE',
    facultyCode: 'FCS',
    nameEn: 'Software Engineering',
    nameVi: 'Kỹ thuật phần mềm',
  },
  {
    code: 'BA',
    facultyCode: 'FBA',
    nameEn: 'Business Administration',
    nameVi: 'Quản trị kinh doanh',
  },
  {
    code: 'DS',
    facultyCode: 'FDS',
    nameEn: 'Data Science',
    nameVi: 'Khoa học dữ liệu',
  },
  {
    code: 'IS',
    facultyCode: 'FDS',
    nameEn: 'Information Systems',
    nameVi: 'Hệ thống thông tin',
  },
];

const courses = [
  ['CS101', 'Introduction to Programming', 'Nhập môn lập trình', 'CS', 3],
  ['CS201', 'Data Structures', 'Cấu trúc dữ liệu', 'CS', 4],
  ['CS301', 'Algorithms', 'Giải thuật', 'CS', 4],
  ['CS401', 'Artificial Intelligence', 'Trí tuệ nhân tạo', 'CS', 3],
  [
    'SE201',
    'Software Engineering Principles',
    'Nguyên lý kỹ thuật phần mềm',
    'SE',
    3,
  ],
  ['SE301', 'Database Systems', 'Hệ quản trị cơ sở dữ liệu', 'SE', 4],
  ['SE401', 'Web Development', 'Phát triển web', 'SE', 3],
  ['BA101', 'Introduction to Business', 'Nhập môn kinh doanh', 'BA', 3],
  ['BA201', 'Management Principles', 'Nguyên lý quản trị', 'BA', 3],
  ['DS210', 'Applied Statistics', 'Thống kê ứng dụng', 'DS', 3],
  ['DS320', 'Machine Learning Operations', 'Vận hành học máy', 'DS', 4],
  ['IS240', 'Enterprise Systems', 'Hệ thống doanh nghiệp', 'IS', 3],
] as const;

const firstNames = [
  'An',
  'Binh',
  'Chi',
  'Duy',
  'Hana',
  'Khoa',
  'Linh',
  'Minh',
  'Nhi',
  'Quan',
  'Son',
  'Trang',
];

const lastNames = [
  'Nguyen',
  'Tran',
  'Le',
  'Pham',
  'Hoang',
  'Vo',
  'Dang',
  'Bui',
];

function getArgProfile(): SeedProfile {
  const raw =
    process.argv.find((arg) => arg.startsWith('--profile='))?.split('=')[1] ||
    process.env.CAMPUSCORE_SEED_PROFILE ||
    'ui-rich';

  if (raw === 'ui-rich' || raw === 'observability' || raw === 'load') {
    return raw;
  }

  throw new Error(
    `Unsupported seed profile "${raw}". Use ui-rich, observability, or load.`,
  );
}

function getLetterGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'B-';
  if (score >= 65) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 55) return 'D';
  return 'F';
}

function monthDate(monthsAgo: number, day = 8) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day),
  );
}

async function ensureAcademicShape() {
  const academicYears = [];
  for (const year of [2025, 2026, 2027]) {
    academicYears.push(
      await prisma.academicYear.upsert({
        where: { year },
        update: {},
        create: {
          year,
          startDate: new Date(Date.UTC(year, 0, 10)),
          endDate: new Date(Date.UTC(year, 11, 20)),
          isCurrent: year === 2026,
        },
      }),
    );
  }

  const semesters = [];
  for (const academicYear of academicYears) {
    const year = academicYear.year;
    const semesterSpecs = [
      {
        type: 'SPRING',
        nameEn: `Spring ${year}`,
        nameVi: `Học kỳ Xuân ${year}`,
        start: [year, 0, 15],
        end: [year, 4, 20],
        status:
          year < 2026 ? 'CLOSED' : year === 2026 ? 'IN_PROGRESS' : 'DRAFT',
      },
      {
        type: 'SUMMER',
        nameEn: `Summer ${year}`,
        nameVi: `Học kỳ Hè ${year}`,
        start: [year, 5, 1],
        end: [year, 7, 20],
        status:
          year < 2026
            ? 'CLOSED'
            : year === 2026
              ? 'REGISTRATION_OPEN'
              : 'DRAFT',
      },
      {
        type: 'FALL',
        nameEn: `Fall ${year}`,
        nameVi: `Học kỳ Thu ${year}`,
        start: [year, 8, 1],
        end: [year, 11, 20],
        status: year < 2026 ? 'CLOSED' : 'REGISTRATION_OPEN',
      },
    ];

    for (const spec of semesterSpecs) {
      semesters.push(
        await prisma.semester.upsert({
          where: {
            academicYearId_type: {
              academicYearId: academicYear.id,
              type: spec.type,
            },
          },
          update: {
            name: spec.nameEn,
            nameEn: spec.nameEn,
            nameVi: spec.nameVi,
            status: spec.status as any,
          },
          create: {
            academicYearId: academicYear.id,
            type: spec.type,
            name: spec.nameEn,
            nameEn: spec.nameEn,
            nameVi: spec.nameVi,
            startDate: new Date(
              Date.UTC(spec.start[0], spec.start[1], spec.start[2]),
            ),
            endDate: new Date(Date.UTC(spec.end[0], spec.end[1], spec.end[2])),
            registrationStart: new Date(
              Date.UTC(spec.start[0], spec.start[1] - 1, 1),
            ),
            registrationEnd: new Date(
              Date.UTC(spec.start[0], spec.start[1], 10),
            ),
            addDropStart: new Date(Date.UTC(spec.start[0], spec.start[1], 15)),
            addDropEnd: new Date(Date.UTC(spec.start[0], spec.start[1], 25)),
            status: spec.status as any,
          },
        }),
      );
    }
  }

  const facultyMap = new Map<string, string>();
  for (const faculty of faculties) {
    const record = await prisma.faculty.upsert({
      where: { code: faculty.code },
      update: {
        name: faculty.nameEn,
        nameEn: faculty.nameEn,
        nameVi: faculty.nameVi,
        descriptionEn: `${faculty.nameEn} academic unit`,
        descriptionVi: `Đơn vị học thuật ${faculty.nameVi}`,
      },
      create: {
        code: faculty.code,
        name: faculty.nameEn,
        nameEn: faculty.nameEn,
        nameVi: faculty.nameVi,
        description: `${faculty.nameEn} academic unit`,
        descriptionEn: `${faculty.nameEn} academic unit`,
        descriptionVi: `Đơn vị học thuật ${faculty.nameVi}`,
        isActive: true,
      },
    });
    facultyMap.set(faculty.code, record.id);
  }

  const departmentMap = new Map<string, string>();
  for (const department of departments) {
    const facultyId = facultyMap.get(department.facultyCode);
    if (!facultyId)
      throw new Error(`Missing faculty ${department.facultyCode}`);
    const record = await prisma.department.upsert({
      where: { code: department.code },
      update: {
        name: department.nameEn,
        nameEn: department.nameEn,
        nameVi: department.nameVi,
        facultyId,
      },
      create: {
        code: department.code,
        name: department.nameEn,
        nameEn: department.nameEn,
        nameVi: department.nameVi,
        description: `${department.nameEn} department`,
        descriptionEn: `${department.nameEn} department`,
        descriptionVi: `Bộ môn ${department.nameVi}`,
        facultyId,
        isActive: true,
      },
    });
    departmentMap.set(department.code, record.id);
  }

  const currentYear =
    academicYears.find((year) => year.year === 2026) ?? academicYears[0];
  const curriculum = await prisma.curriculum.upsert({
    where: { code: 'OBS-CS-2026' },
    update: {},
    create: {
      code: 'OBS-CS-2026',
      name: 'CampusCore Operations Curriculum 2026',
      nameEn: 'CampusCore Operations Curriculum 2026',
      nameVi: 'Chương trình Vận hành CampusCore 2026',
      departmentId: departmentMap.get('CS') ?? [...departmentMap.values()][0],
      academicYearId: currentYear.id,
      totalCredits: 144,
      description: 'Operations-focused academic demo curriculum',
      descriptionEn: 'Operations-focused academic demo curriculum',
      descriptionVi: 'Chương trình demo học vụ tập trung vào vận hành',
      isActive: true,
    },
  });

  const courseRecords = [];
  for (const [code, nameEn, nameVi, departmentCode, credits] of courses) {
    const departmentId = departmentMap.get(departmentCode);
    if (!departmentId) throw new Error(`Missing department ${departmentCode}`);
    courseRecords.push(
      await prisma.course.upsert({
        where: { code },
        update: {
          name: nameEn,
          nameEn,
          nameVi,
          credits,
          departmentId,
        },
        create: {
          code,
          name: nameEn,
          nameEn,
          nameVi,
          credits,
          departmentId,
          description: `${nameEn} course`,
          descriptionEn: `${nameEn} course`,
          descriptionVi: `Môn học ${nameVi}`,
          isActive: true,
        },
      }),
    );
  }

  const classrooms = [];
  for (let i = 1; i <= 18; i++) {
    classrooms.push(
      await prisma.classroom.upsert({
        where: {
          building_roomNumber: {
            building: `Learning Tower ${i <= 9 ? 'A' : 'B'}`,
            roomNumber: `${200 + i}`,
          },
        },
        update: {},
        create: {
          building: `Learning Tower ${i <= 9 ? 'A' : 'B'}`,
          roomNumber: `${200 + i}`,
          capacity: 32 + ((i * 7) % 38),
          type: i % 3 === 0 ? 'LAB' : 'LECTURE',
          equipment: [
            'Projector',
            'Wi-Fi',
            i % 3 === 0 ? 'Workstations' : 'Whiteboard',
          ],
          isActive: true,
        },
      }),
    );
  }

  return { curriculum, courseRecords, classrooms, semesters };
}

async function ensureStudents(count: number, curriculumId: string) {
  const password = await bcrypt.hash('password123', 12);
  const studentRole = await prisma.role.upsert({
    where: { name: 'STUDENT' },
    update: {},
    create: { name: 'STUDENT', description: 'Student role' },
  });
  const students = [];

  for (let i = 1; i <= count; i++) {
    const padded = String(i).padStart(4, '0');
    const email = `demo.student${padded}@campuscore.edu`;
    const user = await prisma.user.upsert({
      where: { email },
      update: { status: 'ACTIVE' },
      create: {
        email,
        firstName: firstNames[i % firstNames.length],
        lastName: lastNames[i % lastNames.length],
        password,
        status: 'ACTIVE',
      },
    });
    const student = await prisma.student.upsert({
      where: { studentId: `OBS${padded}` },
      update: {
        curriculumId,
        status: i % 31 === 0 ? 'SUSPENDED' : 'ACTIVE',
      },
      create: {
        userId: user.id,
        studentId: `OBS${padded}`,
        curriculumId,
        year: 1 + (i % 4),
        status: i % 31 === 0 ? 'SUSPENDED' : 'ACTIVE',
        admissionDate: monthDate(24 - (i % 18), 1),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: studentRole.id } },
      update: {},
      create: { userId: user.id, roleId: studentRole.id },
    });
    students.push({ user, student });
  }

  return students;
}

async function ensureSections({
  courseRecords,
  classrooms,
  semesters,
  sectionsPerCourse,
}: {
  courseRecords: Array<{ id: string; code: string }>;
  classrooms: Array<{ id: string; capacity: number }>;
  semesters: Array<{ id: string; type: string; status: string }>;
  sectionsPerCourse: number;
}) {
  const lecturers = await prisma.lecturer.findMany({ take: 12 });
  const sections = [];
  const activeSemesters = semesters.filter((semester) =>
    ['REGISTRATION_OPEN', 'ADD_DROP_OPEN', 'IN_PROGRESS', 'CLOSED'].includes(
      semester.status,
    ),
  );

  for (const semester of activeSemesters) {
    for (
      let courseIndex = 0;
      courseIndex < courseRecords.length;
      courseIndex++
    ) {
      const course = courseRecords[courseIndex];
      for (
        let sectionNumber = 1;
        sectionNumber <= sectionsPerCourse;
        sectionNumber++
      ) {
        const classroom =
          classrooms[(courseIndex + sectionNumber) % classrooms.length];
        const section = await prisma.section.upsert({
          where: {
            courseId_semesterId_sectionNumber: {
              courseId: course.id,
              semesterId: semester.id,
              sectionNumber: String(sectionNumber).padStart(2, '0'),
            },
          },
          update: {
            capacity:
              sectionNumber === 1
                ? Math.max(12, Math.floor(classroom.capacity * 0.55))
                : classroom.capacity,
            status: semester.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
          },
          create: {
            courseId: course.id,
            semesterId: semester.id,
            sectionNumber: String(sectionNumber).padStart(2, '0'),
            lecturerId:
              lecturers[(courseIndex + sectionNumber) % lecturers.length]?.id,
            classroomId: classroom.id,
            capacity:
              sectionNumber === 1
                ? Math.max(12, Math.floor(classroom.capacity * 0.55))
                : classroom.capacity,
            status: semester.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
          },
        });

        const scheduleDay = 1 + ((courseIndex + sectionNumber) % 5);
        const existingSchedule = await prisma.sectionSchedule.findFirst({
          where: {
            sectionId: section.id,
            classroomId: classroom.id,
            dayOfWeek: scheduleDay,
          },
        });
        if (!existingSchedule) {
          await prisma.sectionSchedule.create({
            data: {
              sectionId: section.id,
              classroomId: classroom.id,
              dayOfWeek: scheduleDay,
              startTime: `${8 + ((courseIndex + sectionNumber) % 7)}:00`,
              endTime: `${9 + ((courseIndex + sectionNumber) % 7)}:30`,
            },
          });
        }

        sections.push(section);
      }
    }
  }

  return sections;
}

async function ensureAcademicActivity(
  profile: SeedProfile,
  students: Awaited<ReturnType<typeof ensureStudents>>,
  sections: Awaited<ReturnType<typeof ensureSections>>,
) {
  const config = profiles[profile];
  const statuses = [
    'CONFIRMED',
    'CONFIRMED',
    'CONFIRMED',
    'COMPLETED',
    'DROPPED',
  ];

  for (let index = 0; index < students.length; index++) {
    const { student } = students[index];
    for (let offset = 0; offset < config.enrollmentsPerStudent; offset++) {
      const section = sections[(index * 3 + offset) % sections.length];
      const status = statuses[(index + offset) % statuses.length] as any;
      const score = 58 + ((index * 11 + offset * 7) % 42);
      await prisma.enrollment.upsert({
        where: {
          studentId_sectionId: {
            studentId: student.id,
            sectionId: section.id,
          },
        },
        update: {
          status,
          semesterId: section.semesterId,
          enrolledAt: monthDate((index + offset) % config.months),
          droppedAt:
            status === 'DROPPED'
              ? monthDate((index + offset) % config.months, 22)
              : null,
          gradeStatus: status === 'COMPLETED' ? 'PUBLISHED' : 'DRAFT',
          finalGrade: status === 'COMPLETED' ? score : null,
          letterGrade: status === 'COMPLETED' ? getLetterGrade(score) : null,
        },
        create: {
          studentId: student.id,
          sectionId: section.id,
          semesterId: section.semesterId,
          status,
          enrolledAt: monthDate((index + offset) % config.months),
          droppedAt:
            status === 'DROPPED'
              ? monthDate((index + offset) % config.months, 22)
              : null,
          gradeStatus: status === 'COMPLETED' ? 'PUBLISHED' : 'DRAFT',
          finalGrade: status === 'COMPLETED' ? score : null,
          letterGrade: status === 'COMPLETED' ? getLetterGrade(score) : null,
        },
      });
    }

    if (index % 9 === 0) {
      const section = sections[(index * 5) % sections.length];
      await prisma.waitlist.upsert({
        where: {
          sectionId_studentId: {
            sectionId: section.id,
            studentId: student.id,
          },
        },
        update: {
          status: index % 27 === 0 ? 'CONVERTED' : 'ACTIVE',
          position: 1 + (index % 12),
        },
        create: {
          sectionId: section.id,
          studentId: student.id,
          position: 1 + (index % 12),
          status: index % 27 === 0 ? 'CONVERTED' : 'ACTIVE',
          addedAt: monthDate(index % config.months, 12),
          convertedAt:
            index % 27 === 0 ? monthDate(index % config.months, 18) : null,
        },
      });
    }
  }

  for (const section of sections) {
    const enrolledCount = await prisma.enrollment.count({
      where: {
        sectionId: section.id,
        status: { in: ['CONFIRMED', 'PENDING', 'COMPLETED'] },
      },
    });
    await prisma.section.update({
      where: { id: section.id },
      data: { enrolledCount },
    });
  }
}

async function ensureFinanceAndNotifications(
  profile: SeedProfile,
  students: Awaited<ReturnType<typeof ensureStudents>>,
  semesters: Array<{
    id: string;
    name: string;
    nameEn: string | null;
    nameVi: string | null;
  }>,
) {
  const config = profiles[profile];
  const invoiceStatuses = [
    'PENDING',
    'PAID',
    'OVERDUE',
    'PARTIALLY_PAID',
  ] as const;
  const paymentMethods = [
    'MOMO',
    'ZALOPAY',
    'VNPAY',
    'PAYPAL',
    'CARD',
  ] as const;
  const paymentStatuses = [
    'COMPLETED',
    'PENDING',
    'FAILED',
    'REFUNDED',
  ] as const;

  for (let index = 0; index < students.length; index++) {
    const { user, student } = students[index];
    const semester = semesters[index % semesters.length];
    const invoiceStatus = invoiceStatuses[index % invoiceStatuses.length];
    const total = 1800 + (index % 7) * 220;
    const invoice = await prisma.invoice.upsert({
      where: { invoiceNumber: `OBS-INV-${student.studentId}` },
      update: {
        status: invoiceStatus,
        total,
        subtotal: total + 100,
        discount: 100,
        dueDate: monthDate(index % config.months, 26),
        paidAt:
          invoiceStatus === 'PAID'
            ? monthDate(index % config.months, 18)
            : null,
      },
      create: {
        invoiceNumber: `OBS-INV-${student.studentId}`,
        studentId: student.id,
        semesterId: semester.id,
        status: invoiceStatus,
        subtotal: total + 100,
        discount: 100,
        total,
        dueDate: monthDate(index % config.months, 26),
        paidAt:
          invoiceStatus === 'PAID'
            ? monthDate(index % config.months, 18)
            : null,
      },
    });

    await prisma.invoiceItem.upsert({
      where: {
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      },
      update: {
        invoiceId: invoice.id,
        description: 'Tuition and campus services',
        unitPrice: total,
        total,
      },
      create: {
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        invoiceId: invoice.id,
        description: 'Tuition and campus services',
        quantity: 1,
        unitPrice: total,
        total,
      },
    });

    if (invoiceStatus !== 'PENDING' || index % 4 === 0) {
      const paymentStatus = paymentStatuses[index % paymentStatuses.length];
      await prisma.payment.upsert({
        where: { paymentNumber: `OBS-PAY-${student.studentId}` },
        update: {
          invoiceId: invoice.id,
          studentId: student.id,
          method: paymentMethods[index % paymentMethods.length],
          status: paymentStatus,
          amount:
            invoiceStatus === 'PARTIALLY_PAID'
              ? Math.round(total * 0.45)
              : total,
          paidAt:
            paymentStatus === 'COMPLETED'
              ? monthDate(index % config.months, 19)
              : null,
          transactionId: `OBS-TXN-${student.studentId}`,
        },
        create: {
          paymentNumber: `OBS-PAY-${student.studentId}`,
          invoiceId: invoice.id,
          studentId: student.id,
          method: paymentMethods[index % paymentMethods.length],
          status: paymentStatus,
          amount:
            invoiceStatus === 'PARTIALLY_PAID'
              ? Math.round(total * 0.45)
              : total,
          paidAt:
            paymentStatus === 'COMPLETED'
              ? monthDate(index % config.months, 19)
              : null,
          transactionId: `OBS-TXN-${student.studentId}`,
          notes: 'Generated by CampusCore observability seed profile.',
        },
      });
    }

    if (index % 3 === 0) {
      const notificationType =
        index % 15 === 0 ? 'ERROR' : index % 9 === 0 ? 'WARNING' : 'INFO';
      const title =
        notificationType === 'ERROR'
          ? 'Payment callback needs review'
          : notificationType === 'WARNING'
            ? 'Registration waitlist changed'
            : 'Enrollment summary updated';
      const existing = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          title,
        },
      });
      if (!existing) {
        await prisma.notification.create({
          data: {
            userId: user.id,
            title,
            message:
              notificationType === 'ERROR'
                ? 'A provider callback could not be reconciled automatically.'
                : notificationType === 'WARNING'
                  ? 'A section is close to capacity and the waitlist has changed.'
                  : 'Your latest enrollment and billing summary is ready.',
            type: notificationType,
            link: '/dashboard',
            isRead: index % 4 === 0,
            createdAt: monthDate(index % config.months, 20),
          },
        });
      }
    }
  }
}

async function ensureAnnouncements(semesters: Array<{ id: string }>) {
  const announcements = [
    {
      title: 'Registration pressure watch',
      content:
        'Several sections are approaching capacity. Review waitlists and schedule alternatives before the next registration wave.',
      priority: 'HIGH',
    },
    {
      title: 'Payment reconciliation window',
      content:
        'Finance operations will reconcile sandbox checkout results and pending invoices this week.',
      priority: 'NORMAL',
    },
    {
      title: 'Student support queue update',
      content:
        'Advising and billing teams are reviewing cases that require manual follow-up.',
      priority: 'NORMAL',
    },
  ];

  for (const item of announcements) {
    const existing = await prisma.announcement.findFirst({
      where: { title: item.title },
    });
    if (!existing) {
      await prisma.announcement.create({
        data: {
          ...item,
          targetRoles: ['STUDENT', 'LECTURER', 'ADMIN'],
          targetYears: [1, 2, 3, 4],
          isGlobal: true,
          semesterId: semesters[0]?.id,
          publishAt: new Date(),
          publishedBy: 'admin@campuscore.edu',
        },
      });
    }
  }
}

async function main() {
  const profile = getArgProfile();
  const config = profiles[profile];

  console.log(`Starting CampusCore observability seed (${profile})...`);
  const { curriculum, courseRecords, classrooms, semesters } =
    await ensureAcademicShape();
  const students = await ensureStudents(config.students, curriculum.id);
  const sections = await ensureSections({
    courseRecords,
    classrooms,
    semesters,
    sectionsPerCourse: config.sectionsPerCourse,
  });
  await ensureAcademicActivity(profile, students, sections);
  await ensureFinanceAndNotifications(profile, students, semesters);
  await ensureAnnouncements(semesters);

  await prisma.auditLog.create({
    data: {
      action: 'OBSERVABILITY_SEED_APPLIED',
      entity: 'SeedProfile',
      entityId: profile,
      description: `Applied CampusCore ${profile} observability seed profile.`,
    },
  });

  console.log(
    `CampusCore observability seed complete: ${students.length} students, ${sections.length} sections.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
