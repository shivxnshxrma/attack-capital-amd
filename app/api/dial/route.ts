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

  try {
    let call;

    if (strategy === "TWILIO_NATIVE") {
      // --- NATIVE STRATEGY (No change) ---
      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        machineDetection: "Enable",
        statusCallback: `${appUrl}/api/webhooks/twilio`,
        statusCallbackEvent: ["completed"],
        statusCallbackMethod: "POST",
        twiml: `<Response><Say>Connecting your call</Say></Response>`,
      });
    } else if (strategy === "HUGGINGFACE" || strategy === "GEMINI_FLASH") {
      
      // --- THIS IS THE FIX ---
      // We tell Twilio: "When the call is answered,
      // contact this URL to get your TwiML instructions."
      const twimlUrl = `${appUrl}/api/twiml?strategy=${strategy}`;
      console.log(`Using TwiML URL: ${twimlUrl}`);

      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        url: twimlUrl, // This is the correct parameter
        method: "POST",
      });
      // -----------------------

    } else {
      throw new Error("Invalid strategy");
    }

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