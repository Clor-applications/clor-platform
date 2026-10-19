import { PrismaClient } from '@prisma/client';
import { tenantScoped } from './tenantScope.js';

/* Told which company the request is for (utils/tenantScope.ts). */
export const prisma = tenantScoped(new PrismaClient({
  log: ['warn', 'error'],
}));
