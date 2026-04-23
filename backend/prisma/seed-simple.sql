-- Simple seed data for CampusCore
-- Run: docker exec -i campuscore-db psql -U campuscore -d campuscore < seed-simple.sql

-- Check if data already exists
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "AcademicYear") > 0 THEN
    RAISE NOTICE 'Data already exists, skipping seed';
    RETURN;
  END IF;
END $$;

-- Insert Academic Year
INSERT INTO "AcademicYear" (id, year, "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 2025, '2025-01-15', '2025-12-15', true, NOW(), NOW());

-- Insert Semester
INSERT INTO "Semester" (id, name, "nameEn", "nameVi", type, "academicYearId", "startDate", "endDate", status, "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Spring 2025', 'Spring 2025', 'Học kỳ Xuân 2025', 'SPRING', id, '2025-01-15', '2025-05-15', 'IN_PROGRESS', NOW(), NOW()
FROM "AcademicYear" WHERE year = 2025;

-- Insert Faculty
INSERT INTO "Faculty" (id, name, "nameEn", "nameVi", code, description, "descriptionEn", "descriptionVi", "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Faculty of Computer Science', 'Faculty of Computer Science', 'Khoa Khoa học máy tính', 'FCS', 'Computer Science', 'Computer Science', 'Khoa học máy tính', true, NOW(), NOW());

-- Insert Roles
INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") 
SELECT gen_random_uuid(), 'STUDENT', 'Student', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'STUDENT');

INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") 
SELECT gen_random_uuid(), 'LECTURER', 'Lecturer', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'LECTURER');

INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") 
SELECT gen_random_uuid(), 'ADMIN', 'Admin', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'ADMIN');

-- Insert Department
INSERT INTO "Department" (id, name, "nameEn", "nameVi", code, description, "descriptionEn", "descriptionVi", "facultyId", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Computer Science', 'Computer Science', 'Khoa học máy tính', 'CS', 'CS Department', 'CS Department', 'Khoa Khoa học máy tính', id, true, NOW(), NOW()
FROM "Faculty" WHERE code = 'FCS';

-- Insert Admin User (password: admin123)
INSERT INTO "User" (id, email, "firstName", "lastName", password, status, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'admin@campuscore.edu', 'Admin', 'User', '$2a$10$rVqKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx', 'ACTIVE', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Insert Student User (password: password123)
INSERT INTO "User" (id, email, "firstName", "lastName", password, status, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'student1@campuscore.edu', 'Test', 'Student', '$2a$10$rVqKxKxKxKxKxKxKxKeOvQ9xKxKxKxKxKxKxKxKxKxKxKxKx', 'ACTIVE', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Insert Student Profile
INSERT INTO "Student" (id, "userId", "studentId", "curriculumId", year, status, "admissionDate", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u.id, 'CS001', NULL, 1, 'ACTIVE', '2024-09-01', NOW(), NOW()
FROM "User" u WHERE u.email = 'student1@campuscore.edu'
ON CONFLICT DO NOTHING;

-- Assign roles
INSERT INTO "UserRole" (id, "userId", "roleId", "createdAt")
SELECT gen_random_uuid(), u.id, r.id, NOW()
FROM "User" u, "Role" r
WHERE u.email = 'student1@campuscore.edu' AND r.name = 'STUDENT'
ON CONFLICT DO NOTHING;

INSERT INTO "UserRole" (id, "userId", "roleId", "createdAt")
SELECT gen_random_uuid(), u.id, r.id, NOW()
FROM "User" u, "Role" r
WHERE u.email = 'admin@campuscore.edu' AND r.name = 'ADMIN'
ON CONFLICT DO NOTHING;

\echo 'Seed data inserted successfully!'
