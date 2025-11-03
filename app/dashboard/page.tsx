// File: app/dashboard/page.tsx
"use client";

import { useState } from "react"; // 1. Remove useEffect
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [phoneNumber, setPhoneNumber] = useState("");
  const [strategy, setStrategy] = useState("TWILIO_NATIVE");
  const [status, setStatus] = useState("");

  // --- 2. REMOVED THE BAD useEffect REDIRECT ---

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const handleDial = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(`Calling ${phoneNumber}...`);
    
    try {
      const response = await fetch("/api/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, strategy }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to dial.");
      setStatus(`Call initiated (SID: ${data.callSid}). Waiting...`);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  // 3. This is the new, simpler loading check.
  // We wait for the hook to finish *and* for the session to exist.
  if (isPending || !session) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        Loading...
      </div>
    );
  }

  // 4. If we get here, we are not loading AND we have a session.
  // It is now safe to render the dashboard.
  return (
    <div className="min-h-screen bg-gray-50 text-black">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Attack Capital AMD</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {session.user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-4 sm:px-6 lg:px-8 mt-8">
        <div className="bg-white p-8 rounded-lg shadow-md w-full">
          <h2 className="text-2xl font-semibold mb-6">Dialer</h2>
          <form onSubmit={handleDial} className="space-y-6">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-gray-700"
              >
                Target Phone Number
              </label>
              <input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., +18007742678"
                required
              />
            </div>

            <div>
              <label
                htmlFor="strategy"
                className="block text-sm font-medium text-gray-700"
              >
                AMD Strategy
              </label>
              <select
                id="strategy"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="TWILIO_NATIVE">Strategy 1: Twilio Native</option>
                <option value="HUGGINGFACE">Strategy 3: Hugging Face</option>
                <option value="GEMINI_FLASH">Strategy 4: Gemini Flash</option>
                <option value="JAMBONZ" disabled>
                  Strategy 2: Jambonz (Not Implemented)
                </option>
              </select>
            </div>

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Dial Now
              </button>
            </div>
          </form>

          {status && (
            <p className="text-center text-gray-600 mt-6">{status}</p>
          )}
        </div>
      </main>
    </div>
  );
}