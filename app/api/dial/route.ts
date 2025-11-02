// File: app/api/dial/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth"; // Your auth config
import { PrismaClient } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const { phoneNumber, strategy } = await request.json();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  // --- This is the new "master" webhook URL for all strategies ---
  const webhookUrl = `${appUrl}/api/webhooks/twilio`;

  try {
    let callOptions: any = {
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER!,
      statusCallback: webhookUrl,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST",
    };

    if (strategy === "TWILIO_NATIVE") {
      callOptions.machineDetection = "Enable";
      callOptions.twiml = `<Response><Say>Connecting</Say></Response>`;
      
    } else if (strategy === "HUGGINGFACE" || strategy === "GEMINI_FLASH") {
      // For AI strategies, just record the call.
      // The webhook will do the analysis after.
      callOptions.record = true; 
      callOptions.twiml = `<Response><Say>Hello, you are being recorded for analysis.</Say><Hangup /></Response>`;
    }

    // Create the call
    const call = await client.calls.create(callOptions);

    // Log to our database
    await prisma.callLog.create({
      data: {
        toNumber: phoneNumber,
        fromNumber: process.env.TWILIO_PHONE_NUMBER!,
        twilioCallSid: call.sid,
        strategyUsed: strategy as any,
        detectionResult: "INITIATED",
      },
    });

    return NextResponse.json({ status: "dialed", callSid: call.sid });
  } catch (error: any) {
    console.error("Twilio call failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}