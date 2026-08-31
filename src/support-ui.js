'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('./db');

const PROJECT_NAMES = {
  ltt: 'Litematica Together',
  simpleTranslator: 'Simple Translator',
};

async function styleSupportPanel(guild) {
  const cfg = db.guild(guild.id);
  const support = cfg.supportChannelId
    ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null)
    : null;
  if (!support?.isTextBased()) return;

  const messages = await support.messages.fetch({ limit: 100 }).catch(() => null);
  const panels = messages?.filter(message => (
    message.author.id === guild.client.user.id
    && message.components.some(row => row.components.some(component => (
      ['support_open', 'support_open_ltt', 'support_open_st'].includes(component.customId)
    )))
  ));
  if (!panels?.size) return;

  const panel = [...panels.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
  await panel.edit({
    embeds: [new EmbedBuilder()
      .setTitle('Support / Поддержка')
      .setDescription([
        '**Сначала выберите мод, насчёт которого у вас вопрос.**',
        '**First choose the mod your question is about.**',
        '',
        'После выбора откроется форма с полями:',
        '• смысл вопроса / topic;',
        '• версии Minecraft, мода и loader;',
        '• сам вопрос или описание проблемы;',
        '• срочность и что уже пробовали;',
        '• дополнительная информация, логи и шаги воспроизведения.',
        '',
        'One open ticket per user.',
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('support_open_ltt')
        .setLabel('Litematica Together')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('support_open_st')
        .setLabel('Simple Translator')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('donate_show')
        .setLabel('Donate')
        .setStyle(ButtonStyle.Success),
    )],
  }).catch(() => {});
}

function projectSupportModal(projectKey) {
  const projectName = projectKey === 'simpleTranslator'
    ? PROJECT_NAMES.simpleTranslator
    : PROJECT_NAMES.ltt;

  const modal = new ModalBuilder()
    .setCustomId('support_modal')
    .setTitle(`${projectName} Support`);

  const fields = [
    {
      id: 'topic',
      label: 'Смысл вопроса / Topic',
      style: TextInputStyle.Short,
      placeholder: 'Bug / установка / совместимость / предложение...',
      required: true,
      value: `${projectName} — `,
      maxLength: 200,
    },
    {
      id: 'versions',
      label: 'Версии / Versions',
      style: TextInputStyle.Short,
      placeholder: 'Minecraft, mod, loader, dependencies',
      required: true,
      maxLength: 200,
    },
    {
      id: 'problem',
      label: 'Сам вопрос / Your question',
      style: TextInputStyle.Paragraph,
      placeholder: 'Подробно опишите вопрос, проблему и ожидаемый результат.',
      required: true,
      maxLength: 1000,
    },
    {
      id: 'tried',
      label: 'Срочность + что пробовали / Urgency',
      style: TextInputStyle.Paragraph,
      placeholder: 'Low / Normal / High / Critical — почему срочно и что уже пробовали',
      required: true,
      maxLength: 1000,
    },
    {
      id: 'extra',
      label: 'Дополнительно / Extra',
      style: TextInputStyle.Paragraph,
      placeholder: 'Ошибки, логи, шаги воспроизведения и другая полезная информация.',
      required: false,
      maxLength: 1000,
    },
  ];

  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style)
      .setPlaceholder(field.placeholder)
      .setRequired(field.required)
      .setMaxLength(field.maxLength);
    if (field.value) input.setValue(field.value);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  return modal;
}

module.exports = {
  PROJECT_NAMES,
  projectSupportModal,
  styleSupportPanel,
};
