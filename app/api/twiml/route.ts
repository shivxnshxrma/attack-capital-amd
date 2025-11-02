// File: app/api/twiml/route.ts
import { NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const strategy = searchParams.get("strategy");

  // Get the CallSid from the form data Twilio POSTs to this route
  const formData = await request.formData();
  const callSid = formData.get("CallSid");

  if (!strategy || !callSid) {
    return new NextResponse("Missing strategy or CallSid", { status: 400 });
  }

  // --- THIS IS THE FIX ---
  // Get the ngrok URL from Vercel env vars
  const pythonServerUrl = process.env.PYTHON_SERVICE_URL; 
  if (!pythonServerUrl) {
    return new NextResponse("Python service URL not configured", { status: 500 });
  }

  // Build the WebSocket URL pointing to your Python server
  const streamUrl = `wss://${new URL(pythonServerUrl).host}/ws?callSid=${callSid}&strategy=${strategy}`;
  // --- END FIX ---
  // Create the TwiML response
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  connect.stream({
    url: streamUrl,
  });

  // Send the TwiML back to Twilio
  return new NextResponse(response.toString(), {
    headers: {
      "Content-Type": "text/xml",
    },
  });
}