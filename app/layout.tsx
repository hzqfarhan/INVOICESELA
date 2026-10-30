import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Invoice Studio · Seladevs',
  description: 'Good work deserves a great invoice. Create, save and print professional Seladevs invoices, online or offline.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Seladevs Invoices' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#df2337' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
