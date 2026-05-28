const outfitCommand = require('../../../src/commands/outfit');
const { 
    createOutfitConversationState, 
    handleOutfitProgress, 
    buildOutfitSummary 
} = require('../../../src/outfit');
const { sendTelegramMessage } = require('../../../src/api/telegram');
const { commandQueue, processCommandQueue, isJobDuplicate } = require('../../../src/queue');

jest.mock('../../../src/outfit');
jest.mock('../../../src/api/telegram');
jest.mock('../../../src/queue');

describe('Command: Outfit', () => {
    let context;

    beforeEach(() => {
        jest.clearAllMocks();
        context = {
            chatId: 123,
            userCommandRaw: '/outfit',
            userCommand: '/outfit',
            botToken: 'token123',
            botName: 'testBot',
            chatStates: {},
            req: { body: { message: { chat: { id: 123 }, text: '/outfit' } } }
        };
        isJobDuplicate.mockReturnValue(false);
        commandQueue.push = jest.fn();
    });

    test('canHandle should return true for /outfit or OUTFIT_COLLECTING state', () => {
        expect(outfitCommand.canHandle('/outfit', null)).toBe(true);
        expect(outfitCommand.canHandle('', { state: 'OUTFIT_COLLECTING' })).toBe(true);
        expect(outfitCommand.canHandle('/other', null)).toBe(false);
    });

    test('execute Step 1: should set state and welcome user', async () => {
        createOutfitConversationState.mockReturnValue({ state: 'OUTFIT_COLLECTING', botName: 'testBot' });

        await outfitCommand.execute(context);

        expect(createOutfitConversationState).toHaveBeenCalledWith('testBot', 'token123');
        expect(context.chatStates[123]).toEqual({ state: 'OUTFIT_COLLECTING', botName: 'testBot' });
        expect(sendTelegramMessage).toHaveBeenCalledWith(123, expect.stringContaining('Vamos a crear un atuendo'), 'token123');
    });

    test('execute Step 2: should delegate to handleOutfitProgress', async () => {
        context.userCommand = 'ABC';
        context.req.body.message.text = 'ABC';
        context.chatStates[123] = { state: 'OUTFIT_COLLECTING', botToken: 'token123' };

        await outfitCommand.execute(context);

        expect(handleOutfitProgress).toHaveBeenCalledWith(expect.objectContaining({
            chatId: 123,
            text: 'ABC'
        }));
    });

    test('enqueueJob in Step 2: should push outfit job and notify', async () => {
        context.userCommand = 'final';
        context.chatStates[123] = { state: 'OUTFIT_COLLECTING', botToken: 'token123' };
        
        // Capture the enqueueJob callback
        let capturedEnqueueJob;
        handleOutfitProgress.mockImplementation(async (args) => {
            capturedEnqueueJob = args.enqueueJob;
        });

        await outfitCommand.execute(context);

        const jobPayload = {
            pieces: { fullBody: 'ABC' },
            useFullBody: true
        };
        buildOutfitSummary.mockReturnValue('Outfit Summary');

        await capturedEnqueueJob(jobPayload);

        expect(commandQueue.push).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'outfit',
            pieces: { fullBody: 'ABC' },
            summary: 'Outfit Summary'
        }));
        expect(processCommandQueue).toHaveBeenCalled();
    });
});
