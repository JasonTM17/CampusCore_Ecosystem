-- Complete Seed Data for CampusCore

-- Roles (using existing system roles)
INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") 
SELECT gen_random_uuid(), 'STUDENT', 'Student role', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'STUDENT');
INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") 
SELECT gen_random_uuid(), 'LECTURER', 'Lecturer role', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'LECTURER');
INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") 
SELECT gen_random_uuid(), 'ADMIN', 'Admin role', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'ADMIN');

-- Get Faculty IDs
DO $$
DECLARE 
  fcs_id UUID;
  fe_id UUID;
  fba_id UUID;
BEGIN
  SELECT id INTO fcs_id FROM "Faculty" WHERE code = 'FCS';
  SELECT id INTO fe_id FROM "Faculty" WHERE code = 'FE';
  SELECT id INTO fba_id FROM "Faculty" WHERE code = 'FBA';
  
  IF fcs_id IS NULL THEN
    INSERT INTO "Faculty" (id, name, code, description, "isActive", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Faculty of Computer Science', 'FCS', 'Faculty of Computer Science and Information Technology', true, NOW(), NOW())
    RETURNING id INTO fcs_id;
  END IF;
  
  IF fe_id IS NULL THEN
    INSERT INTO "Faculty" (id, name, code, description, "isActive", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Faculty of Engineering', 'FE', 'Faculty of Engineering', true, NOW(), NOW())
    RETURNING id INTO fe_id;
  END IF;
  
  IF fba_id IS NULL THEN
    INSERT INTO "Faculty" (id, name, code, description, "isActive", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Faculty of Business Administration', 'FBA', 'Faculty of Business Administration', true, NOW(), NOW())
    RETURNING id INTO fba_id;
  END IF;
END $$;

-- Get Academic Year ID
DO $$
DECLARE 
  ay_id UUID;
BEGIN
  SELECT id INTO ay_id FROM "AcademicYear" WHERE year = 2025;
  IF ay_id IS NULL THEN
    INSERT INTO "AcademicYear" (id, year, "startDate", "endDate", "isCurrent", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 2025, '2025-01-15', '2025-12-15', true, NOW(), NOW())
    RETURNING id INTO ay_id;
  END IF;
END $$;

-- Get Semester IDs
DO $$
DECLARE 
  ay_id UUID;
  spring_id UUID;
  fall_id UUID;
BEGIN
  SELECT id INTO ay_id FROM "AcademicYear" WHERE year = 2025;
  
  SELECT id INTO spring_id FROM "Semester" WHERE name = 'Spring 2025';
  IF spring_id IS NULL AND ay_id IS NOT NULL THEN
    INSERT INTO "Semester" (id, name, type, "academicYearId", "startDate", "endDate", "registrationStart", "registrationEnd", "addDropStart", "addDropEnd", status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Spring 2025', 'SPRING', ay_id, '2025-01-15', '2025-05-15', '2024-12-01', '2025-01-14', '2025-01-15', '2025-02-01', 'IN_PROGRESS', NOW(), NOW())
    RETURNING id INTO spring_id;
  END IF;
  
  SELECT id INTO fall_id FROM "Semester" WHERE name = 'Fall 2025';
  IF fall_id IS NULL AND ay_id IS NOT NULL THEN
    INSERT INTO "Semester" (id, name, type, "academicYearId", "startDate", "endDate", "registrationStart", "registrationEnd", status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'Fall 2025', 'FALL', ay_id, '2025-09-01', '2025-12-31', '2025-07-01', '2025-08-31', 'CLOSED', NOW(), NOW())
    RETURNING id INTO fall_id;
  END IF;
END $$;

\echo 'Basic seed data completed!'
