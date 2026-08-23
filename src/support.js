const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require('discord.js');
const db=require('./db');const {clean,trunc,isStaff,base}=require('./common');const {log}=require('./infra');

async function openTicket(i){
 const old=db.openTicketFor(i.guild.id,i.user.id);if(old){const oldId=old.threadId||old.channelId;const th=oldId?await i.guild.channels.fetch(oldId).catch(()=>null):null;if(th)return i.reply({content:`You already have an open ticket: <#${th.id}>`,ephemeral:true});if(oldId)db.patchTicket(oldId,{status:'closed'});}
 const c=db.guild(i.guild.id),parent=await i.guild.channels.fetch(c.supportStaffChannelId).catch(()=>null);if(!parent||parent.type!==ChannelType.GuildText)return i.reply({content:'Support Staff is not configured. Staff should run /setup-server.',ephemeral:true});
 const v=id=>i.fields.getTextInputValue(id)||'—';
 await parent.permissionOverwrites.edit(i.user.id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false,SendMessagesInThreads:true,AttachFiles:true,EmbedLinks:true,UseApplicationCommands:true}).catch(()=>{});
 const th=await parent.threads.create({name:`report-${clean(i.user.username)}`,type:ChannelType.PrivateThread,invitable:false,autoArchiveDuration:1440,reason:'LTT Support ticket'});await th.members.add(i.user.id);
 db.putTicket(th.id,{threadId:th.id,guildId:i.guild.id,userId:i.user.id,status:'open',createdAt:Date.now(),claimedBy:null,name:th.name});
 const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger));
 await th.send({content:`<@${i.user.id}>`,embeds:[new EmbedBuilder().setTitle('Support Request').addFields({name:'Topic',value:trunc(v('topic'))},{name:'Versions',value:trunc(v('versions'))},{name:'Problem / expected result',value:trunc(v('problem'))},{name:'Already tried / reproduction',value:trunc(v('tried'))},{name:'Extra',value:trunc(v('extra'))}).setFooter({text:`User ID: ${i.user.id}`}).setTimestamp()],components:[row]});
 await i.reply({content:`Support request created: <#${th.id}>`,ephemeral:true});await log(i.guild,base('Support ticket opened').addFields({name:'User',value:`${i.user.tag} (${i.user.id})`},{name:'Ticket',value:`<#${th.id}>`}));
}

async function closeTicket(i){
 const t=db.ticket(i.channelId);if(!t||t.status!=='open')return i.reply({content:'This is not an open Support ticket.',ephemeral:true});if(i.user.id!==t.userId&&!isStaff(i.member))return i.reply({content:'Only the ticket owner or staff can close this ticket.',ephemeral:true});
 await i.deferReply({ephemeral:true});const all=[];let before;for(let x=0;x<10;x++){const b=await i.channel.messages.fetch({limit:100,before});if(!b.size)break;const a=[...b.values()];all.push(...a);before=a[a.length-1].id;if(b.size<100)break;}all.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
 const txt=all.map(m=>{const embeds=m.embeds?.length?` [${m.embeds.map(e=>e.title||e.description||'embed').join(' | ')}]`:'';const files=m.attachments.size?' '+[...m.attachments.values()].map(a=>`${a.name||'attachment'}: ${a.url}`).join(' '):'';return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag||'Unknown'}: ${m.content||''}${embeds}${files}`.trimEnd();}).join('\n');
 const cfg=db.guild(i.guild.id),archiveId=cfg.ticketArchiveChannelId||cfg.supportStaffChannelId,archive=await i.guild.channels.fetch(archiveId).catch(()=>null);if(archive?.isTextBased())await archive.send({content:`Closed **${i.channel.name}** — opened by <@${t.userId}>, closed by <@${i.user.id}>`,files:[new AttachmentBuilder(Buffer.from(txt||'No messages.','utf8'),{name:`${i.channel.name}.txt`})]});
 db.patchTicket(i.channelId,{status:'closed',closedAt:Date.now(),closedBy:i.user.id,transcriptSaved:true});await i.editReply('Ticket closed. The conversation was saved for Support Staff.');
 const parent=i.channel.parent;if(parent?.permissionOverwrites)await parent.permissionOverwrites.delete(t.userId,'Support ticket closed').catch(()=>{});
 await i.channel.setLocked(true).catch(()=>{});await i.channel.setArchived(true).catch(()=>{});await log(i.guild,base('Support ticket closed').addFields({name:'Ticket',value:i.channel.name},{name:'Closed by',value:`${i.user.tag} (${i.user.id})`}));
}
module.exports={openTicket,closeTicket};
