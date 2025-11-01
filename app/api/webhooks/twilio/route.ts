// File: app/api/webhooks/twilio/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, CallStatus, Prisma } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  // 1. Get the form-data from Twilio's request
  // Twilio webhooks send data as application/x-www-form-urlencoded
  const formData = await request.formData();
  const body = Object.fromEntries(formData);

  // 2. Get the Twilio signature from headers
  const twilioSignature = request.headers.get("X-Twilio-Signature");

  // 3. Get the exact URL Twilio called (this is the robust way)
  const webhookUrl = request.url;

  // 4. Validate the request (CRITICAL FOR SECURITY)
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    twilioSignature!,
    webhookUrl,
    body
  );

  if (!isValid) {
    console.error("Invalid Twilio signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // 5. Get the data we care about
  const callSid = body.CallSid as string;
  const amdStatus = body.AnsweringMachineDetectionStatus as string;

  let detectionResult: CallStatus;

  // 6. Translate Twilio's result to our enum
  switch (amdStatus) {
    case "human":
      detectionResult = "HUMAN";
      break;
    case "machine_start":
    case "machine_end_beep":
    case "machine_end_silence":
      detectionResult = "MACHINE";
      break;
    default:
      detectionResult = "UNKNOWN";
  }

  // 7. Update our database log
  try {
    await prisma.callLog.update({
      where: { twilioCallSid: callSid },
      data: {
        detectionResult: detectionResult,
        rawCallback: body as Prisma.JsonObject,
      },
    });

    return NextResponse.json({ status: "success" });
  } catch (error: any) {
    console.error("Webhook DB update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}