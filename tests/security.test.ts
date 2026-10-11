import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import crypto from 'crypto';

describe('Application Security', () => {
  describe('Session Cookies', () => {
    it('should set HttpOnly and SameSite=Lax flags on session cookies', async () => {
      const res = await request(app).get('/');
      const cookies = res.headers['set-cookie'];
      
      if (cookies) {
        const sessionCookie = cookies.find((c: string) => c.startsWith('connect.sid='));
        if (sessionCookie) {
          expect(sessionCookie).toMatch(/HttpOnly/i);
          expect(sessionCookie).toMatch(/SameSite=Lax/i);
        }
      }
    });
  });

  describe('Webhook Security', () => {
    it('should reject webhook without signature', async () => {
      const res = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .send({ test: 'data' });
      
      expect(res.status).toBe(401);
    });

    it('should reject webhook with invalid signature', async () => {
      const { whatsappClient } = await import('../src/integrations/whatsapp/client.js');
      const originalSecret = whatsappClient.config.appSecret;
      whatsappClient.config.appSecret = 'test_secret_so_it_doesnt_mock';
      
      const res = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .set('x-hub-signature-256', 'sha256=invalid_signature_string_here')
        .send({ test: 'data' });
      
      expect(res.status).toBe(401);
      whatsappClient.config.appSecret = originalSecret;
    });
    
    it('should calculate and accept valid signature using rawBody', async () => {
      const { whatsappClient } = await import('../src/integrations/whatsapp/client.js');
      const originalSecret = whatsappClient.config.appSecret;
      whatsappClient.config.appSecret = 'test_secret_so_it_doesnt_mock';
      
      const payload = JSON.stringify({ test: 'valid data' });
      const secret = whatsappClient.config.appSecret;
      
      const signature = crypto.createHmac('sha256', secret).update(payload, 'utf-8').digest('hex');
      
      const res = await request(app)
        .post('/api/v1/whatsapp/webhook')
        .set('x-hub-signature-256', `sha256=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payload);
        
      expect(res.status).toBe(200);
      whatsappClient.config.appSecret = originalSecret;
    });
  });
  
  describe('Rate Limiting', () => {
    it('should include rate limit headers on customer login', async () => {
      const res = await request(app).get('/customer/login');
      // POST is rate limited
      const postRes = await request(app).post('/customer/login').send({ email: 'test@test.com', password: 'wrong' });
      expect(postRes.headers['x-ratelimit-limit']).toBeDefined();
    });
  });
});
