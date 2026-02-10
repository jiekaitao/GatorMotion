import { NextRequest, NextResponse } from "next/server";
import { getDemoResponse, type DemoSession } from "@/lib/demo-data";

function isDemoMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
    !process.env.MONGODB_URI
  );
}

export async function middleware(request: NextRequest) {
  if (!isDemoMode()) {
    return NextResponse.next();
  }

  const { pathname, searchParams } = request.nextUrl;
  const method = request.method;

  // Parse demo_session cookie
  let session: DemoSession | null = null;
  const sessionCookie = request.cookies.get("demo_session")?.value;
  if (sessionCookie) {
    try {
      session = JSON.parse(sessionCookie) as DemoSession;
    } catch {
      session = null;
    }
  }

  // Parse request body for POST/PATCH/PUT/DELETE
  let body: unknown = null;
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
  }

  const demoResponse = getDemoResponse(method, pathname, searchParams, body, session);

  const response = NextResponse.json(demoResponse.body, { status: demoResponse.status });

  // Set cookies if requested
  if (demoResponse.setCookie) {
    const { name, value, options } = demoResponse.setCookie;
    response.cookies.set(name, value, {
      path: (options?.path as string) || "/",
      maxAge: (options?.maxAge as number) || 60 * 60 * 24 * 7,
      httpOnly: false,
      sameSite: "lax",
    });
    // Also set pt_session=demo so any stray getSession() calls see a cookie
    response.cookies.set("pt_session", "demo", {
      path: "/",
      maxAge: (options?.maxAge as number) || 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: "lax",
    });
  }

  // Clear cookies if requested
  if (demoResponse.clearCookies) {
    for (const cookieName of demoResponse.clearCookies) {
      response.cookies.set(cookieName, "", { path: "/", maxAge: 0 });
    }
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
