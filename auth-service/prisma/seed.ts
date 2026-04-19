import { PrismaClient, RoleName, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const permissionDefinitions = [
  ['users:read', 'users', 'read'],
  ['users:create', 'users', 'create'],
  ['users:update', 'users', 'update'],
  ['users:delete', 'users', 'delete'],
  ['roles:read', 'roles', 'read'],
  ['roles:update', 'roles', 'update'],
  ['permissions:read', 'permissions', 'read'],
  ['auth:sessions', 'auth', 'sessions'],
  ['audit-logs:read', 'audit-logs', 'read'],
] as const;

async function main() {
  const adminPasswordHash = await bcrypt.hash('admin123', 12);
  const defaultPasswordHash = await bcrypt.hash('password123', 12);

  const permissions = await Promise.all(
    permissionDefinitions.map(([name, module, action]) =>
      prisma.permission.upsert({
        where: { name },
        update: {
          module,
          action,
        },
        create: {
          name,
          module,
          action,
          description: `${module} ${action} permission`,
        },
      }),
    ),
  );

  const [
    superAdminRole,
    adminRole,
    registrarRole,
    financeOfficerRole,
    lecturerRole,
    studentRole,
    guestRole,
  ] = await Promise.all([
    upsertRole(RoleName.SUPER_ADMIN, 'Full platform access', true),
    upsertRole(RoleName.ADMIN, 'Administrative access'),
    upsertRole(RoleName.REGISTRAR, 'Registrar access'),
    upsertRole(RoleName.FINANCE_OFFICER, 'Finance operations access'),
    upsertRole(RoleName.LECTURER, 'Lecturer access'),
    upsertRole(RoleName.STUDENT, 'Student access'),
    upsertRole(RoleName.GUEST, 'Guest access'),
  ]);

  const privilegedRoles = [
    superAdminRole.id,
    adminRole.id,
    registrarRole.id,
    financeOfficerRole.id,
  ];

  await Promise.all(
    privilegedRoles.flatMap((roleId) =>
      permissions.map((permission) =>
        prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId, permissionId: permission.id },
          },
          update: {},
          create: { roleId, permissionId: permission.id },
        }),
      ),
    ),
  );

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@campuscore.edu' },
    update: {
      firstName: 'Admin',
      lastName: 'User',
      password: adminPasswordHash,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      isSuperAdmin: true,
    },
    create: {
      email: 'admin@campuscore.edu',
      firstName: 'Admin',
      lastName: 'User',
      password: adminPasswordHash,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      isSuperAdmin: true,
    },
  });

  const lecturerUser = await prisma.user.upsert({
    where: { email: 'john.doe@campuscore.edu' },
    update: {
      firstName: 'John',
      lastName: 'Doe',
      password: defaultPasswordHash,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
    create: {
      email: 'john.doe@campuscore.edu',
      firstName: 'John',
      lastName: 'Doe',
      password: defaultPasswordHash,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  const studentUser = await prisma.user.upsert({
    where: { email: 'student1@campuscore.edu' },
    update: {
      firstName: 'Michael',
      lastName: 'Brown',
      password: defaultPasswordHash,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
    create: {
      email: 'student1@campuscore.edu',
      firstName: 'Michael',
      lastName: 'Brown',
      password: defaultPasswordHash,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  await Promise.all([
    prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: adminUser.id,
          roleId: adminRole.id,
        },
      },
      update: {},
      create: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    }),
    prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: lecturerUser.id,
          roleId: lecturerRole.id,
        },
      },
      update: {},
      create: {
        userId: lecturerUser.id,
        roleId: lecturerRole.id,
      },
    }),
    prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: studentUser.id,
          roleId: studentRole.id,
        },
      },
      update: {},
      create: {
        userId: studentUser.id,
        roleId: studentRole.id,
      },
    }),
  ]);

  await prisma.lecturer.upsert({
    where: { userId: lecturerUser.id },
    update: {
      departmentId: 'seed-department-cs',
      employeeId: 'EMP001',
      title: 'Dr.',
      specialization: 'Artificial Intelligence',
      office: 'Room 301',
      phone: '1234567890',
      isActive: true,
    },
    create: {
      userId: lecturerUser.id,
      departmentId: 'seed-department-cs',
      employeeId: 'EMP001',
      title: 'Dr.',
      specialization: 'Artificial Intelligence',
      office: 'Room 301',
      phone: '1234567890',
      isActive: true,
    },
  });

  await prisma.student.upsert({
    where: { userId: studentUser.id },
    update: {
      studentId: 'CS001',
      curriculumId: 'seed-curriculum-cs',
      year: 1,
      status: 'ACTIVE',
      admissionDate: new Date('2024-09-01T00:00:00.000Z'),
    },
    create: {
      userId: studentUser.id,
      studentId: 'CS001',
      curriculumId: 'seed-curriculum-cs',
      year: 1,
      status: 'ACTIVE',
      admissionDate: new Date('2024-09-01T00:00:00.000Z'),
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: superAdminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: superAdminRole.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: guestRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: guestRole.id,
    },
  });
}

async function upsertRole(
  name: RoleName,
  description: string,
  isSystem = false,
) {
  return prisma.role.upsert({
    where: { name },
    update: { description, isSystem },
    create: { name, description, isSystem },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
