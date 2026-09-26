import { buildCloudApp } from './app';

const port = Number(process.env['CLOUD_PORT'] ?? 8788);
const phoneToken = process.env['CLOUD_TOKEN_PHONE'];
const tunnelToken = process.env['CCFERRY_TUNNEL_TOKEN'];
const pwaDir = process.env['CLOUD_PWA_DIR'] ?? null;

if (!phoneToken || !tunnelToken) {
  console.error('ccferry-cloud: CLOUD_TOKEN_PHONE and CCFERRY_TUNNEL_TOKEN must both be set');
  process.exit(1);
}

const app = await buildCloudApp({ tunnelToken, phoneToken, pwaDir });
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`ccferry-cloud listening on 127.0.0.1:${port} (behind Caddy)`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
