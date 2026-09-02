import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Security & User Isolation (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let userACookie: string;
  let userBCookie: string;
  let userATxId: string;

  const userAData = {
    id: 111000111,
    first_name: 'UserA',
    username: 'usera',
    auth_date: Math.floor(Date.now() / 1000),
    hash: 'test_hash_a',
  };

  const userBData = {
    id: 222000222,
    first_name: 'UserB',
    username: 'userb',
    auth_date: Math.floor(Date.now() / 1000),
    hash: 'test_hash_b',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Clean up any lingering test users
    await prisma.user.deleteMany({
      where: { telegramId: { in: ['111000111', '222000222'] } },
    });
  }, 30000);

  afterAll(async () => {
    // Cleanup created test users
    await prisma.user.deleteMany({
      where: { telegramId: { in: ['111000111', '222000222'] } },
    });
    await app.close();
  }, 30000);

  it('Test 1: User A logs in and creates a transaction', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/telegram')
      .send(userAData)
      .expect(200);

    expect(loginRes.body.authenticated).toBe(true);
    const cookies = loginRes.get('Set-Cookie');
    expect(cookies).toBeDefined();
    userACookie = cookies![0].split(';')[0]; // Extract 'pulse_session=TOKEN'

    const createTxRes = await request(app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', [userACookie])
      .send({
        type: 'EXPENSE',
        merchant: 'UserA Coffee',
        amount: 500,
        categoryName: 'Food & Dining',
      })
      .expect(201);

    userATxId = createTxRes.body.id;
    expect(userATxId).toBeDefined();

    const getTxRes = await request(app.getHttpServer())
      .get('/api/transactions')
      .set('Cookie', [userACookie])
      .expect(200);

    expect(
      getTxRes.body.recentTransactions.some((t: any) => t.id === userATxId),
    ).toBe(true);
  }, 30000);

  it('Test 2: User B logs in and must NOT see User A transaction', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/telegram')
      .send(userBData)
      .expect(200);

    const cookies = loginRes.get('Set-Cookie');
    userBCookie = cookies![0].split(';')[0];

    const getTxRes = await request(app.getHttpServer())
      .get('/api/transactions')
      .set('Cookie', [userBCookie])
      .expect(200);

    expect(
      getTxRes.body.recentTransactions.some((t: any) => t.id === userATxId),
    ).toBe(false);
  }, 30000);

  it('Test 3: User B attempts GET on User A transaction -> must fail', async () => {
    await request(app.getHttpServer())
      .get(`/api/transactions/${userATxId}`)
      .set('Cookie', [userBCookie])
      .expect(404);
  }, 30000);

  it('Test 4: User B attempts DELETE on User A transaction -> must fail', async () => {
    await request(app.getHttpServer())
      .delete(`/api/transactions/${userATxId}`)
      .set('Cookie', [userBCookie])
      .expect(404);
  }, 30000);

  it('Test 5: User B attempts to manipulate userId in request body -> backend ignores it', async () => {
    const userA = await prisma.user.findUnique({
      where: { telegramId: '111000111' },
    });
    expect(userA).not.toBeNull();

    const createTxRes = await request(app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', [userBCookie])
      .send({
        userId: userA!.id, // Attempting mass assignment / user spoofing
        telegramId: '111000111',
        type: 'EXPENSE',
        merchant: 'Malicious Attempt',
        amount: 9999,
        categoryName: 'Food & Dining',
      })
      .expect(201);

    // Verify created transaction belongs strictly to User B, NOT User A
    expect(createTxRes.body.userId).not.toBe(userA!.id);

    const userB = await prisma.user.findUnique({
      where: { telegramId: '222000222' },
    });
    expect(createTxRes.body.userId).toBe(userB!.id);
  }, 30000);

  it('Test 6: User B changes query parameters ?userId=userA -> returns only User B transactions', async () => {
    const userA = await prisma.user.findUnique({
      where: { telegramId: '111000111' },
    });
    expect(userA).not.toBeNull();

    const res = await request(app.getHttpServer())
      .get(`/api/transactions?userId=${userA!.id}&telegramId=111000111`)
      .set('Cookie', [userBCookie])
      .expect(200);

    expect(
      res.body.recentTransactions.some((t: any) => t.id === userATxId),
    ).toBe(false);
  }, 30000);

  it('Test 7: Unauthenticated request -> returns 401 Unauthorized', async () => {
    await request(app.getHttpServer()).get('/api/transactions').expect(401);

    await request(app.getHttpServer())
      .post('/api/transactions')
      .send({ amount: 100 })
      .expect(401);
  }, 30000);

  it('Test 8: User A sets a budget; User B cannot read or overwrite User A budget', async () => {
    // User A sets a budget of 12000 on Food & Dining
    await request(app.getHttpServer())
      .post('/api/budgets')
      .set('Cookie', [userACookie])
      .send({
        categoryName: 'Food & Dining',
        monthlyLimit: 12000,
      })
      .expect(201);

    // User B reads budgets -> must not see User A's budget
    const userBBudgetsRes = await request(app.getHttpServer())
      .get('/api/budgets')
      .set('Cookie', [userBCookie])
      .expect(200);

    const userABudgetInB = userBBudgetsRes.body.find(
      (b: any) => Number(b.monthlyLimit) === 12000,
    );
    expect(userABudgetInB).toBeUndefined();
  }, 30000);

  it('Test 9: User A creates recurring rule; User B cannot view User A recurring rules', async () => {
    // User A creates recurring rent rule
    const recurringRes = await request(app.getHttpServer())
      .post('/api/recurring')
      .set('Cookie', [userACookie])
      .send({
        name: 'User A Rent Commitment',
        amount: 25000,
        type: 'EXPENSE',
        categoryName: 'Rent',
        dayOfMonth: 1,
      })
      .expect(201);

    expect(recurringRes.body.id).toBeDefined();

    // User B reads recurring rules -> must be empty or not include User A's rule
    const userBRecRes = await request(app.getHttpServer())
      .get('/api/recurring')
      .set('Cookie', [userBCookie])
      .expect(200);

    const userARecInB = userBRecRes.body.find(
      (r: any) => r.description === 'User A Rent Commitment',
    );
    expect(userARecInB).toBeUndefined();
  }, 30000);

  it('Test 10: CSV export isolation -> User B export only contains User B transactions', async () => {
    const userBCsvRes = await request(app.getHttpServer())
      .get('/api/export/csv')
      .set('Cookie', [userBCookie])
      .expect(200);

    expect(userBCsvRes.text).not.toContain('UserA Coffee');
  }, 30000);
});
