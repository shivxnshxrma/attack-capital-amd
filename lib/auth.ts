import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

// Use a single, cached Prisma client
const prisma = new PrismaClient();

export const auth = betterAuth({
  
  // --- THIS IS THE FIX ---
  // The adapter's second argument is for the database 'provider' type,
  // not the model names.
  database: prismaAdapter(prisma, {
    provider: "postgresql", // We are using Postgres
  }),
  // ---------------------

  emailAndPassword: {
    enabled: true,
  },

  secret: process.env.AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
});