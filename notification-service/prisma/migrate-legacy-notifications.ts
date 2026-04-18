import { PrismaClient } from '@prisma/client';

function getTargetSchema(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get('schema') ?? 'public';

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(schema)) {
    throw new Error(`Unsupported schema name for migration: ${schema}`);
  }

  return schema;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient();
  const targetSchema = getTargetSchema(databaseUrl);

  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${targetSchema}"."Notification"
        ("id", "userId", "title", "message", "type", "link", "isRead", "readAt", "createdAt", "updatedAt")
      SELECT
        "id", "userId", "title", "message", "type", "link", "isRead", "readAt", "createdAt", NOW()
      FROM public."Notification"
      ON CONFLICT ("id") DO NOTHING
    `);
    console.log(
      `Legacy notification migration completed into schema "${targetSchema}"`,
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01') {
      console.log(
        'Legacy notification table not found in public schema, skipping one-time migration',
      );
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
