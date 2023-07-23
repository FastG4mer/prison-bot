const { Client, Intents, MessageEmbed, MessageActionRow, MessageSelectMenu } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('prison.db');

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS, Intents.FLAGS.GUILD_MESSAGES] });

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// LOG ROOM ID
const logRoomId = '1131571163550728273';


function formatTime(time) {
  const days = Math.floor(time / (1000 * 60 * 60 * 24));
  const hours = Math.floor((time % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((time % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((time % (1000 * 60)) / 1000);

  let formattedTime = '';
  if (days > 0) {
    formattedTime += `${days}d `;
  }
  if (hours > 0) {
    formattedTime += `${hours}h `;
  }
  if (minutes > 0) {
    formattedTime += `${minutes}m `;
  }
  if (seconds > 0) {
    formattedTime += `${seconds}s`;
  }

  return formattedTime.trim();
}

client.on('messageCreate', async (message) => {
  if (message.content === '!المساجين') {
    db.all('SELECT * FROM prison', async (err, rows) => {
      if (err) {
        console.error(err);
        return;
      }

      if (rows.length === 0) {
        message.reply('No members currently in prison.');
        return;
      }

      const imprisonedMembers = rows.map(row => {
        const memberId = row.userId;
        const member = message.guild.members.cache.get(memberId);
        const timeRemaining = row.releaseTime - Date.now();
        const timeRemainingFormatted = formatTime(timeRemaining);

        const memberInfo = member ? member.toString() : `Unknown Member (${memberId})`;

        return `**${memberInfo}** : الوقت المتبقي: ${timeRemainingFormatted}`;
      });

      const embed = new MessageEmbed()
        .setColor('#ff0000')
        .setTitle('قأئمة المساجين')
        .setDescription('جميع الاشخاص المسجونين:')
        .addField('الأعضاء', imprisonedMembers.join('\n\n'));

      message.reply({ embeds: [embed] });
    });
  }
});


client.on('messageCreate', async (message) => {
  if (message.content.startsWith('!فك سجن')) {
    const args = message.content.split(' ');
    const user = message.mentions.users.first();

    if (!user) {
      return message.reply('منشن الشخص الذي تريد ان تفك السجن عنه');
    }

    const role = message.guild.roles.cache.find(role => role.name === 'مخالف');

    if (!role) {
      return message.reply('The "Prisoner" role does not exist!');
    }

    const reason = args.slice(2).join(' ') || 'No reason provided';

    try {
      const member = await message.guild.members.fetch(user.id);
      if (!member.roles.cache.has(role.id)) {
        return message.reply('الشخص الذي منشنته غير موجود');
      }

      member.roles.remove(role);

      // Remove the user from the prison database
      const stmt = db.prepare('DELETE FROM prison WHERE userId = ?');
      stmt.run(user.id);
      stmt.finalize();

      // send DM message 
      const embed = new MessageEmbed()
        .setColor('#00ff00')
        .setTitle('تم فك السجن عنك')
        .addField('الاداري:', `${message.author}`)
        .addField('السبب:', reason)
        .setTimestamp();

      await member.send({ embeds: [embed] });

      // send log message to the log room
      const logEmbed = new MessageEmbed()
        .setColor('#00ff00')
        .setTitle('فك سجن')
        .setDescription(`تم فك سجن من ${user}`)
        .addField('الاداري:', `${message.author}`)
        .addField('السبب', reason)
        .setTimestamp();

      const logChannel = message.guild.channels.cache.get(logRoomId);
      if (logChannel && logChannel.isText()) {
        logChannel.send({ embeds: [logEmbed] });
      }

      message.reply(`Successfully unprisoned ${user}!`);
    } catch (error) {
      console.error(error);
    }
  }
});



client.on('messageCreate', async (message) => {
  if (message.content.startsWith('!سجن')) {
    if (!message.member.permissions.has('ADMINISTRATOR')) {
      return message.reply('You do not have permission to use this command.');
    }
    const args = message.content.split(' ');
    const user = message.mentions.users.first();

    if (!user) {
      return message.reply('Please mention a user to put in prison!');
    }

    const time = args[2];

    if (!time) {
      return message.reply('Please provide a duration for the prison sentence!');
    }

    const reasonMenu = new MessageSelectMenu()
      .setCustomId('prison_reason')
      .setPlaceholder('اختار سبب للسجن')
      .addOptions([
        { label: 'تخريب اقيام', description: 'مخرب بالقيم', value: 'مخرب اقيام', emoji: '👊' },
        { label: 'نشر', description: 'نشر بالسيرفر', value: 'نشر', emoji: '🔇' },
        { label: 'كلمات غير اخلاقية', description: 'ارسال او التحدث بكلمات غير اخلاقية', value: 'كلمات غير اخلاقية', emoji: '⚠️' },
        { label: 'سبام', description: 'سبام بالشات', value: 'سبام', emoji: '💬' },
      ]);

    const row = new MessageActionRow().addComponents(reasonMenu);

    const reply = await message.reply({ content: 'اختار سبب من قائمة الاسباب بالسفل', components: [row] });

    const filter = (interaction) => interaction.user.id === message.author.id;
    const collector = reply.createMessageComponentCollector({ filter, max: 1, time: 30000 });

    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        message.reply('You did not select a reason in time. Please use the command again.');
      }
    });

    collector.on('collect', async (interaction) => {
      if (interaction.customId === 'prison_reason') {
        const reason = interaction.values[0];
 
        const role = message.guild.roles.cache.find(role => role.name === 'مخالف'); // prison role 

        if (!role) {
          return message.reply('The "Prisoner" role does not exist!');
        }

        try {
          const member = await message.guild.members.fetch(user.id);
          member.roles.add(role);

          const releaseTime = Date.now() + parseTime(time);

          const stmt = db.prepare('INSERT OR REPLACE INTO prison (userId, prisonRoleId, releaseTime) VALUES (?, ?, ?)');
          stmt.run(user.id, role.id, releaseTime);
          stmt.finalize();

          const embed = new MessageEmbed()
            .setColor('#ff0000')
            .setTitle('تم إعطاءك بلاك ليست')
            .setDescription(`تم وضعك في السجن`)
            .addField('العضو:', `${user}`)
            .addField('الاداري:', `${message.author}`)
            .addField('الوقت:', time)
            .addField('السبب:', reason)
            .setTimestamp();

          await member.send({ embeds: [embed] });

          await reply.edit(`تم وضع ${user} في السجن لمدة ${time} بسبب ${reason}`);

          // Send log message to the log room
          const logEmbed = new MessageEmbed()
            .setColor('#ff0000')
            .setTitle('سجل اضافة البلاك ليست')
            .setDescription(`تم وضع ${user} في السجن`)
            .addField('الاداري:', `${message.author}`)
            .addField('الوقت:', time)
            .addField('السبب:', reason)
            .setTimestamp();

          const logChannel = message.guild.channels.cache.get(logRoomId);
          if (logChannel && logChannel.isText()) {
            logChannel.send({ embeds: [logEmbed] });
          }

          setTimeout(async () => {
            member.roles.remove(role);

            const stmt = db.prepare('DELETE FROM prison WHERE userId = ?');
            stmt.run(user.id);
            stmt.finalize();

            await member.send('تم فك منك السجن');
// send dm
            // Send log message to the log room
            const releaseLogEmbed = new MessageEmbed()
              .setColor('#00ff00')
              .setTitle('سجل ازالة البلاك ليست')
              .setDescription(`تم ازالة ${user} `)
              .setTimestamp();

            if (logChannel && logChannel.isText()) {
              logChannel.send({ embeds: [releaseLogEmbed] });
            }
          }, parseTime(time));
        } catch (error) {
          console.error(error);
        }
      }
    });
  }
});

client.on('guildMemberAdd', async (member) => {
  db.get('SELECT * FROM prison WHERE userId = ?', member.id, async (err, row) => {
    if (err) {
      console.error(err);
      return;
    }

    if (row) {
      const { prisonRoleId, releaseTime } = row;

      const role = member.guild.roles.cache.get(prisonRoleId);

      if (role) {
        member.roles.add(role);

        const timeRemaining = releaseTime - Date.now();
        if (timeRemaining > 0) {
          setTimeout(async () => {
            member.roles.remove(role);

            const stmt = db.prepare('DELETE FROM prison WHERE userId = ?');
            stmt.run(member.id);
            stmt.finalize();

            member.send('You have been released from prison!');
            member.guild.systemChannel.send(`${member} has been released from prison!`);

            // Send log message to the log room
            const releaseLogEmbed = new MessageEmbed()
              .setColor('#00ff00')
              .setTitle('User Released')
              .setDescription(`${member} has been released from prison.`)
              .setTimestamp();

            const logChannel = member.guild.channels.cache.get(logRoomId);
            if (logChannel && logChannel.isText()) {
              logChannel.send({ embeds: [releaseLogEmbed] });
            }
          }, timeRemaining);
        }
      }
    }
  });
});

function parseTime(time) {

  const regex = /(\d+)([smhdwMy])/;
  const match = time.match(regex);

  if (!match) {
    return 0;
  }

  const amount = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 1000 * 60;
    case 'h':
      return amount * 1000 * 60 * 60;
    case 'd':
      return amount * 1000 * 60 * 60 * 24;
    case 'w':
      return amount * 1000 * 60 * 60 * 24 * 7;
    case 'M':
      return amount * 1000 * 60 * 60 * 24 * 30;
    case 'y':
      return amount * 1000 * 60 * 60 * 24 * 365;
    default:
      return 0;
  }
}





client.login('MTEyNjQ3ODI5MTM0ODUwNDU4OA.Gyknp5.qKLhReyFkCD2HRM82vIl7XMZqgLbIwvr5jHdM0');