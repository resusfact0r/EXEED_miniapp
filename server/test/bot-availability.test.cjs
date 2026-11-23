const assert = require('node:assert/strict');
const { test } = require('node:test');
const telegram = require('../dist/bot/telegram-api');
const { BotService } = require('../dist/bot/bot.service');

test('private part replies work without a username lookup and group buttons still open the bot', async (t) => {
  const username = t.mock.method(telegram, 'getBotUsername', async () => 'TestPartsBot');
  const send = t.mock.method(telegram, 'callTelegram', async () => ({ ok: true }));
  const parts = { describe: async () => ({ text: 'Test part', orderable: [{ id: 'test-id', code: 'PART123' }] }) };
  const bot = new BotService(null, null, parts);

  for (const text of ['PART123', '/part PART123']) {
    await bot.handleUpdate({ message: { text, chat: { id: 1, type: 'private' } } });
    const [method, reply] = send.mock.calls.at(-1).arguments;
    assert.equal(method, 'sendMessage');
    assert.ok(reply.reply_markup.inline_keyboard[0][0].web_app.url);
  }
  assert.equal(username.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 2);

  await bot.handleUpdate({ message: { text: '@TestPartsBot PART123', chat: { id: -1, type: 'group' } } });
  const groupReply = send.mock.calls.at(-1).arguments[1];
  assert.equal(groupReply.chat_id, -1);
  assert.equal(groupReply.reply_markup.inline_keyboard[0][0].url, 'https://t.me/TestPartsBot?start=p_test-id');
});
