/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  // Proxifie les appels API : le frontend parle a /api (meme origine), ce qui
  // evite toute complication CORS et laisse le cookie httpOnly de refresh
  // circuler naturellement en developpement.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
