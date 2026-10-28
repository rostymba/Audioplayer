import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  serverExternalPackages: ["ffmpeg-static"],
  // Vercel собирает функции на linux-x64: бинарник ffmpeg трейсится не всегда, а лишние
  // платформы onnxruntime раздувают функцию за лимит в 250 МБ.
  outputFileTracingIncludes: {
    "/api/radio/audio-guard/**": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/**",
    ],
  },
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      "./.cache/**",
      "./.diag/**",
    ],
  },
};

export default nextConfig;
