-- Seed data for CampusCore
-- Run this with: docker exec -i campuscore-db psql -U campuscore -d campuscore < seed.sql

-- Create Academic Year
INSERT INTO "AcademicYear" (id, year, "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 2025, '2025-01-15', '2025-12-15', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Create Semesters
INSERT INTO "Semester" (id, name, "nameEn", "nameVi", type, "academicYearId", "startDate", "endDate", "registrationStart", "registrationEnd", "addDropStart", "addDropEnd", status, "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Spring 2025', 'Spring 2025', 'Học kỳ Xuân 2025', 'SPRING', ay.id, '2025-01-15', '2025-05-15', '2024-12-01', '2025-01-14', '2025-01-15', '2025-02-01', 'IN_PROGRESS', NOW(), NOW()
FROM "AcademicYear" ay WHERE ay.year = 2025
ON CONFLICT DO NOTHING;

INSERT INTO "Semester" (id, name, "nameEn", "nameVi", type, "academicYearId", "startDate", "endDate", "registrationStart", "registrationEnd", status, "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Fall 2025', 'Fall 2025', 'Học kỳ Thu 2025', 'FALL', ay.id, '2025-09-01', '2025-12-31', '2025-07-01', '2025-08-31', 'CLOSED', NOW(), NOW()
FROM "AcademicYear" ay WHERE ay.year = 2025
ON CONFLICT DO NOTHING;

-- Create Faculty
INSERT INTO "Faculty" (id, name, "nameEn", "nameVi", code, description, "descriptionEn", "descriptionVi", "isActive", "createdAt", "updatedAt")
VALUES 
  (gen_random_uuid(), 'Faculty of Computer Science', 'Faculty of Computer Science', 'Khoa Khoa học máy tính', 'FCS', 'Faculty of Computer Science and Information Technology', 'Faculty of Computer Science and Information Technology', 'Khoa Khoa học máy tính và Công nghệ thông tin', true, NOW(), NOW()),
  (gen_random_uuid(), 'Faculty of Engineering', 'Faculty of Engineering', 'Khoa Kỹ thuật', 'FE', 'Faculty of Engineering', 'Faculty of Engineering', 'Khoa Kỹ thuật', true, NOW(), NOW()),
  (gen_random_uuid(), 'Faculty of Business Administration', 'Faculty of Business Administration', 'Khoa Quản trị kinh doanh', 'FBA', 'Faculty of Business Administration', 'Faculty of Business Administration', 'Khoa Quản trị kinh doanh', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Create Roles
INSERT INTO "Role" (id, name, description, "isSystemRole", "createdAt", "updatedAt") VALUES 
  (gen_random_uuid(), 'SUPER_ADMIN', 'Super Admin role', false, NOW(), NOW()),
  (gen_random_uuid(), 'ADMIN', 'Admin role', false, NOW(), NOW()),
  (gen_random_uuid(), 'REGISTRAR', 'Registrar role', false, NOW(), NOW()),
  (gen_random_uuid(), 'FINANCE_OFFICER', 'Finance Officer role', false, NOW(), NOW()),
  (gen_random_uuid(), 'LECTURER', 'Lecturer role', false, NOW(), NOW()),
  (gen_random_uuid(), 'STUDENT', 'Student role', false, NOW(), NOW()),
  (gen_random_uuid(), 'GUEST', 'Guest role', false, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

\echo 'Seed data inserted successfully!'
