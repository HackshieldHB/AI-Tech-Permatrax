import { AppLoadedLog } from '../components/AppLoadedLog';
import { BackendHealthBanner } from '../components/BackendHealthBanner';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google'; // MODIFIED: unified app font
import { Toaster } from 'sonner'; // MODIFIED: root-level toaster only
import './globals.css'; // MODIFIED: global styles only

export const metadata: Metadata = {
  title: 'PermaTrax — Fiber Construction Management', // MODIFIED: new product branding
  description: 'Enterprise platform for fiber optic construction permit management', // MODIFIED
};

const jakarta = Plus_Jakarta_Sans({ // NEW: requested typography setup
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jakarta',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body
        className={`${jakarta.variable}`} // MODIFIED: use Jakarta font variable
        style={{ margin: 0, padding: 0, fontFamily: 'var(--font-jakarta, sans-serif)' }} // NEW: keep body neutral
      >
        <AppLoadedLog />
        <BackendHealthBanner />
        {children}
        <Toaster
          position="bottom-right"
          richColors
          duration={4000}
          toastOptions={{
            style: {
              fontFamily: 'var(--font-jakarta, sans-serif)',
            },
          }}
        />
      </body>
    </html>
  );
}
