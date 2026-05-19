import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get('permatrax_refresh')?.value || request.cookies.get('refreshToken')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  // Server-side only: call Nest directly (never exposed to the browser).
  const apiBase =
    process.env.INTERNAL_API_URL?.replace(/\/api\/?$/, '')?.replace(/\/$/, '') ||
    'http://127.0.0.1:3001';

  try {
    const body = await request.json().catch(() => ({}));
    const res = await fetch(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true', // FIX 4: ngrok interstitial bypass
      },
      body: JSON.stringify({ userId: body.userId, refreshToken }),
    });

    if (!res.ok) {
      // Refresh failed — clear cookie
      const errResponse = NextResponse.json(
        { error: 'Session expired' },
        { status: 401 }
      );
      errResponse.cookies.set('refreshToken', '', { maxAge: 0, path: '/' });
      errResponse.cookies.set('permatrax_refresh', '', { maxAge: 0, path: '/' });
      return errResponse;
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}
