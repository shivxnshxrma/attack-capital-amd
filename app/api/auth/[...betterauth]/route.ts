import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth"; // Import the auth config

// The fix is here: We pass 'auth' directly, not 'auth.handler'
export const { GET, POST } = toNextJsHandler(auth);