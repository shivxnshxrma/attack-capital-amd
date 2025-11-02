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

  // Get our app's public URL
  const appHost = request.headers.get("host");
  
  // Build the final WebSocket URL
  const streamUrl = `wss://${appHost}/api/audiostream?callSid=${callSid}&strategy=${strategy}`;

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