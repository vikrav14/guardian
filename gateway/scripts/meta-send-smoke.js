const { sendMetaTemplate } = require('../src/whatsapp-meta');

async function main() {
  const recipient = process.argv[2];
  const templateName = process.argv[3] || 'hello_world';
  const languageCode = process.argv[4] || 'en_US';

  if (!recipient) {
    console.error(
      'Usage: node scripts/meta-send-test.js <recipient-e164> [template-name] [language-code]'
    );
    process.exitCode = 2;
    return;
  }

  const result = await sendMetaTemplate(recipient, templateName, {
    languageCode,
  });

  if (!result.ok) {
    console.error('[meta-whatsapp] test failed:', result);
    process.exitCode = 1;
    return;
  }

  console.log('[meta-whatsapp] API accepted the message; awaiting delivery webhook');
  console.log(`messageId=${result.messageId || 'unknown'}`);
  console.log(`waId=${result.waId || 'unknown'}`);
}

main().catch((err) => {
  console.error('[meta-whatsapp] unexpected error:', err.message);
  process.exitCode = 1;
});
