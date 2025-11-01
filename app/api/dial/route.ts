import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth"; // Your auth config
import { PrismaClient } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  // 1. Get the authenticated user
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Initialize Twilio client
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  // 3. Get form data
  const { phoneNumber, strategy } = await request.json();

  // This is your Vercel URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    // 4. Create the call
    const call = await client.calls.create({
      to: phoneNumber, // This is where the error came from
      from: process.env.TWILIO_PHONE_NUMBER!,
      
      machineDetection: "Enable", 
      statusCallback: `${appUrl}/api/webhooks/twilio`,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST",
      
      twiml: `<Response><Say>Connecting your call</Say></Response>`,
    });

    // 5. Log the call to our database
    await prisma.callLog.create({
      data: {
        toNumber: phoneNumber,
        fromNumber: process.env.TWILIO_PHONE_NUMBER!,
        twilioCallSid: call.sid,
        strategyUsed: "TWILIO_NATIVE",
        detectionResult: "INITIATED",
      },
    });

    return NextResponse.json({ status: "dialed", callSid: call.sid });
  } catch (error: any) {
    console.error("Twilio call failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}