import axios from 'axios';

describe('backend operational smoke journey', () => {
  it('exposes liveness without requiring database credentials', async () => {
    const res = await axios.get('/api/health/live');

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
