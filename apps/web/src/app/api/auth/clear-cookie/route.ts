// apps/web/src/app/api/auth/clear-cookie/route.ts
// FIX: proper Next.js App Router API route handler
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json(
    { message: 'Cookie cleared' },
    { status: 200 }
  );

  // FIX: clear auth cookies
  response.cookies.set('accessToken', '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,
    path:     '/',
  });
  response.cookies.set('refreshToken', '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,
    path:     '/',
  });

  return response;
}

export async function GET(): Promise<NextResponse> {
  // FIX: also handle GET for compatibility
  return POST();
}
