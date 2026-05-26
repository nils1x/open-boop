export const metadata = {
  title: "Boop — Personal Agent",
  description: "Telegram-based personal agent running on Vercel + Convex",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
