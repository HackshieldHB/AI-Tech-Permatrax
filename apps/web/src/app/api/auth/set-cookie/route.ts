import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { refreshToken, rememberMe } = body as { refreshToken?: string; rememberMe?: boolean };

  if (!refreshToken || typeof refreshToken !== 'string') {
    return NextResponse.json(
      { error: 'Invalid token' },
      { status: 400 }
    );
  }

  const response = NextResponse.json({ success: true });

  // FIX: httpOnly prevents JS access — XSS cannot steal refresh token.
  // FIX: when rememberMe is false, omit maxAge so the cookie becomes a session
  // cookie (cleared when the browser closes). When true, keep the 7-day window.
  // FIX: use sameSite=lax so the cookie is sent on top-level navigations (login
  // flow + ngrok). 'strict' broke same-origin POSTs from /api/auth/refresh on
  // some browsers.
  response.cookies.set('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(rememberMe ? { maxAge: 60 * 60 * 24 * 7 } : {}),
  });

  return response;
}
