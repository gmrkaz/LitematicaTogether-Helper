'use strict';

const layout = require('./project-layout-v2');
const supportUi = require('./support-ui');

async function orderProjectChannels(project) {
  if (!project) return;
  const ordered = [
    project.ru?.['о-моде'],
    project.ru?.['обновления'],
    project.ru?.['дорожная-карта'],
    project.ru?.['известные-проблемы'],
    project.ru?.['обсуждение'],
    project.gb?.['about-mod'],
    project.gb?.updates,
    project.gb?.roadmap,
    project.gb?.['known-issues'],
    project.gb?.discussion,
  ].filter(Boolean);

  for (let index = 0; index < ordered.length; index += 1) {
    await ordered[index].setPosition(index, { reason: 'MODS HUB: keep RU then GB project channel order' }).catch(() => {});
  }
}

async function ensureProjectInfrastructure(guild) {
  const result = await layout.ensureProjectInfrastructure(guild);
  if (!result) return result;
  await orderProjectChannels(result.ltt);
  await orderProjectChannels(result.simpleTranslator);
  await supportUi.styleSupportPanel(guild);
  return result;
}

module.exports = {
  PROJECTS: layout.PROJECTS,
  ensureProjectInfrastructure,
  projectSupportModal: supportUi.projectSupportModal,
  styleSupportPanel: supportUi.styleSupportPanel,
};
