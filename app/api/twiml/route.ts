// File: app/api/twiml/route.ts
import { NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(request: Request) {
  console.log("--- TwiML Route Called ---");

  const { searchParams } = new URL(request.url);
  const strategy = searchParams.get("strategy");

  const formData = await request.formData();
  const callSid = formData.get("CallSid");

  if (!strategy || !callSid) {
    console.error("TwiML Error: Missing strategy or CallSid");
    return new NextResponse("Missing strategy or CallSid", { status: 400 });
  }

  // Get the ngrok URL from Vercel env vars
  const pythonServerUrl = process.env.PYTHON_SERVICE_URL;
  if (!pythonServerUrl) {
    console.error("TwiML Error: PYTHON_SERVICE_URL not configured");
    return new NextResponse("Python service URL not configured", { status: 500 });
  }

  // --- THIS IS THE FIX ---
  // We need the full wss:// URL, not just the host.
  // We also replace "https" with "wss"
  const pythonHost = pythonServerUrl.replace("https://", "wss://");
  const streamUrl = `${pythonHost}/ws?callSid=${callSid}&strategy=${strategy}`;
  // -----------------------

  console.log(`Generated Stream URL: ${streamUrl}`);

  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  connect.stream({
    url: streamUrl,
  });

  console.log("Sending TwiML response to Twilio...");

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}