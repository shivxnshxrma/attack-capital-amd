// File: app/api/twiml/route.ts
import { NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(request: Request) {
  console.log("--- TwiML Route Called ---"); // LOG 1

  const { searchParams } = new URL(request.url);
  const strategy = searchParams.get("strategy");
  console.log(`Strategy: ${strategy}`); // LOG 2

  const formData = await request.formData();
  const callSid = formData.get("CallSid");
  console.log(`CallSid: ${callSid}`); // LOG 3

  if (!strategy || !callSid) {
    console.error("TwiML Error: Missing strategy or CallSid");
    return new NextResponse("Missing strategy or CallSid", { status: 400 });
  }

  // Get the ngrok URL from Vercel env vars
  const pythonServerUrl = process.env.PYTHON_SERVICE_URL;
  console.log(`PYTHON_SERVICE_URL: ${pythonServerUrl}`); // LOG 4

  if (!pythonServerUrl) {
    console.error("TwiML Error: PYTHON_SERVICE_URL not configured");
    return new NextResponse("Python service URL not configured", { status: 500 });
  }

  // Build the WebSocket URL pointing to your Python server
  let pythonHost;
  try {
    pythonHost = new URL(pythonServerUrl).host; // e.g., "random.ngrok-free.app"
  } catch (e) {
    console.error("TwiML Error: Invalid PYTHON_SERVICE_URL", e);
    return new NextResponse("Invalid Python service URL", { status: 500 });
  }

const streamUrl = `wss://${pythonHost}/ws?callSid=${callSid}&strategy=${strategy}`;
  console.log(`Generated Stream URL: ${streamUrl}`); // LOG 5

  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  connect.stream({
    url: streamUrl,
  });

  console.log("Sending TwiML response to Twilio..."); // LOG 6

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}