import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __mangoPrisma__: PrismaClient | undefined;
}

export function getPrismaClient() {
  if (!globalThis.__mangoPrisma__) {
    console.log('DEBUG: Initializing Prisma with DATABASE_URL:', process.env.DATABASE_URL ? (process.env.DATABASE_URL.includes('@') ? '***@' + process.env.DATABASE_URL.split('@')[1] : process.env.DATABASE_URL) : 'NOT SET');
    globalThis.__mangoPrisma__ = new PrismaClient();
  }

  return globalThis.__mangoPrisma__;
}
