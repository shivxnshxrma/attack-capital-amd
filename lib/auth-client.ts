// File: lib/auth-client.ts
"use client";
import { createAuthClient } from "better-auth/react";

// This exports all the React hooks like useSession, signIn, signOut
export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  listSessions,
} = createAuthClient();