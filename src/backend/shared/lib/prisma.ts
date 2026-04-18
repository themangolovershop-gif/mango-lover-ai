import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __mangoPrisma__: PrismaClient | undefined;
}

export function getPrismaClient() {
  if (!globalThis.__mangoPrisma__) {
    globalThis.__mangoPrisma__ = new PrismaClient();
  }

  return globalThis.__mangoPrisma__;
}
