'use strict';

const { DYNAMIC_CALL_TEMPLATES, callLinkOrigin } = require('./watch-call-links');

function checkCallTemplates(templates, { type, settings }) {
  const origin = callLinkOrigin(settings);
  if (!origin || !DYNAMIC_CALL_TEMPLATES[type]) throw new Error('A valid HTTPS call origin and sos/fall type are required.');
  return Object.entries(DYNAMIC_CALL_TEMPLATES[type]).map(([state, name]) => {
    const template = templates.find(item => item.name === name && item.language === 'en');
    const problems = [];
    if (!template) return { name, ready: false, problems: ['missing_english_template'] };
    if (template.status !== 'APPROVED') problems.push('not_approved');
    if (template.category !== 'UTILITY') problems.push('not_utility');
    const components = template.components || [];
    const header = components.find(item => item.type === 'HEADER');
    if (header && (header.format !== 'TEXT' || /\{\{/.test(header.text || ''))) problems.push('unsupported_header_parameters');
    const body = components.find(item => item.type === 'BODY');
    const parameters = [...String(body?.text || '').matchAll(/\{\{([^}]+)\}\}/g)].map(match => match[1]);
    if (parameters.join(',') !== '1,2,3,4') problems.push('body_parameters_must_be_1_to_4');
    const buttons = components.find(item => item.type === 'BUTTONS')?.buttons || [];
    if (buttons.length !== (state === 'unavailable' ? 1 : 2)) problems.push('wrong_button_count');
    if (buttons[0]?.type !== 'URL' || buttons[0]?.text !== 'Call watch' ||
        buttons[0]?.url !== `${origin}/call-watch/{{1}}`) problems.push('call_button_must_be_dynamic_url_at_0');
    if (state !== 'unavailable' && (buttons[1]?.type !== 'URL' ||
        buttons[1]?.url !== 'https://maps.google.com/?q={{1}}')) problems.push('map_button_must_be_dynamic_url_at_1');
    return { name, ready: problems.length === 0, problems };
  });
}

module.exports = { checkCallTemplates };
