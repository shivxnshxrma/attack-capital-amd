// File: app/api/webhooks/twilio/route.ts
import { NextResponse, NextRequest } from "next/server"; // 1. Import NextRequest
import { PrismaClient, Prisma, CallStatus } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function POST(request: NextRequest) { // 2. Change type from Request to NextRequest
  const formData = await request.formData();
  const body = Object.fromEntries(formData);

  // --- THIS IS THE NEW VALIDATION LOGIC ---
  const twilioSignature = request.headers.get("X-Twilio-Signature");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  
  if (!forwardedHost || !forwardedProto) {
    console.error("Missing x-forwarded headers. Is ngrok running?");
    return NextResponse.json({ error: "Invalid proxy" }, { status: 400 });
  }

  // 3. This line will now work
  const webhookUrl = `${forwardedProto}://${forwardedHost}${request.nextUrl.pathname}`;
  
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    twilioSignature!,
    webhookUrl,
    body
  );
  
  if (!isValid) {
    console.error("Invalid Twilio signature. URL mismatch.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  // --- END NEW VALIDATION LOGIC ---

  const callSid = body.CallSid as string;
  if (!callSid) {
    return NextResponse.json({ error: "Missing CallSid" });
  }

  const call = await prisma.callLog.findUnique({
    where: { twilioCallSid: callSid },
  });

  if (!call) {
    return NextResponse.json({ error: "No call log found" });
  }

  try {
    if (call.strategyUsed === "TWILIO_NATIVE") {
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

    } else if (
      call.strategyUsed === "HUGGINGFACE" ||
      call.strategyUsed === "GEMINI_FLASH"
    ) {
      const recordingUrl = body.RecordingUrl as string;
      if (!recordingUrl) throw new Error("No RecordingUrl in webhook");

      const mediaUrl = `${recordingUrl}.wav`;
      const pythonServerUrl = process.env.PYTHON_SERVICE_URL;

      console.log(`Forwarding job for ${callSid} to ${pythonServerUrl}`);
      
      fetch(`${pythonServerUrl}/predict_from_url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callSid: callSid,
          recordingUrl: mediaUrl,
          strategy: call.strategyUsed,
        }),
      });

      console.log(`Forwarded job for ${callSid} (Strategy: ${call.strategyUsed})`);
    }

    return NextResponse.json({ status: "webhook received" });

  } catch (error: any) {
    console.error(`Webhook failed for ${callSid}:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}