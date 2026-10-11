import crypto from 'crypto';
console.log('--- GENERATED CRYPTOGRAPHIC SECRETS ---');
console.log(`SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`);
console.log(`COOKIE_SECRET=${crypto.randomBytes(32).toString('hex')}`);
