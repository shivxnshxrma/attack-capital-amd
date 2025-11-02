// File: app/api/webhooks/twilio/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma, CallStatus } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function POST(request: Request) {
  const formData = await request.formData();
  const body = Object.fromEntries(formData);

  // 1. Validate the webhook
  const twilioSignature = request.headers.get("X-Twilio-Signature");
  const webhookUrl = request.url;
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    twilioSignature!,
    webhookUrl,
    body
  );
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // 2. Get the CallSid
  const callSid = body.CallSid as string;
  if (!callSid) {
    return NextResponse.json({ error: "Missing CallSid" });
  }

  // 3. Find the call in our DB
  const call = await prisma.callLog.findUnique({
    where: { twilioCallSid: callSid },
  });

  if (!call) {
    return NextResponse.json({ error: "No call log found" });
  }

  // 4. Handle based on strategy
  try {
    if (call.strategyUsed === "TWILIO_NATIVE") {
      // --- STRATEGY 1: NATIVE AMD ---
      const amdStatus = body.AnsweredBy as string;
      let result: CallStatus = "UNKNOWN";

      if (amdStatus === "human") result = "HUMAN";
      if (amdStatus === "machine_start") result = "MACHINE";

      await prisma.callLog.update({
        where: { twilioCallSid: callSid },
        data: {
          detectionResult: result,
          rawCallback: body as Prisma.JsonObject,
        },
      });
    } else if (call.strategyUsed === "HUGGINGFACE") {
      // --- STRATEGY 3: FORWARD TO PYTHON ---
      
      // 4a. Get the recording URL
      const recordingUrl = body.RecordingUrl as string;
      if (!recordingUrl) throw new Error("No RecordingUrl in webhook");

      const pythonServerUrl = process.env.PYTHON_SERVICE_URL;

      // 4b. Just send the *job* to the Python server.
      // We do NOT wait for it to finish.
      fetch(`${pythonServerUrl}/predict_from_url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callSid: callSid,
          recordingUrl: `${recordingUrl}.wav`, // Add .wav here
        }),
      });

      console.log(`Forwarded job for ${callSid} to Python service.`);
    }

    // Return a 200 OK to Twilio immediately.
    return NextResponse.json({ status: "webhook received" });

  } catch (error: any) {
    console.error(`Webhook failed for ${callSid}:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}