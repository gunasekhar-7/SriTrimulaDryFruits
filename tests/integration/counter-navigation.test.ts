import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import db from '../../src/database.js';
import { app } from '../../server.js';

describe('Counter Login Navigation & Storefront Isolation', () => {
  const timestamp = Date.now();
  const staffUsername = `staff_nav_${timestamp}`;
  const staffPassword = 'TestPassword123!';
  let staffUserId: number;

  beforeAll(() => {
    const hash = bcrypt.hashSync(staffPassword, 10);
    const u = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(staffUsername, hash, 'staff');
    staffUserId = u.lastInsertRowid as number;
  });

  afterAll(() => {
    try {
      if (staffUserId) {
        db.prepare('DELETE FROM shifts WHERE user_id = ?').run(staffUserId);
        db.prepare('DELETE FROM users WHERE id = ?').run(staffUserId);
      }
    } catch {}
  });

  it('allows unauthenticated visitors to view the public storefront at /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain("Sri Tirumala");
    expect(res.text).toContain("storefront-navbar");
  });

  it('redirects authenticated counter staff away from / to /sell', async () => {
    const agent = request.agent(app);

    // Get CSRF token from login page
    const loginPage = await agent.get('/login');
    expect(loginPage.status).toBe(200);
    const csrfMatch = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    // Log in as counter staff
    const loginRes = await agent.post('/login').send({
      username: staffUsername,
      password: staffPassword,
      _csrf: csrfToken,
    });
    expect(loginRes.status).toBe(302);
    expect(loginRes.header.location).toBe('/sell');

    // Access / while logged in
    const homeRes = await agent.get('/');
    expect(homeRes.status).toBe(302);
    expect(homeRes.header.location).toBe('/sell');

    // Access category storefront page while logged in
    const catRes = await agent.get('/category/Dry%20Fruits');
    expect(catRes.status).toBe(302);
    expect(catRes.header.location).toBe('/sell');

    // Access /stock and verify sidebar does not contain Storefront option and brand links to /sell
    const stockRes = await agent.get('/stock');
    expect(stockRes.status).toBe(200);
    expect(stockRes.text).toContain('sidebar-brand" href="/sell"');
    expect(stockRes.text).not.toContain('<a href="/" class="sidebar-link">');
    expect(stockRes.text).not.toContain('<span>Storefront</span>');
    expect(stockRes.text).toContain('Billing / POS');

    // Open shift to access /sell
    const openPage = await agent.get('/shift/open');
    const openCsrfMatch = openPage.text.match(/name="_csrf" value="([^"]+)"/);
    const openCsrf = openCsrfMatch ? openCsrfMatch[1] : '';
    await agent.post('/shift/open').send({ opening_cash: 500, _csrf: openCsrf });

    // Access /sell and verify sidebar
    const sellRes = await agent.get('/sell');
    expect(sellRes.status).toBe(200);
    expect(sellRes.text).toContain('sidebar-brand" href="/sell"');
    expect(sellRes.text).not.toContain('<a href="/" class="sidebar-link">');
    expect(sellRes.text).toContain('Billing / POS');

    // Logout redirects to /login
    const logoutRes = await agent.get('/logout');
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.header.location).toBe('/login');
  });
});
