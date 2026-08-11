require('dotenv').config();
require('dotenv').config();

const http = require('http');

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Shreds bot is online!');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}`);
});

const {
    Client,
    GatewayIntentBits,

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    AuditLogEvent,
    ActivityType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences
    ]
});

const PREFIX = ',';

// ====================
// ROLE IDs
// ====================

const VERIFIED_ROLE_ID = '1516790671611265054';
const UNVERIFIED_ROLE_ID = '1516790078251204798';

const PICTURE_PERMISSIONS_ROLE_ID = '1516805160847020172';
const PICTURE_PERMISSIONS_ROLE_NAME = 'Picture Permissions';

// ====================
// WELCOME SETTINGS
// ====================

const WELCOME_CHANNEL_ID = '1516785213894820012';
const CHAT_CHANNEL_ID = '1536494758430515263';
const RULES_CHANNEL_ID = '1516776015513522226';

const WHITE_SPARKLE = '<a:whitesparkle:1536735491016237159>';
const WHITE_MOON = '<a:whitemoon:1536734929071767633>';
const INVIS = '<:invis:1536788533669400639>';

// ====================
// SNIPE SETTINGS
// ====================

const MAX_SNIPE_ENTRIES = 50;
const snipeCache = new Map();

// ====================
// BOT READY
// ====================

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// ====================
// FIND MEMBER
// ====================

async function findMember(guild, input) {
    const cleanInput = input.replace(/[<@!>]/g, '');

    if (/^\d{17,20}$/.test(cleanInput)) {
        try {
            return await guild.members.fetch(cleanInput);
        } catch {
            return null;
        }
    }

    const lowerInput = input.toLowerCase();
    const members = await guild.members.fetch();

    return members.find(member =>
        member.user.username.toLowerCase() === lowerInput ||
        member.displayName.toLowerCase() === lowerInput ||
        member.user.tag.toLowerCase() === lowerInput
    ) || null;
}

// ====================
// FIND ROLE
// ====================

function findRole(guild, input) {
    const cleanInput = input.replace(/[<@&>]/g, '');

    if (/^\d{17,20}$/.test(cleanInput)) {
        return guild.roles.cache.get(cleanInput) || null;
    }

    const lowerInput = input.toLowerCase();

    return guild.roles.cache.find(
        role => role.name.toLowerCase() === lowerInput
    ) || null;
}

// ====================
// FIND PICTURE ROLE
// ====================

function findPictureRole(guild) {
    if (PICTURE_PERMISSIONS_ROLE_ID) {
        const role = guild.roles.cache.get(
            PICTURE_PERMISSIONS_ROLE_ID
        );

        if (role) return role;
    }

    return guild.roles.cache.find(
        role =>
            role.name.toLowerCase() ===
            PICTURE_PERMISSIONS_ROLE_NAME.toLowerCase()
    ) || null;
}

// ====================
// PARSE DURATION
// ====================

function parseDuration(input) {
    if (!input) return null;

    const value = input.toLowerCase().trim();

    const match = value.match(
        /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/
    );

    if (!match) return null;

    const number = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(number) || number <= 0) {
        return null;
    }

    if (
        ['s', 'sec', 'secs', 'second', 'seconds'].includes(unit)
    ) {
        return number * 1000;
    }

    if (
        ['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)
    ) {
        return number * 60 * 1000;
    }

    if (
        ['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)
    ) {
        return number * 60 * 60 * 1000;
    }

    if (
        ['d', 'day', 'days'].includes(unit)
    ) {
        return number * 24 * 60 * 60 * 1000;
    }

    return null;
}

// ====================
// FORMAT DURATION
// ====================

function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);

    if (seconds < 60) {
        return `${seconds} second${seconds === 1 ? '' : 's'}`;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
        return `${hours} hour${hours === 1 ? '' : 's'}`;
    }

    const days = Math.floor(hours / 24);

    return `${days} day${days === 1 ? '' : 's'}`;
}

// ====================
// PERMISSION CHECK
// ====================

function hasPermission(member, permission) {
    return member.permissions.has(permission);
}

// ====================
// ROLE HIERARCHY
// ====================

function canManageRole(message, role) {
    const botMember = message.guild.members.me;

    if (!botMember) return false;

    if (role.position >= botMember.roles.highest.position) {
        return false;
    }

    if (
        message.member.id !== message.guild.ownerId &&
        role.position >= message.member.roles.highest.position
    ) {
        return false;
    }

    return true;
}

// ====================
// VANITY CHECK
// ====================

function hasShredsVanity(member) {
    if (!member.presence) return false;

    return member.presence.activities.some(activity => {
        if (activity.type !== ActivityType.Custom) {
            return false;
        }

        const status = activity.state || '';
        const lowerStatus = status.toLowerCase();

        return (
            lowerStatus.includes('/shreds') ||
            lowerStatus.includes('.gg/shreds')
        );
    });
}

// ====================
// VANITY ROLE
// ====================

async function updateVanityRole(member) {
    if (!member || !member.guild) return;

    const role = findPictureRole(member.guild);

    if (!role || role.managed) return;

    if (
        member.guild.members.me &&
        role.position >= member.guild.members.me.roles.highest.position
    ) {
        return;
    }

    const hasVanity = hasShredsVanity(member);

    try {
        if (hasVanity) {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(
                    role,
                    'Shreds vanity detected'
                );
            }
        } else {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(
                    role,
                    'Shreds vanity removed'
                );
            }
        }
    } catch (error) {
        console.error('Vanity role error:', error);
    }
}

// ====================
// PRESENCE UPDATE
// ====================

client.on('presenceUpdate', async (oldPresence, newPresence) => {
    const member =
        newPresence?.member ||
        oldPresence?.member;

    if (!member) return;

    await updateVanityRole(member);
});

// ====================
// WELCOME MESSAGE
// ====================

client.on('guildMemberAdd', async member => {
    try {
        const channel = await member.guild.channels.fetch(
            WELCOME_CHANNEL_ID
        );

        if (!channel || !channel.isTextBased()) {
            return;
        }

        const welcomeEmbed = new EmbedBuilder()
            .setDescription(
                `${INVIS} ${INVIS}                          **Welcome to /shreds ${WHITE_MOON}**\n\n` +
                `${WHITE_SPARKLE}   <#${CHAT_CHANNEL_ID}>  ${WHITE_SPARKLE}   <#${RULES_CHANNEL_ID}>\n` +
                `${INVIS}   ${INVIS}   ${INVIS}   ‎ ‎‎‎‎ ‎Member #${member.guild.memberCount}`
            )
            .setThumbnail(
                member.user.displayAvatarURL({
                    extension: 'png',
                    size: 256
                })
            );

        await channel.send({
            embeds: [welcomeEmbed],
            allowedMentions: {
                users: [],
                roles: [],
                repliedUser: false
            }
        });
    } catch (error) {
        console.error('Welcome message error:', error);
    }
});

// ====================
// FIND MESSAGE DELETER
// ====================

async function findMessageDeleter(guild, messageId) {
    try {
        if (
            !guild.members.me ||
            !guild.members.me.permissions.has(
                PermissionsBitField.Flags.ViewAuditLog
            )
        ) {
            return null;
        }

        const logs = await guild.fetchAuditLogs({
            type: AuditLogEvent.MessageDelete,
            limit: 10
        });

        const entry = logs.entries.find(entry => {
            if (!entry.target) return false;

            return (
                entry.target.id === messageId &&
                Date.now() - entry.createdTimestamp < 15000
            );
        });

        return entry?.executor || null;
    } catch {
        return null;
    }
}

// ====================
// STORE DELETED MESSAGE
// ====================

client.on('messageDelete', async deletedMessage => {
    if (!deletedMessage.guild) return;

    try {
        if (deletedMessage.partial) {
            try {
                await deletedMessage.fetch();
            } catch {}
        }

        const deleter = await findMessageDeleter(
            deletedMessage.guild,
            deletedMessage.id
        );

        const entry = {
            id: deletedMessage.id,
            guildId: deletedMessage.guild.id,
            authorId: deletedMessage.author?.id || null,
            authorName:
                deletedMessage.author?.tag ||
                deletedMessage.author?.username ||
                'Unknown user',
            content: deletedMessage.content || '',
            channelId: deletedMessage.channel?.id || null,
            channelName:
                deletedMessage.channel?.name ||
                'Unknown channel',
            deletedAt: Date.now(),
            deleterId: deleter?.id || null,
            deleterName: deleter?.tag || null,
            attachments: deletedMessage.attachments
                ? [...deletedMessage.attachments.values()].map(file => ({
                    name: file.name,
                    url: file.url,
                    contentType: file.contentType || ''
                }))
                : []
        };

        if (!snipeCache.has(deletedMessage.guild.id)) {
            snipeCache.set(deletedMessage.guild.id, []);
        }

        const snipes =
            snipeCache.get(deletedMessage.guild.id);

        snipes.unshift(entry);

        if (snipes.length > MAX_SNIPE_ENTRIES) {
            snipes.length = MAX_SNIPE_ENTRIES;
        }
    } catch (error) {
        console.error('Snipe storage error:', error);
    }
});

// ====================
// PAGED ROLES EMBED
// ====================

async function showRolesPage(interaction, roles, page) {
    const perPage = 10;

    const totalPages = Math.max(
        1,
        Math.ceil(roles.length / perPage)
    );

    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * perPage;

    const currentRoles = roles.slice(
        start,
        start + perPage
    );

    const roleList = currentRoles
        .map((role, index) =>
            `**${start + index + 1}.** <@&${role.id}>`
        )
        .join('\n');

    const embed = new EmbedBuilder()
        .setTitle('Server Roles')
        .setDescription(
            roleList || 'No roles found.'
        )
        .setFooter({
            text:
                `Page ${page + 1} / ${totalPages} • ` +
                `${roles.length} roles`
        });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('roles_previous')
                .setLabel('Previous')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),

            new ButtonBuilder()
                .setCustomId('roles_next')
                .setLabel('Next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
        );

    await interaction.update({
        embeds: [embed],
        components: [row],
        allowedMentions: {
            roles: []
        }
    });
}

// ====================
// PAGED INROLE EMBED
// ====================

async function showInRolePage(
    interaction,
    members,
    role,
    page
) {
    const perPage = 10;

    const totalPages = Math.max(
        1,
        Math.ceil(members.length / perPage)
    );

    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * perPage;

    const currentMembers = members.slice(
        start,
        start + perPage
    );

    const memberList = currentMembers
        .map((member, index) => {
            return (
                `**${start + index + 1}.** ` +
                `[${member.displayName}]` +
                `(https://discord.com/users/${member.id})`
            );
        })
        .join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`Members in ${role.name}`)
        .setDescription(
            memberList || 'No members found.'
        )
        .setFooter({
            text:
                `Page ${page + 1} / ${totalPages} • ` +
                `${members.length} members`
        });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('inrole_previous')
                .setLabel('Previous')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),

            new ButtonBuilder()
                .setCustomId('inrole_next')
                .setLabel('Next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
        );

    await interaction.update({
        embeds: [embed],
        components: [row]
    });
}

// ====================
// BUTTON HANDLER
// ====================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    try {
        const message = interaction.message;

        if (!message.embeds.length) return;

        const embed = message.embeds[0];

        // ====================
        // ROLES BUTTONS
        // ====================

        if (
            interaction.customId === 'roles_previous' ||
            interaction.customId === 'roles_next'
        ) {
            const roles = [
                ...interaction.guild.roles.cache.values()
            ]
                .filter(
                    role => role.id !== interaction.guild.id
                )
                .sort(
                    (a, b) => b.position - a.position
                );

            const footer =
                embed.footer?.text || '';

            const match =
                footer.match(/Page (\d+) \/ (\d+)/);

            let page = match
                ? Number(match[1]) - 1
                : 0;

            if (
                interaction.customId === 'roles_previous'
            ) {
                page--;
            } else {
                page++;
            }

            await showRolesPage(
                interaction,
                roles,
                page
            );

            return;
        }

        // ====================
        // INROLE BUTTONS
        // ====================

        if (
            interaction.customId === 'inrole_previous' ||
            interaction.customId === 'inrole_next'
        ) {
            const title =
                embed.title || '';

            const roleName =
                title.replace('Members in ', '');

            const role =
                interaction.guild.roles.cache.find(
                    r => r.name === roleName
                );

            if (!role) {
                return interaction.reply({
                    content:
                        '❌ That role no longer exists.',
                    ephemeral: true
                });
            }

            await interaction.guild.members.fetch();

            const members = [
                ...role.members.values()
            ].sort((a, b) =>
                a.user.username.localeCompare(
                    b.user.username
                )
            );

            const footer =
                embed.footer?.text || '';

            const match =
                footer.match(/Page (\d+) \/ (\d+)/);

            let page = match
                ? Number(match[1]) - 1
                : 0;

            if (
                interaction.customId ===
                'inrole_previous'
            ) {
                page--;
            } else {
                page++;
            }

            await showInRolePage(
                interaction,
                members,
                role,
                page
            );

            return;
        }
    } catch (error) {
        console.error(
            'Button interaction error:',
            error
        );
    }
});

// ====================
// COMMAND HANDLER
// ====================

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);

    const command = args.shift()?.toLowerCase();

    if (!command) return;

    // ====================
    // VERIFY
    // ====================

    if (command === 'verify') {
        if (!hasPermission(
            message.member,
            PermissionsBitField.Flags.ManageRoles
        )) {
            return message.reply(
                '❌ You need **Manage Roles** permission to use this command.'
            );
        }

        if (!args[0]) {
            return message.reply(
                '❌ Usage: `,verify <user>`'
            );
        }

        const member = await findMember(
            message.guild,
            args[0]
        );

        if (!member) {
            return message.reply(
                '❌ I could not find that member.'
            );
        }

        const verifiedRole =
            message.guild.roles.cache.get(
                VERIFIED_ROLE_ID
            );

        const unverifiedRole =
            message.guild.roles.cache.get(
                UNVERIFIED_ROLE_ID
            );

        if (!verifiedRole) {
            return message.reply(
                '❌ The Verified role could not be found.'
            );
        }

        if (
            verifiedRole.position >=
            message.guild.members.me.roles.highest.position
        ) {
            return message.reply(
                '❌ I cannot manage the Verified role because it is too high.'
            );
        }

        if (
            member.roles.cache.has(
                VERIFIED_ROLE_ID
            )
        ) {
            return message.reply(
                `⚠️ ${member} already has the Verified role.`
            );
        }

        try {
            await member.roles.add(
                verifiedRole,
                'Member verified'
            );

            if (
                unverifiedRole &&
                member.roles.cache.has(
                    UNVERIFIED_ROLE_ID
                )
            ) {
                await member.roles.remove(
                    unverifiedRole,
                    'Member verified'
                );
            }

            return message.reply(
                `✅ ${member} has been verified!`
            );
        } catch (error) {
            console.error(error);

            return message.reply(
                '❌ I could not update that member\'s roles.'
            );
        }
    }

    // ====================
    // ROLE
    // ====================

    if (command === 'role') {
        if (!hasPermission(
            message.member,
            PermissionsBitField.Flags.ManageRoles
        )) {
            return message.reply(
                '❌ You need **Manage Roles** permission to use this command.'
            );
        }

        if (!args[0] || !args[1]) {
            return message.reply(
                '❌ Usage: `,role <user> <role>`'
            );
        }

        const member = await findMember(
            message.guild,
            args[0]
        );

        const role = findRole(
            message.guild,
            args.slice(1).join(' ')
        );

        if (!member) {
            return message.reply(
                '❌ I could not find that member.'
            );
        }

        if (!role) {
            return message.reply(
                '❌ I could not find that role.'
            );
        }

        if (role.managed) {
            return message.reply(
                '❌ I cannot manually manage that role.'
            );
        }

        if (!canManageRole(message, role)) {
            return message.reply(
                '❌ You or the bot cannot manage that role because of the role hierarchy.'
            );
        }

        try {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(
                    role,
                    `Role removed by ${message.author.tag}`
                );

                return message.reply(
                    `✅ Removed **${role.name}** from ${member}.`
                );
            }

            await member.roles.add(
                role,
                `Role added by ${message.author.tag}`
            );

            return message.reply(
                `✅ ${member} has been given **${role.name}**.`
            );
        } catch (error) {
            console.error(error);

            return message.reply(
                '❌ I could not update that role.'
            );
        }
    }

    // ====================
    // ROLES
    // ====================

    if (command === 'roles') {
        const roles = [
            ...message.guild.roles.cache.values()
        ]
            .filter(
                role => role.id !== message.guild.id
            )
            .sort(
                (a, b) => b.position - a.position
            );

        if (!roles.length) {
            return message.reply(
                '❌ There are no roles to display.'
            );
        }

        const perPage = 10;

        const totalPages = Math.max(
            1,
            Math.ceil(roles.length / perPage)
        );

        const currentRoles =
            roles.slice(0, perPage);

        const roleList = currentRoles
            .map((role, index) =>
                `**${index + 1}.** <@&${role.id}>`
            )
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle('Server Roles')
            .setDescription(roleList)
            .setFooter({
                text:
                    `Page 1 / ${totalPages} • ` +
                    `${roles.length} roles`
            });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('roles_previous')
                    .setLabel('Previous')
                    .setEmoji('◀️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),

                new ButtonBuilder()
                    .setCustomId('roles_next')
                    .setLabel('Next')
                    .setEmoji('▶️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(
                        totalPages === 1
                    )
            );

        await message.reply({
            embeds: [embed],
            components: [row],
            allowedMentions: {
                roles: []
            }
        });

        return;
    }

    // ====================
    // INROLE
    // ====================

    if (command === 'inrole') {
        let role;

        if (args.length === 0) {
            role = message.member.roles.highest;

            if (
                !role ||
                role.id === message.guild.id
            ) {
                return message.reply(
                    '❌ You do not have a role to check.'
                );
            }
        } else {
            role = findRole(
                message.guild,
                args.join(' ')
            );

            if (!role) {
                return message.reply(
                    '❌ I could not find that role.'
                );
            }
        }

        await message.guild.members.fetch();

        const members = [
            ...role.members.values()
        ].sort((a, b) =>
            a.user.username.localeCompare(
                b.user.username
            )
        );

        if (!members.length) {
            return message.reply(
                `❌ Nobody currently has **${role.name}**.`
            );
        }

        const perPage = 10;

        const totalPages = Math.max(
            1,
            Math.ceil(members.length / perPage)
        );

        const currentMembers =
            members.slice(0, perPage);

        const memberList = currentMembers
            .map((member, index) => {
                return (
                    `**${index + 1}.** ` +
                    `[${member.displayName}]` +
                    `(https://discord.com/users/${member.id})`
                );
            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(
                `Members in ${role.name}`
            )
            .setDescription(memberList)
            .setFooter({
                text:
                    `Page 1 / ${totalPages} • ` +
                    `${members.length} members`
            });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'inrole_previous'
                    )
                    .setLabel('Previous')
                    .setEmoji('◀️')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
                    .setDisabled(true),

                new ButtonBuilder()
                    .setCustomId(
                        'inrole_next'
                    )
                    .setLabel('Next')
                    .setEmoji('▶️')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
                    .setDisabled(
                        totalPages === 1
                    )
            );

        await message.reply({
            embeds: [embed],
            components: [row]
        });

        return;
    }

    // ====================
    // BOOSTERROLE
    // ====================

    if (command === 'boosterrole') {

        const isAdmin =
            message.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            );

        const isBooster =
            Boolean(message.member.premiumSince);

        if (!isAdmin && !isBooster) {
            return message.reply(
                '❌ You must be a Server Booster or Administrator to use this command.'
            );
        }

        // Check bot exists
        const botMember = message.guild.members.me;

        if (!botMember) {
            return message.reply(
                '❌ I could not find my bot member in this server.'
            );
        }

        // Check Manage Roles
        if (
            !botMember.permissions.has(
                PermissionsBitField.Flags.ManageRoles
            )
        ) {
            return message.reply(
                '❌ I need the **Manage Roles** permission to create booster roles.'
            );
        }

        if (args.length < 3) {
            return message.reply(
                '❌ Usage: `,boosterrole <colour1> <colour2> <name>`\nExample: `,boosterrole 787878 020105 Hadi`'
            );
        }

        let colour1 = args[0].trim();
        let colour2 = args[1].trim();

        if (!colour1.startsWith('#')) {
            colour1 = `#${colour1}`;
        }

        if (!colour2.startsWith('#')) {
            colour2 = `#${colour2}`;
        }

        const hexRegex =
            /^#[0-9A-Fa-f]{6}$/;

        if (
            !hexRegex.test(colour1) ||
            !hexRegex.test(colour2)
        ) {
            return message.reply(
                '❌ Use two 6-digit HEX colours, e.g. `787878 020105`.'
            );
        }

        const roleName =
            args.slice(2).join(' ').trim();

        if (!roleName) {
            return message.reply(
                '❌ You need to provide a role name.'
            );
        }

        // Make sure the bot can create/manage roles
        if (
            botMember.roles.highest.position <=
            message.guild.roles.everyone.position
        ) {
            return message.reply(
                '❌ My bot role is too low in the role hierarchy. Move my bot role higher in **Server Settings → Roles**.'
            );
        }

        let role = null;

        try {
            // First attempt: gradient role
            role =
                await message.guild.roles.create({
                    name: roleName,
                    colors: {
                        primaryColor: colour1,
                        secondaryColor: colour2
                    },
                    reason:
                        `Booster role created by ${message.author.tag}`
                });

            console.log(
                `Gradient booster role created: ${role.name} (${role.id})`
            );

        } catch (gradientError) {

            console.error(
                'Gradient role creation failed:',
                gradientError
            );

            // Fallback: create normal solid-color role
            try {
                role =
                    await message.guild.roles.create({
                        name: roleName,
                        color: colour1,
                        reason:
                            `Booster role created by ${message.author.tag}`
                    });

                console.log(
                    `Fallback solid booster role created: ${role.name} (${role.id})`
                );

            } catch (solidError) {

                console.error(
                    'Solid role creation also failed:',
                    solidError
                );

                return message.reply(
                    '❌ I could not create the booster role. Check the CMD window for the exact Discord error.'
                );
            }
        }

        // Check hierarchy after creation
        if (!canManageRole(message, role)) {

            try {
                await role.delete(
                    'Created too high in role hierarchy'
                );
            } catch {}

            return message.reply(
                '❌ I created the role, but I cannot manage it because of the role hierarchy. Move my bot role higher.'
            );
        }

        // Give role to booster
        try {

            await message.member.roles.add(
                role,
                'Booster role created'
            );

            const isGradient =
                role.colors?.secondaryColor != null;

            if (isGradient) {
                return message.reply(
                    `✅ Created gradient role **${role.name}** using \`${colour1}\` → \`${colour2}\` and gave it to ${message.member}.`
                );
            }

            return message.reply(
                `✅ Created **${role.name}** using \`${colour1}\` and gave it to ${message.member}.\n⚠️ Discord did not allow the gradient style, so the role was created as a solid colour.`
            );

        } catch (error) {

            console.error(
                'Booster role assignment error:',
                error
            );

            return message.reply(
                '❌ The role was created, but I could not give it to you. Check my role hierarchy.'
            );
        }
    }

    // ====================
    // KICK
    // ====================

    if (command === 'kick') {
        if (!hasPermission(
            message.member,
            PermissionsBitField.Flags.KickMembers
        )) {
            return message.reply(
                '❌ You need **Kick Members** permission to use this command.'
            );
        }

        if (!args[0]) {
            return message.reply(
                '**Command: kick**\n\nKicks the provided member from the server.\n\n`Syntax: ,kick (member) (reason)`\n`Example: ,kick melody for racism`'
            );
        }

        const member = await findMember(
            message.guild,
            args[0]
        );

        if (!member) {
            return message.reply(
                '❌ I could not find that member.'
            );
        }

        if (!member.kickable) {
            return message.reply(
                '❌ I cannot kick that member because of role hierarchy or permissions.'
            );
        }

        const reason =
            args.slice(1).join(' ') ||
            'No reason provided';

        try {
            await member.kick(reason);

            return message.reply(
                `✅ ${member.user.tag} has been kicked.`
            );
        } catch (error) {
            console.error(error);

            return message.reply(
                '❌ I could not kick that member.'
            );
        }
    }

    // ====================
    // BAN
    // ====================

    if (command === 'ban') {
        if (!hasPermission(
            message.member,
            PermissionsBitField.Flags.BanMembers
        )) {
            return message.reply(
                '❌ You need **Ban Members** permission to use this command.'
            );
        }

        if (!args[0]) {
            return message.reply(
                '**Command: ban**\n\nBans the provided member from the server.\n\n`Syntax: ,ban (member) (reason)`\n`Example: ,ban jonathan bad behaviour`'
            );
        }

        const member = await findMember(
            message.guild,
            args[0]
        );

        if (!member) {
            return message.reply(
                '❌ I could not find that member.'
            );
        }

        if (!member.bannable) {
            return message.reply(
                '❌ I cannot ban that member because of role hierarchy or permissions.'
            );
        }

        const reason =
            args.slice(1).join(' ') ||
            'No reason provided';

        try {
            await member.ban({ reason });

            return message.reply(
                `✅ ${member.user.tag} has been banned.`
            );
        } catch (error) {
            console.error(error);

            return message.reply(
                '❌ I could not ban that member.'
            );
        }
    }

    // ====================
    // TIMEOUT
    // ====================

    if (command === 'timeout') {
        if (!hasPermission(
            message.member,
            PermissionsBitField.Flags.ModerateMembers
        )) {
            return message.reply(
                '❌ You need **Moderate Members** permission to use this command.'
            );
        }

        if (!args[0] || !args[1]) {
            return message.reply(
                '**Command: timeout**\n\nMutes the provided member using Discord\'s timeout feature.\n\n`Syntax: ,timeout (member) (duration) (reason)`\n`Example: ,timeout jonathan 1m bad behaviour`'
            );
        }

        const member = await findMember(
            message.guild,
            args[0]
        );

        if (!member) {
            return message.reply(
                '❌ I could not find that member.'
            );
        }

        const duration =
            parseDuration(args[1]);

        if (!duration) {
            return message.reply(
                '❌ Invalid duration. Examples: `20s`, `5m`, `2h`, `7d`.'
            );
        }

        const MAX_TIMEOUT =
            28 * 24 * 60 * 60 * 1000;

        if (duration > MAX_TIMEOUT) {
            return message.reply(
                '❌ Discord timeouts can only be up to 28 days.'
            );
        }

        if (!member.moderatable) {
            return message.reply(
                '❌ I cannot timeout that member because of role hierarchy or permissions.'
            );
        }

        const reason =
            args.slice(2).join(' ') ||
            'No reason provided';

        try {
            await member.timeout(
                duration,
                reason
            );

            return message.reply(
                `✅ ${member} has been timed out for **${formatDuration(duration)}**.`
            );
        } catch (error) {
            console.error(error);

            return message.reply(
                '❌ I could not timeout that member.'
            );
        }
    }

    // ====================
    // SNIPE
    // ====================

    if (command === 's') {
        if (!hasPermission(
            message.member,
            PermissionsBitField.Flags.ManageMessages
        )) {
            return message.reply(
                '❌ You need **Manage Messages** permission to use this command.'
            );
        }

        let page = 1;

        if (args[0]) {
            const parsedPage =
                Number(args[0]);

            if (
                !Number.isInteger(parsedPage) ||
                parsedPage < 1
            ) {
                return message.reply(
                    '❌ Invalid snipe page.'
                );
            }

            page = parsedPage;
        }

        const snipes =
            snipeCache.get(
                message.guild.id
            ) || [];

        const entry =
            snipes[page - 1];

        if (!entry) {
            return message.reply(
                `❌ There is no snipe page **${page}**.`
            );
        }

        const deleterText =
            entry.deleterName ||
            'Unknown / unavailable';

        let description =
            entry.content ||
            '*No text content*';

        description +=
            `\n\n**Author:** ${entry.authorName}`;

        description +=
            `\n**Channel:** <#${entry.channelId}>`;

        description +=
            `\n**Deleted by:** ${deleterText}`;

        description +=
            `\n**Deleted:** <t:${Math.floor(entry.deletedAt / 1000)}:F>`;

        description +=
            `\n**Page:** ${page}/${snipes.length}`;

        const embed =
            new EmbedBuilder()
                .setTitle('Deleted Message')
                .setDescription(description);

        const firstImage =
            entry.attachments.find(file =>
                file.contentType?.startsWith(
                    'image/'
                )
            );

        if (firstImage) {
            embed.setImage(
                firstImage.url
            );
        }

        try {
            await message.channel.send({
                embeds: [embed]
            });

            const otherAttachments =
                entry.attachments
                    .filter(file =>
                        !file.contentType?.startsWith(
                            'image/'
                        )
                    )
                    .slice(0, 10);

            if (otherAttachments.length) {
                await message.channel.send({
                    content:
                        '**Attachments:**\n' +
                        otherAttachments
                            .map(file =>
                                `[${file.name || 'Attachment'}](${file.url})`
                            )
                            .join('\n')
                });
            }
        } catch (error) {
            console.error(
                'Snipe display error:',
                error
            );

            return message.reply(
                '❌ I could not display that snipe.'
            );
        }

        return;
    }

    // ====================
    // CLEAR SNIPES
    // ====================

    if (command === 'cs') {
        if (!hasPermission(
            message.member,
            PermissionsBitField.Flags.ManageMessages
        )) {
            return message.reply(
                '❌ You need **Manage Messages** permission to use this command.'
            );
        }

        snipeCache.delete(
            message.guild.id
        );

        return message.reply(
            '✅ Snipe history has been cleared.'
        );
    }
});

// ====================
// LOGIN
// ====================

client.login(
    process.env.DISCORD_TOKEN
);
