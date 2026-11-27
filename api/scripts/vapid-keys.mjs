// Prints a new VAPID key pair for push notifications. Run once: npm run vapid-keys -w api
// Put both values in Netlify → Project configuration → Environment variables, then redeploy.
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`);
