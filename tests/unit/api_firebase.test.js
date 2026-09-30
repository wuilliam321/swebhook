jest.mock('firebase-admin', () => ({
    credential: { cert: jest.fn() },
    initializeApp: jest.fn(),
    database: jest.fn()
}));

const admin = require('firebase-admin');
const { getReminders } = require('../../src/api/firebase');

test('cachea recordatorios 24 horas y comparte consultas simultáneas', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"test"}';
    const once = jest.fn()
        .mockResolvedValueOnce({ val: () => ({ reminder1: { title: 'Caja' } }) })
        .mockResolvedValueOnce({ val: () => ({ reminder1: { title: 'Caja' }, reminder2: { title: 'Luces' } }) });
    admin.database.mockReturnValue({ ref: jest.fn().mockReturnValue({ once }) });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    expect(await Promise.all([getReminders(), getReminders()])).toEqual([['Caja'], ['Caja']]);
    expect(once).toHaveBeenCalledTimes(1);

    now += 24 * 60 * 60 * 1000 - 1;
    expect(await getReminders()).toEqual(['Caja']);
    expect(once).toHaveBeenCalledTimes(1);

    now += 2;
    expect(await getReminders()).toEqual(['Caja', 'Luces']);
    expect(once).toHaveBeenCalledTimes(2);

    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    jest.restoreAllMocks();
});
