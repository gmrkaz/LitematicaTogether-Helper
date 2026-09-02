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

function supportProjectPickerPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x8B5CF6)
      .setTitle('🧩 Выберите мод / Choose a mod')
      .setDescription([
        'Насчёт какого проекта у вас вопрос?',
        'Which project is your request about?',
        '',
        'После выбора откроется короткая форма с темой, версиями, вопросом, срочностью и дополнительной информацией.',
      ].join('\n'))
      .setFooter({ text: 'MODS-HUB:SUPPORT:PICKER' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('support_open_ltt')
        .setLabel('Litematica Together')
        .setEmoji('🧱')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('support_open_st')
        .setLabel('Simple Translator')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Secondary),
    )],
    ephemeral: true,
    allowedMentions: { parse: [] },
  };
}

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

  const sorted = [...panels.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  const panel = sorted[0];
  await panel.edit({
    embeds: [new EmbedBuilder()
      .setColor(0xF59E0B)
      .setTitle('🛟 Support / Поддержка')
      .setDescription([
        'Если что-то не работает или нужен ответ от команды — создайте Support Request.',
        'If something is not working or you need help from the team, create a Support Request.',
      ].join('\n'))
      .addFields(
        {
          name: '🧩 Шаг 1 / Step 1',
          value: 'Нажмите **Open Support Request** и выберите **Litematica Together** или **Simple Translator**.',
        },
        {
          name: '📝 Шаг 2 / Step 2',
          value: 'Укажите тему, версии, сам вопрос, срочность и что уже пробовали.',
        },
        {
          name: '📎 После создания / After creation',
          value: 'При необходимости прикрепите логи, скриншоты или видео прямо в тикет.',
        },
        {
          name: '🎫 Лимит / Limit',
          value: '**Один открытый тикет на пользователя. / One open ticket per user.**',
        },
      )
      .setFooter({ text: 'MODS-HUB:SUPPORT:PRETTY-V2' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('support_open')
        .setLabel('Open Support Request')
        .setEmoji('🛟')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('donate_show')
        .setLabel('Donate')
        .setEmoji('💜')
        .setStyle(ButtonStyle.Success),
    )],
    allowedMentions: { parse: [] },
  }).catch(() => {});

  for (const duplicate of sorted.slice(1)) {
    await duplicate.delete().catch(() => {});
  }
  await panel.pin('MODS HUB: keep Support panel visible').catch(() => {});
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
  supportProjectPickerPayload,
  styleSupportPanel,
};
