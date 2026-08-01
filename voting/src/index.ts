import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = process.env.PUBLIC_URL;

const { httpServer } = createApp({ publicUrl: PUBLIC_URL });

httpServer.listen(PORT, () => {
  const url = PUBLIC_URL ?? `http://localhost:${PORT}`;
  console.log(`Enterprise Growth Simulator voting server listening on ${url}`);
  console.log(`Facilitator: ${url}/facilitator.html`);
  console.log(`Shared screen and phone-vote URLs are generated per room on "Create room".`);
  if (!PUBLIC_URL) {
    console.log(
      `Note: PUBLIC_URL is unset, so generated QR codes point at localhost — only reachable from this machine. ` +
        `Set PUBLIC_URL=http://<your-lan-ip>:${PORT} to let phones on the same network join.`,
    );
  }
});
