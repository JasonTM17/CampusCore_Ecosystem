import bcrypt from 'bcrypt';

// Generate bcrypt hash for password
const password = 'password123';
const saltRounds = 12;

async function hashPassword() {
  const hash = await bcrypt.hash(password, saltRounds);
  console.log('Password hash:', hash);
}

hashPassword().catch(console.error);
