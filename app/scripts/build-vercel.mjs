// Builds Paperstall for Vercel (Build Output API): the web app as static files
// and the server as one Node function in Frankfurt, next to the database.
// Deploy with: node scripts/build-vercel.mjs && vercel deploy --prebuilt --prod

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const out = ".vercel/output";
const fn = `${out}/functions/api.func`;

execSync("pnpm build", { stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
cpSync("dist", `${out}/static`, { recursive: true });

mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["server/vercel.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Optional native add-ons the libraries fall back from.
  external: ["pg-native", "sodium-native"],
  // Some bundled libraries are CommonJS and call require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      maxDuration: 60,
      memory: 1024,
      regions: ["fra1"],
    },
    null,
    2,
  ),
);

const security = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "/(.*)", headers: security, continue: true },
        { src: "/api(/.*)?", dest: "/api" },
        { src: "/d/(.*)", dest: "/api" },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log(`built ${out}`);
