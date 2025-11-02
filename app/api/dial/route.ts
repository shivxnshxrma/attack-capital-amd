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

  // File: app/api/dial/route.ts
// ... (keep all imports and the code above the try...catch block) ...

  try {
    let call;
    const appHost = new URL(appUrl!).host; // Gets "your-project.vercel.app"
    
    // --- THIS IS THE NEW LOGIC ---
    if (strategy === "TWILIO_NATIVE") {
      // Use the old method
      console.log("Using TWILIO_NATIVE strategy");
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
      // Use the NEW streaming method
      console.log(`Using ${strategy} strategy`);
      
      // We must pass the CallSid to the stream URL
      // But we don't have the CallSid until *after* the call is created.
      // So we use TwiML to <Redirect> after creation.
      
      // 1. Create the call, pointing to a temporary TwiML bin
      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        // This TwiML just tells Twilio to fetch *new* instructions
        // from our /api/twiml route, and passes the CallSid
        twiml: `<Response><Redirect method="POST">${appUrl}/api/twiml?strategy=${strategy}</Redirect></Response>`,
      });
    } else {
      throw new Error("Invalid strategy");
    }
    // ----------------------------

    // Log the call to our database
    await prisma.callLog.create({
      data: {
        toNumber: phoneNumber,
        fromNumber: process.env.TWILIO_PHONE_NUMBER!,
        twilioCallSid: call.sid,
        strategyUsed: strategy as any, // Use the dynamic strategy
        detectionResult: "INITIATED",
      },
    });

    return NextResponse.json({ status: "dialed", callSid: call.sid });
  } catch (error: any) {
    console.error("Twilio call failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
// ... (keep the closing '}') ...
}