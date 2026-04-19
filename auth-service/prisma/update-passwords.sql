-- Update user passwords
-- Run: docker exec -i campuscore-db psql -U campuscore -d campuscore < update-passwords.sql

-- Update admin password (password: admin123)
UPDATE "User" 
SET password = '$2b$12$xIgN/rwNlUQ.fyp6y9Or6us2Xd5JeM4UAYZpPyHqkm1squI8p319W', "updatedAt" = NOW()
WHERE email = 'admin@campuscore.edu';

-- Update student password (password: password123)
UPDATE "User" 
SET password = '$2b$12$xIgN/rwNlUQ.fyp6y9Or6us2Xd5JeM4UAYZpPyHqkm1squI8p319W', "updatedAt" = NOW()
WHERE email = 'student1@campuscore.edu';

\echo 'Passwords updated successfully!'
