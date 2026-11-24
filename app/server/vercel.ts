// The server as a Vercel function. scripts/build-vercel.mjs bundles this file;
// Vercel serves the built web app itself and sends /api/* and /d/* here.

process.env.VERCEL ??= "1";
process.env.NODE_ENV ??= "production";

const { getRequestListener } = await import("@hono/node-server");
const { app } = await import("./index");

export default getRequestListener(app.fetch);
