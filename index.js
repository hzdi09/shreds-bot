require('dotenv').config();

const http = require('http');

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

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 3000;
const PREFIX = ',';

const VERIFIED_ROLE_ID = '1516790671611265054';
const UNVERIFIED_ROLE_ID = '1516790078251204798';

const PICTURE_PERMISSIONS_ROLE_ID = '1516805160847020172';
const PICTURE_PERMISSIONS_ROLE_NAME = 'Picture Permissions';

const WELCOME_CHANNEL_ID = '1516785213894820012';
const CHAT_CHANNEL_ID = '1536494758430515263';
const RULES_CHANNEL_ID = '1516776015513522226';

const VANITY_LOG_CHANNEL_ID = '1516784477039497227';

const BLACK_HEART = '<a:bheart:1536805933982949477>';
const WHITE_SPARKLE = '<a:whitesparkle:1536735491016237159>';
const WHITE_MOON = '<a:whitemoon:1536734929071767633>';
const INVIS = '<:invis:1536788533669400639>';

const VANITY_RECHECK_INTERVAL = 5 * 60 * 1000;

const CONNECTION_CHECK_INTERVAL = 30 * 1000;
const RECONNECT_DELAY = 10 * 1000;
const MAX_NOT_READY_TIME = 90 * 1000;

const MAX_SNIPE_ENTRIES = 50;

// Stores the roles removed from users by ,strip.
// Format:
// userId -> [roleId, roleId, roleId]
const strippedRoles = new Map();

const vanityState = new Map();
const snipeCache = new Map();

let reconnecting = false;
let notReadySince = null;
let reconnectTimer = null;

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences
    ]
});

// ============================================================
// HEALTH SERVER
// ============================================================

const server = http.createServer((req, res) => {
    const url = req.url || '/';

    res.setHeader('Content-Type', 'application/json');

    if (url === '/health') {
        const ready = client.isReady();

        res.writeHead(ready ? 200 : 503);

        return res.end(JSON.stringify({
            status: ready ? 'online' : 'offline',
            discord: ready,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }));
    }

    res.writeHead(200);

    res.end(JSON.stringify({
        service: 'Shreds bot',
        discord: client.isReady() ? 'online' : 'offline'
    }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// ============================================================
// EMBED HELPERS
// ============================================================

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: 'Shreds • Moderation'
        })
        .setTimestamp();
}

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: 'Shreds • Error'
        })
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: 'Shreds'
        })
        .setTimestamp();
}

// ============================================================
// FIND MEMBER
// ============================================================

async function findMember(guild, input) {
    if (!input) return null;

    const cleanInput = input.replace(/[<@!>]/g, '');

    if (/^\d{17,20}$/.test(cleanInput)) {
        try {
            return await guild.members.fetch(cleanInput);
        } catch {
            return null;
        }
    }

    const lowerInput = input.toLowerCase();

    try {
        const members = await guild.members.fetch();

        return members.find(member =>
            member.user.username.toLowerCase() === lowerInput ||
            member.displayName.toLowerCase() === lowerInput ||
            member.user.tag.toLowerCase() === lowerInput
        ) || null;
    } catch (error) {
        console.error('Member search error:', error);
        return null;
    }
}

// ============================================================
// FIND ROLE
// ============================================================

function findRole(guild, input) {
    if (!input) return null;

    const cleanInput = input.replace(/[<@&>]/g, '');

    if (/^\d{17,20}$/.test(cleanInput)) {
        return guild.roles.cache.get(cleanInput) || null;
    }

    const lowerInput = input.toLowerCase();

    return guild.roles.cache.find(
        role => role.name.toLowerCase() === lowerInput
    ) || null;
}

// ============================================================
// FIND PICTURE ROLE
// ============================================================

function findPictureRole(guild) {
    const role = guild.roles.cache.get(
        PICTURE_PERMISSIONS_ROLE_ID
    );

    if (role) return role;

    return guild.roles.cache.find(
        role =>
            role.name.toLowerCase() ===
            PICTURE_PERMISSIONS_ROLE_NAME.toLowerCase()
    ) || null;
}

// ============================================================
// DURATION
// ============================================================

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

    if ([
        's',
        'sec',
        'secs',
        'second',
        'seconds'
    ].includes(unit)) {
        return number * 1000;
    }

    if ([
        'm',
        'min',
        'mins',
        'minute',
        'minutes'
    ].includes(unit)) {
        return number * 60 * 1000;
    }

    if ([
        'h',
        'hr',
        'hrs',
        'hour',
        'hours'
    ].includes(unit)) {
        return number * 60 * 60 * 1000;
    }

    if ([
        'd',
        'day',
        'days'
    ].includes(unit)) {
        return number * 24 * 60 * 60 * 1000;
    }

    return null;
}

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

// ============================================================
// PERMISSIONS
// ============================================================

function hasPermission(member, permission) {
    return member.permissions.has(permission);
}

// ============================================================
// ROLE HIERARCHY
// ============================================================

function canManageRole(message, role) {
    const botMember = message.guild.members.me;

    if (!botMember) return false;

    if (role.position >= botMember.roles.highest.position) {
        return false;
    }

    if (
        message.guild.ownerId !== message.member.id &&
        role.position >= message.member.roles.highest.position
    ) {
        return false;
    }

    return true;
}

// ============================================================
// STRIP ROLE DETECTION
// ============================================================

// These are the permissions considered "admin/staff/mod"
// for ,strip.
//
// A role is stripped if it grants at least one of these.
const STRIP_PERMISSIONS = [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ManageThreads,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.MentionEveryone,
    PermissionsBitField.Flags.ManageWebhooks,
    PermissionsBitField.Flags.ManageNicknames
];

function roleIsStaffOrModeration(role) {
    if (!role || role.managed) return false;

    return STRIP_PERMISSIONS.some(permission =>
        role.permissions.has(permission)
    );
}

function getStrippableRoles(member) {
    return member.roles.cache.filter(role =>
        role.id !== member.guild.id &&
        !role.managed &&
        roleIsStaffOrModeration(role)
    );
}

// ============================================================
// VANITY DETECTION
// ============================================================

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

// ============================================================
// VANITY NOTIFICATION
// ============================================================

async function sendVanityNotification(member) {
    try {
        const channel = await member.guild.channels.fetch(
            VANITY_LOG_CHANNEL_ID
        );

        if (!channel || !channel.isTextBased()) {
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('✨ Vanity Detected')
            .setDescription(
                `${member}\n\n` +
                `Thank you for repping **/shreds**!\n` +
                `You can now enjoy __pic perms__ ${BLACK_HEART}`
            )
            .setThumbnail(
                member.user.displayAvatarURL({
                    extension: 'png',
                    size: 256
                })
            )
            .setFooter({
                text: 'Shreds • Vanity System'
            })
            .setTimestamp();

        await channel.send({
            embeds: [embed],
            allowedMentions: {
                users: [],
                roles: [],
                repliedUser: false
            }
        });
    } catch (error) {
        console.error(
            'Vanity notification error:',
            error
        );
    }
}

// ============================================================
// VANITY ROLE
// ============================================================

async function updateVanityRole(member) {
    if (!member || !member.guild) return;

    const role = findPictureRole(member.guild);

    if (!role || role.managed) return;

    const botMember = member.guild.members.me;

    if (!botMember) return;

    if (
        role.position >=
        botMember.roles.highest.position
    ) {
        console.error(
            `Cannot manage Picture Permissions in ${member.guild.name}: role is too high.`
        );
        return;
    }

    const hasVanity = hasShredsVanity(member);
    const currentlyHasRole = member.roles.cache.has(role.id);

    if (hasVanity && !currentlyHasRole) {
        try {
            await member.roles.add(
                role,
                'Shreds vanity detected'
            );

            vanityState.set(member.id, true);

            console.log(
                `Added Picture Permissions to ${member.user.tag}`
            );

            await sendVanityNotification(member);
        } catch (error) {
            console.error(
                'Vanity role add error:',
                error
            );
        }

        return;
    }

    if (!hasVanity && currentlyHasRole) {
        try {
            await member.roles.remove(
                role,
                'Shreds vanity removed'
            );

            vanityState.set(member.id, false);

            console.log(
                `Removed Picture Permissions from ${member.user.tag}`
            );
        } catch (error) {
            console.error(
                'Vanity role removal error:',
                error
            );
        }

        return;
    }

    vanityState.set(
        member.id,
        currentlyHasRole
    );
}

// ============================================================
// FULL VANITY RECHECK
// ============================================================

async function recheckGuildVanity(guild) {
    try {
        await guild.members.fetch();

        console.log(
            `Rechecking vanity status for ${guild.name}...`
        );

        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue;

            await updateVanityRole(member);
        }

        console.log(
            `Finished vanity recheck for ${guild.name}.`
        );
    } catch (error) {
        console.error(
            `Guild vanity recheck failed for ${guild.name}:`,
            error
        );
    }
}

// ============================================================
// DISCORD CONNECTION RECOVERY
// ============================================================

async function reconnectDiscord(reason = 'Unknown reason') {
    if (reconnecting) {
        console.log(
            'Discord reconnect already in progress.'
        );
        return;
    }

    reconnecting = true;

    console.log('========================================');
    console.log('DISCORD CONNECTION RECOVERY');
    console.log(`Reason: ${reason}`);
    console.log('========================================');

    try {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        try {
            client.destroy();
        } catch (error) {
            console.error(
                'Error destroying old Discord connection:',
                error
            );
        }

        await new Promise(resolve =>
            setTimeout(resolve, RECONNECT_DELAY)
        );

        console.log(
            'Attempting to reconnect to Discord...'
        );

        await client.login(
            process.env.DISCORD_TOKEN
        );

        console.log(
            'Discord reconnect attempt completed.'
        );

        notReadySince = null;
    } catch (error) {
        console.error(
            'Discord reconnect failed:',
            error
        );

        notReadySince = Date.now();

        reconnectTimer = setTimeout(() => {
            reconnectDiscord(
                'Previous reconnect attempt failed'
            );
        }, RECONNECT_DELAY);
    } finally {
        reconnecting = false;
    }
}

// ============================================================
// CONNECTION WATCHDOG
// ============================================================

setInterval(() => {
    try {
        const ready = client.isReady();

        if (ready) {
            if (notReadySince !== null) {
                console.log(
                    'Discord connection is READY again.'
                );
            }

            notReadySince = null;
            return;
        }

        if (notReadySince === null) {
            notReadySince = Date.now();

            console.warn(
                'Discord client is not ready. Starting recovery timer...'
            );

            return;
        }

        const notReadyFor =
            Date.now() - notReadySince;

        console.warn(
            `Discord has not been ready for ${Math.floor(notReadyFor / 1000)} seconds.`
        );

        if (
            notReadyFor >= MAX_NOT_READY_TIME &&
            !reconnecting
        ) {
            reconnectDiscord(
                `Discord client was not ready for ${Math.floor(notReadyFor / 1000)} seconds`
            );
        }
    } catch (error) {
        console.error(
            'Connection watchdog error:',
            error
        );
    }
}, CONNECTION_CHECK_INTERVAL);

// ============================================================
// READY
// ============================================================

client.once('clientReady', async () => {
    notReadySince = null;

    console.log('========================================');
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log(`Guilds: ${client.guilds.cache.size}`);
    console.log('Discord connection READY');
    console.log('========================================');

    console.log('Running startup vanity check...');

    for (const guild of client.guilds.cache.values()) {
        try {
            await recheckGuildVanity(guild);
        } catch (error) {
            console.error(
                `Initial vanity check error in ${guild.name}:`,
                error
            );
        }
    }

    console.log(
        `Vanity system enabled. Rechecking every ${VANITY_RECHECK_INTERVAL / 60000} minutes.`
    );

    setInterval(async () => {
        if (!client.isReady()) {
            console.log(
                'Skipping vanity check because Discord client is not ready.'
            );
            return;
        }

        for (const guild of client.guilds.cache.values()) {
            try {
                await recheckGuildVanity(guild);
            } catch (error) {
                console.error(
                    `Vanity recheck error in ${guild.name}:`,
                    error
                );
            }
        }
    }, VANITY_RECHECK_INTERVAL);
});

// ============================================================
// DISCORD CONNECTION EVENTS
// ============================================================

client.on('error', error => {
    console.error(
        'Discord client error:',
        error
    );
});

client.on('warn', warning => {
    console.warn(
        'Discord warning:',
        warning
    );
});

client.on('shardError', error => {
    console.error(
        'Discord shard error:',
        error
    );
});

client.on('shardDisconnect', (event, shardId) => {
    console.error(
        `Discord shard ${shardId} disconnected.`,
        event
    );

    if (notReadySince === null) {
        notReadySince = Date.now();
    }
});

client.on('shardReconnecting', shardId => {
    console.log(
        `Discord shard ${shardId} reconnecting...`
    );
});

client.on('shardReady', shardId => {
    console.log(
        `Discord shard ${shardId} ready.`
    );

    if (client.isReady()) {
        notReadySince = null;
    }
});

// ============================================================
// PRESENCE UPDATE
// ============================================================

client.on(
    'presenceUpdate',
    async (oldPresence, newPresence) => {
        const member =
            newPresence?.member ||
            oldPresence?.member;

        if (!member) return;
        if (member.user.bot) return;

        try {
            await updateVanityRole(member);
        } catch (error) {
            console.error(
                'Presence vanity update error:',
                error
            );
        }
    }
);

// ============================================================
// MEMBER JOIN
// ============================================================

client.on('guildMemberAdd', async member => {
    try {
        const channel =
            await member.guild.channels.fetch(
                WELCOME_CHANNEL_ID
            );

        if (channel && channel.isTextBased()) {
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
        }

        await updateVanityRole(member);
    } catch (error) {
        console.error(
            'Welcome message error:',
            error
        );
    }
});

// ============================================================
// FIND MESSAGE DELETER
// ============================================================

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

        const logs =
            await guild.fetchAuditLogs({
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

// ============================================================
// SNIPE STORAGE
// ============================================================

client.on(
    'messageDelete',
    async deletedMessage => {
        if (!deletedMessage.guild) return;

        try {
            if (deletedMessage.partial) {
                try {
                    await deletedMessage.fetch();
                } catch {}
            }

            const deleter =
                await findMessageDeleter(
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
                content:
                    deletedMessage.content || '',
                channelId:
                    deletedMessage.channel?.id || null,
                channelName:
                    deletedMessage.channel?.name ||
                    'Unknown channel',
                deletedAt: Date.now(),
                deleterId:
                    deleter?.id || null,
                deleterName:
                    deleter?.tag || null,
                attachments:
                    deletedMessage.attachments
                        ? [
                            ...deletedMessage.attachments.values()
                        ].map(file => ({
                            name: file.name,
                            url: file.url,
                            contentType:
                                file.contentType || ''
                        }))
                        : []
            };

            if (
                !snipeCache.has(
                    deletedMessage.guild.id
                )
            ) {
                snipeCache.set(
                    deletedMessage.guild.id,
                    []
                );
            }

            const snipes =
                snipeCache.get(
                    deletedMessage.guild.id
                );

            snipes.unshift(entry);

            if (
                snipes.length >
                MAX_SNIPE_ENTRIES
            ) {
                snipes.length =
                    MAX_SNIPE_ENTRIES;
            }
        } catch (error) {
            console.error(
                'Snipe storage error:',
                error
            );
        }
    }
);

// ============================================================
// ROLES PAGE
// ============================================================

async function showRolesPage(interaction, roles, page) {
    const perPage = 10;

    const totalPages = Math.max(
        1,
        Math.ceil(roles.length / perPage)
    );

    page = Math.max(
        0,
        Math.min(page, totalPages - 1)
    );

    const start = page * perPage;

    const currentRoles =
        roles.slice(
            start,
            start + perPage
        );

    const roleList =
        currentRoles
            .map(
                (role, index) =>
                    `**${start + index + 1}.** <@&${role.id}>`
            )
            .join('\n');

    const embed = new EmbedBuilder()
        .setTitle('Server Roles')
        .setDescription(
            roleList ||
            'No roles found.'
        )
        .setFooter({
            text:
                `Page ${page + 1} / ${totalPages} • ` +
                `${roles.length} roles`
        });

    const row =
        new ActionRowBuilder()
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
                    .setDisabled(
                        page === totalPages - 1
                    )
            );

    await interaction.update({
        embeds: [embed],
        components: [row],
        allowedMentions: {
            roles: []
        }
    });
}

// ============================================================
// INROLE PAGE
// ============================================================

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

    page = Math.max(
        0,
        Math.min(page, totalPages - 1)
    );

    const start = page * perPage;

    const currentMembers =
        members.slice(
            start,
            start + perPage
        );

    const memberList =
        currentMembers
            .map(
                (member, index) =>
                    `**${start + index + 1}.** ` +
                    `[${member.displayName}](https://discord.com/users/${member.id})`
            )
            .join('\n');

    const embed = new EmbedBuilder()
        .setTitle(
            `Members in ${role.name}`
        )
        .setDescription(
            memberList ||
            'No members found.'
        )
        .setFooter({
            text:
                `Page ${page + 1} / ${totalPages} • ` +
                `${members.length} members`
        });

    const row =
        new ActionRowBuilder()
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
                    .setDisabled(
                        page === totalPages - 1
                    )
            );

    await interaction.update({
        embeds: [embed],
        components: [row]
    });
}

// ============================================================
// BUTTONS
// ============================================================

client.on(
    'interactionCreate',
    async interaction => {
        if (!interaction.isButton()) return;

        try {
            const embed =
                interaction.message.embeds[0];

            if (!embed) {
                return interaction.reply({
                    content:
                        '❌ This menu is no longer valid.',
                    ephemeral: true
                });
            }

            if (
                interaction.customId === 'roles_previous' ||
                interaction.customId === 'roles_next'
            ) {
                const roles = [
                    ...interaction.guild.roles.cache.values()
                ]
                    .filter(
                        role =>
                            role.id !==
                            interaction.guild.id
                    )
                    .sort(
                        (a, b) =>
                            b.position -
                            a.position
                    );

                const match =
                    (
                        embed.footer?.text ||
                        ''
                    ).match(
                        /Page (\d+) \/ (\d+)/
                    );

                let page = match
                    ? Number(match[1]) - 1
                    : 0;

                page +=
                    interaction.customId ===
                    'roles_next'
                        ? 1
                        : -1;

                await showRolesPage(
                    interaction,
                    roles,
                    page
                );

                return;
            }

            if (
                interaction.customId === 'inrole_previous' ||
                interaction.customId === 'inrole_next'
            ) {
                const roleName =
                    (
                        embed.title ||
                        ''
                    ).replace(
                        'Members in ',
                        ''
                    );

                const role =
                    interaction.guild.roles.cache.find(
                        r =>
                            r.name ===
                            roleName
                    );

                if (!role) {
                    return interaction.reply({
                        content:
                            '❌ That role no longer exists.',
                        ephemeral: true
                    });
                }

                await interaction.guild.members.fetch();

                const members =
                    [
                        ...role.members.values()
                    ].sort(
                        (a, b) =>
                            a.user.username.localeCompare(
                                b.user.username
                            )
                    );

                const match =
                    (
                        embed.footer?.text ||
                        ''
                    ).match(
                        /Page (\d+) \/ (\d+)/
                    );

                let page = match
                    ? Number(match[1]) - 1
                    : 0;

                page +=
                    interaction.customId ===
                    'inrole_next'
                        ? 1
                        : -1;

                await showInRolePage(
                    interaction,
                    members,
                    role,
                    page
                );
            }
        } catch (error) {
            console.error(
                'Button interaction error:',
                error
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        '❌ Something went wrong.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

// ============================================================
// COMMAND HANDLER
// ============================================================

client.on(
    'messageCreate',
    async message => {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.content.startsWith(PREFIX)) return;

        const args =
            message.content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);

        const command =
            args.shift()?.toLowerCase();

        if (!command) return;

        // ====================================================
        // PING
        // ====================================================

        if (command === 'ping') {
            const embed =
                new EmbedBuilder()
                    .setTitle('🏓 Pong!')
                    .setDescription(
                        `Bot latency: **${client.ws.ping}ms**`
                    )
                    .setFooter({
                        text: 'Shreds • Connection'
                    })
                    .setTimestamp();

            return message.reply({
                embeds: [embed]
            });
        }

        // ====================================================
        // CMDS
        // ====================================================

        if (command === 'cmds') {
            const embed =
                new EmbedBuilder()
                    .setTitle('Shreds Commands')
                    .setDescription(
                        [
                            '**General**',
                            '`,ping` — Check bot latency',
                            '`,cmds` — View this command list',
                            '',
                            '**Roles**',
                            '`,verify <user>` — Verify a member',
                            '`,role <user> <role>` — Toggle a role',
                            '`,strip <user>` — Remove staff/mod permissions',
                            '`,res <user>` — Restore previously stripped roles',
                            '`,roles` — List server roles',
                            '`,inrole <role>` — Members in a role',
                            '`,boosterrole <colour1> <colour2> <name>` — Create booster role',
                            '',
                            '**Moderation**',
                            '`,kick <user> <reason>` — Kick a member',
                            '`,ban <user> <reason>` — Ban a member',
                            '`,timeout <user> <duration> <reason>` — Timeout a member',
                            '',
                            '**Sniping**',
                            '`,s` — Snipe latest deleted message',
                            '`,s <page>` — Snipe a specific page',
                            '`,cs` — Clear snipe history'
                        ].join('\n')
                    )
                    .setFooter({
                        text: 'Shreds • Command List'
                    })
                    .setTimestamp();

            return message.reply({
                embeds: [embed]
            });
        }

        // ====================================================
        // VERIFY
        // ====================================================

        if (command === 'verify') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageRoles
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Manage Roles** permission to verify members.'
                        )
                    ]
                });
            }

            if (!args[0]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,verify <user>`'
                        )
                    ]
                });
            }

            const member =
                await findMember(
                    message.guild,
                    args[0]
                );

            if (!member) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Member Not Found',
                            'I could not find that member.'
                        )
                    ]
                });
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
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Role Not Found',
                            'The Verified role could not be found.'
                        )
                    ]
                });
            }

            if (
                verifiedRole.position >=
                message.guild.members.me
                    .roles.highest.position
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Role Hierarchy',
                            'I cannot manage the Verified role because it is too high.'
                        )
                    ]
                });
            }

            if (
                member.roles.cache.has(
                    VERIFIED_ROLE_ID
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '⚠️ Already Verified',
                            `${member} already has the Verified role.`
                        )
                    ]
                });
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

                // IMPORTANT:
                // No "Role removed" message is displayed.

                return message.reply({
                    embeds: [
                        successEmbed(
                            '✅ Member Verified',
                            `${member} has been successfully verified.`
                        )
                    ]
                });
            } catch (error) {
                console.error(error);

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Verification Failed',
                            'I could not update that member\'s roles.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // ROLE
        // ====================================================

        if (command === 'role') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageRoles
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Manage Roles** permission.'
                        )
                    ]
                });
            }

            if (!args[0] || !args[1]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,role <user> <role>`'
                        )
                    ]
                });
            }

            const member =
                await findMember(
                    message.guild,
                    args[0]
                );

            const role =
                findRole(
                    message.guild,
                    args.slice(1).join(' ')
                );

            if (!member) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Member Not Found',
                            'I could not find that member.'
                        )
                    ]
                });
            }

            if (!role) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Role Not Found',
                            'I could not find that role.'
                        )
                    ]
                });
            }

            if (role.managed) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Managed Role',
                            'I cannot manually manage that role.'
                        )
                    ]
                });
            }

            if (!canManageRole(message, role)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Role Hierarchy',
                            'You or the bot cannot manage that role because of the role hierarchy.'
                        )
                    ]
                });
            }

            try {
                if (
                    member.roles.cache.has(
                        role.id
                    )
                ) {
                    await member.roles.remove(
                        role,
                        `Role removed by ${message.author.tag}`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                '↩️ Role Removed',
                                `Removed **${role.name}** from ${member}.`
                            )
                        ]
                    });
                }

                await member.roles.add(
                    role,
                    `Role added by ${message.author.tag}`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            '✓ Role Added',
                            `Added **${role.name}** to ${member}.`
                        )
                    ]
                });
            } catch (error) {
                console.error(
                    'Role command error:',
                    error
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Role Update Failed',
                            'I could not update that role.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // STRIP
        // ====================================================

        if (command === 'strip') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageRoles
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Manage Roles** permission to use `,strip`.'
                        )
                    ]
                });
            }

            if (!args[0]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,strip <user>`'
                        )
                    ]
                });
            }

            const member =
                await findMember(
                    message.guild,
                    args[0]
                );

            if (!member) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Member Not Found',
                            'I could not find that member.'
                        )
                    ]
                });
            }

            if (member.id === message.author.id) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Action Blocked',
                            'You cannot strip your own staff permissions.'
                        )
                    ]
                });
            }

            const botMember =
                message.guild.members.me;

            if (!botMember) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Bot Error',
                            'I could not find my member account in this server.'
                        )
                    ]
                });
            }

            const rolesToStrip =
                getStrippableRoles(member);

            const manageableRoles =
                rolesToStrip.filter(
                    role =>
                        role.position <
                        botMember.roles.highest.position
                );

            if (!manageableRoles.length) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '⚠️ Nothing to Strip',
                            `${member} has no staff/mod/admin roles that I can manage.`
                        )
                    ]
                });
            }

            try {
                const roleIds =
                    manageableRoles.map(
                        role => role.id
                    );

                strippedRoles.set(
                    member.id,
                    roleIds
                );

                await member.roles.remove(
                    manageableRoles,
                    `Staff roles stripped by ${message.author.tag}`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            '🛡️ Staff Access Stripped',
                            [
                                `**Member:** ${member}`,
                                `**Roles removed:** ${manageableRoles.length}`,
                                '',
                                manageableRoles
                                    .map(role => `• ${role.name}`)
                                    .join('\n'),
                                '',
                                'Their previous roles have been saved.',
                                'Use `,res <user>` to restore them.'
                            ].join('\n')
                        )
                    ]
                });
            } catch (error) {
                console.error(
                    'Strip command error:',
                    error
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Strip Failed',
                            'I could not remove the staff/mod roles from that member.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // RES
        // ====================================================

        if (command === 'res') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageRoles
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Manage Roles** permission to use `,res`.'
                        )
                    ]
                });
            }

            if (!args[0]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,res <user>`'
                        )
                    ]
                });
            }

            const member =
                await findMember(
                    message.guild,
                    args[0]
                );

            if (!member) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Member Not Found',
                            'I could not find that member.'
                        )
                    ]
                });
            }

            const savedRoles =
                strippedRoles.get(member.id);

            if (
                !savedRoles ||
                !savedRoles.length
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '⚠️ Nothing to Restore',
                            `I do not have any saved stripped roles for ${member}.`
                        )
                    ]
                });
            }

            const botMember =
                message.guild.members.me;

            if (!botMember) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Bot Error',
                            'I could not find my member account in this server.'
                        )
                    ]
                });
            }

            const rolesToRestore =
                savedRoles
                    .map(id =>
                        message.guild.roles.cache.get(id)
                    )
                    .filter(Boolean)
                    .filter(role =>
                        !role.managed &&
                        role.position <
                        botMember.roles.highest.position
                    );

            if (!rolesToRestore.length) {
                strippedRoles.delete(member.id);

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '⚠️ Nothing to Restore',
                            'The saved roles no longer exist or are above my highest role.'
                        )
                    ]
                });
            }

            try {
                await member.roles.add(
                    rolesToRestore,
                    `Previously stripped roles restored by ${message.author.tag}`
                );

                strippedRoles.delete(member.id);

                return message.reply({
                    embeds: [
                        successEmbed(
                            '♻️ Roles Restored',
                            [
                                `**Member:** ${member}`,
                                `**Roles restored:** ${rolesToRestore.length}`,
                                '',
                                rolesToRestore
                                    .map(role => `• ${role.name}`)
                                    .join('\n')
                            ].join('\n')
                        )
                    ]
                });
            } catch (error) {
                console.error(
                    'Restore command error:',
                    error
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Restore Failed',
                            'I could not restore the saved roles.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // ROLES
        // ====================================================

        if (command === 'roles') {
            const roles =
                [
                    ...message.guild.roles.cache.values()
                ]
                    .filter(
                        role =>
                            role.id !==
                            message.guild.id
                    )
                    .sort(
                        (a, b) =>
                            b.position -
                            a.position
                    );

            if (!roles.length) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ No Roles',
                            'There are no roles to display.'
                        )
                    ]
                });
            }

            const perPage = 10;

            const totalPages =
                Math.max(
                    1,
                    Math.ceil(
                        roles.length /
                        perPage
                    )
                );

            const currentRoles =
                roles.slice(
                    0,
                    perPage
                );

            const roleList =
                currentRoles
                    .map(
                        (role, index) =>
                            `**${index + 1}.** <@&${role.id}>`
                    )
                    .join('\n');

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        'Server Roles'
                    )
                    .setDescription(
                        roleList
                    )
                    .setFooter({
                        text:
                            `Page 1 / ${totalPages} • ` +
                            `${roles.length} roles`
                    });

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                'roles_previous'
                            )
                            .setLabel(
                                'Previous'
                            )
                            .setEmoji(
                                '◀️'
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                            .setDisabled(
                                true
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                'roles_next'
                            )
                            .setLabel(
                                'Next'
                            )
                            .setEmoji(
                                '▶️'
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                            .setDisabled(
                                totalPages === 1
                            )
                    );

            return message.reply({
                embeds: [embed],
                components: [row],
                allowedMentions: {
                    roles: []
                }
            });
        }

        // ====================================================
        // INROLE
        // ====================================================

        if (command === 'inrole') {
            let role;

            if (args.length === 0) {
                role =
                    message.member.roles.highest;

                if (
                    !role ||
                    role.id ===
                    message.guild.id
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                '❌ No Role',
                                'You do not have a role to check.'
                            )
                        ]
                    });
                }
            } else {
                role =
                    findRole(
                        message.guild,
                        args.join(' ')
                    );

                if (!role) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                '❌ Role Not Found',
                                'I could not find that role.'
                            )
                        ]
                    });
                }
            }

            await message.guild.members.fetch();

            const members =
                [
                    ...role.members.values()
                ].sort(
                    (a, b) =>
                        a.user.username.localeCompare(
                            b.user.username
                        )
                );

            if (!members.length) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ No Members',
                            `Nobody currently has **${role.name}**.`
                        )
                    ]
                });
            }

            const perPage = 10;

            const totalPages =
                Math.max(
                    1,
                    Math.ceil(
                        members.length /
                        perPage
                    )
                );

            const currentMembers =
                members.slice(
                    0,
                    perPage
                );

            const memberList =
                currentMembers
                    .map(
                        (member, index) =>
                            `**${index + 1}.** ` +
                            `[${member.displayName}](https://discord.com/users/${member.id})`
                    )
                    .join('\n');

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `Members in ${role.name}`
                    )
                    .setDescription(
                        memberList
                    )
                    .setFooter({
                        text:
                            `Page 1 / ${totalPages} • ` +
                            `${members.length} members`
                    });

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                'inrole_previous'
                            )
                            .setLabel(
                                'Previous'
                            )
                            .setEmoji(
                                '◀️'
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                            .setDisabled(
                                true
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                'inrole_next'
                            )
                            .setLabel(
                                'Next'
                            )
                            .setEmoji(
                                '▶️'
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                            .setDisabled(
                                totalPages === 1
                            )
                    );

            return message.reply({
                embeds: [embed],
                components: [row]
            });
        }

        // ====================================================
        // BOOSTER ROLE
        // ====================================================

        if (command === 'boosterrole') {
            const isAdmin =
                message.member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                );

            const isBooster =
                Boolean(
                    message.member.premiumSince
                );

            if (!isAdmin && !isBooster) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You must be a Server Booster or Administrator to use this command.'
                        )
                    ]
                });
            }

            const botMember =
                message.guild.members.me;

            if (!botMember) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Error',
                            'I could not find my bot member in this server.'
                        )
                    ]
                });
            }

            if (
                !botMember.permissions.has(
                    PermissionsBitField.Flags.ManageRoles
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Missing Permission',
                            'I need **Manage Roles** permission.'
                        )
                    ]
                });
            }

            if (args.length < 3) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,boosterrole <colour1> <colour2> <name>`\nExample: `,boosterrole 787878 020105 Hadi`'
                        )
                    ]
                });
            }

            let colour1 = args[0].trim();
            let colour2 = args[1].trim();

            if (!colour1.startsWith('#')) {
                colour1 = `#${colour1}`;
            }

            if (!colour2.startsWith('#')) {
                colour2 = `#${colour2}`;
            }

            const hexRegex = /^#[0-9A-Fa-f]{6}$/;

            if (
                !hexRegex.test(colour1) ||
                !hexRegex.test(colour2)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Colours',
                            'Use two 6-digit HEX colours, e.g. `787878 020105`.'
                        )
                    ]
                });
            }

            const roleName =
                args
                    .slice(2)
                    .join(' ')
                    .trim();

            let role = null;

            try {
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
            } catch (gradientError) {
                console.error(
                    'Gradient role creation failed:',
                    gradientError
                );

                try {
                    role =
                        await message.guild.roles.create({
                            name: roleName,
                            color: colour1,
                            reason:
                                `Booster role created by ${message.author.tag}`
                        });
                } catch (solidError) {
                    console.error(
                        'Solid role creation also failed:',
                        solidError
                    );

                    return message.reply({
                        embeds: [
                            errorEmbed(
                                '❌ Role Creation Failed',
                                'I could not create the booster role. Check the Render logs for the Discord error.'
                            )
                        ]
                    });
                }
            }

            if (!canManageRole(message, role)) {
                try {
                    await role.delete(
                        'Created too high in role hierarchy'
                    );
                } catch {}

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Role Hierarchy',
                            'I created the role, but I cannot manage it. Move my bot role higher.'
                        )
                    ]
                });
            }

            try {
                await message.member.roles.add(
                    role,
                    'Booster role created'
                );

                const isGradient =
                    role.colors?.secondaryColor != null;

                return message.reply({
                    embeds: [
                        successEmbed(
                            '💎 Booster Role Created',
                            isGradient
                                ? `Created gradient role **${role.name}** using \`${colour1}\` → \`${colour2}\` and gave it to ${message.member}.`
                                : `Created **${role.name}** using \`${colour1}\` and gave it to ${message.member}.\n\n⚠️ Discord did not allow the gradient style, so the role was created as a solid colour.`
                        )
                    ]
                });
            } catch (error) {
                console.error(
                    'Booster role assignment error:',
                    error
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Role Assignment Failed',
                            'The role was created, but I could not give it to you. Check the role hierarchy.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // KICK
        // ====================================================

        if (command === 'kick') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.KickMembers
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Kick Members** permission.'
                        )
                    ]
                });
            }

            if (!args[0]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,kick <member> <reason>`'
                        )
                    ]
                });
            }

            const member =
                await findMember(
                    message.guild,
                    args[0]
                );

            if (!member) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Member Not Found',
                            'I could not find that member.'
                        )
                    ]
                });
            }

            if (!member.kickable) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Cannot Kick',
                            'I cannot kick that member because of role hierarchy or permissions.'
                        )
                    ]
                });
            }

            const reason =
                args.slice(1).join(' ') ||
                'No reason provided';

            try {
                await member.kick(reason);

                return message.reply({
                    embeds: [
                        successEmbed(
                            '👢 Member Kicked',
                            [
                                `**Member**`,
                                `${member.user.tag}`,
                                '',
                                `**Reason**`,
                                reason
                            ].join('\n')
                        )
                    ]
                });
            } catch (error) {
                console.error(
                    'Kick error:',
                    error
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Kick Failed',
                            'I could not kick that member.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // BAN
        // ====================================================

        if (command === 'ban') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.BanMembers
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Ban Members** permission.'
                        )
                    ]
                });
            }

            if (!args[0]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,ban <member> <reason>`'
                        )
                    ]
                });
            }

            const member =
                await findMember(
                    message.guild,
                    args[0]
                );

            if (!member) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Member Not Found',
                            'I could not find that member.'
                        )
                    ]
                });
            }

            if (!member.bannable) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Cannot Ban',
                            'I cannot ban that member because of role hierarchy or permissions.'
                        )
                    ]
                });
            }

            const reason =
                args.slice(1).join(' ') ||
                'No reason provided';

            try {
                await member.ban({ reason });

                return message.reply({
                    embeds: [
                        successEmbed(
                            '🔨 Member Banned',
                            [
                                `**Member**`,
                                `${member.user.tag}`,
                                '',
                                `**Reason**`,
                                reason
                            ].join('\n')
                        )
                    ]
                });
            } catch (error) {
                console.error(
                    'Ban error:',
                    error
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Ban Failed',
                            'I could not ban that member.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // TIMEOUT
        // ====================================================

        if (command === 'timeout') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ModerateMembers
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Moderate Members** permission.'
                        )
                    ]
                });
            }

            if (!args[0] || !args[1]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Usage',
                            'Usage: `,timeout <member> <duration> <reason>`\n\nExamples: `20s`, `5m`, `2h`, `7d`'
                        )
                    ]
                });
            }

            const member =
                await findMember(
                    message.guild,
                    args[0]
                );

            if (!member) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Member Not Found',
                            'I could not find that member.'
                        )
                    ]
                });
            }

            const duration =
                parseDuration(args[1]);

            if (!duration) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Invalid Duration',
                            'Use a duration such as `20s`, `5m`, `2h`, or `7d`.'
                        )
                    ]
                });
            }

            const MAX_TIMEOUT =
                28 *
                24 *
                60 *
                60 *
                1000;

            if (duration > MAX_TIMEOUT) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Duration Too Long',
                            'Discord timeouts can only be up to 28 days.'
                        )
                    ]
                });
            }

            if (!member.moderatable) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Cannot Timeout',
                            'I cannot timeout that member because of role hierarchy or permissions.'
                        )
                    ]
                });
            }

            const reason =
                args.slice(2).join(' ') ||
                'No reason provided';

            try {
                await member.timeout(
                    duration,
                    reason
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            '⏱️ Member Timed Out',
                            [
                                `**Member**`,
                                `${member.user.tag}`,
                                '',
                                `**Duration**`,
                                formatDuration(duration),
                                '',
                                `**Reason**`,
                                reason
                            ].join('\n')
                        )
                    ]
                });
            } catch (error) {
                console.error(
                    'Timeout error:',
                    error
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Timeout Failed',
                            'I could not timeout that member.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // SNIPE
        // IMPORTANT: ,s IS NOW AVAILABLE TO EVERYONE
        // ====================================================

        if (command === 's') {
            let page = 1;

            if (args[0]) {
                const parsedPage =
                    Number(args[0]);

                if (
                    !Number.isInteger(parsedPage) ||
                    parsedPage < 1
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                '❌ Invalid Page',
                                'Please enter a valid snipe page.'
                            )
                        ]
                    });
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
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ No Snipe',
                            `There is no snipe page **${page}**.`
                        )
                    ]
                });
            }

            let description =
                entry.content ||
                '*No text content*';

            description +=
                `\n\n**Author:** ${entry.authorName}`;

            description +=
                `\n**Channel:** <#${entry.channelId}>`;

            description +=
                `\n**Deleted by:** ${entry.deleterName || 'Unknown / unavailable'}`;

            description +=
                `\n**Deleted:** <t:${Math.floor(entry.deletedAt / 1000)}:F>`;

            description +=
                `\n**Page:** ${page}/${snipes.length}`;

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        '🕵️ Deleted Message'
                    )
                    .setDescription(
                        description
                    )
                    .setFooter({
                        text: 'Shreds • Snipe'
                    })
                    .setTimestamp();

            const firstImage =
                entry.attachments.find(
                    file =>
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
                        .filter(
                            file =>
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
                                .map(
                                    file =>
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
            }

            return;
        }

        // ====================================================
        // CLEAR SNIPES
        // ,cs REMAINS STAFF/MOD ONLY
        // ====================================================

        if (command === 'cs') {
            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageMessages
                )
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            '❌ Permission Denied',
                            'You need **Manage Messages** permission.'
                        )
                    ]
                });
            }

            snipeCache.delete(
                message.guild.id
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        '🧹 Snipes Cleared',
                        'Snipe history has been cleared.'
                    )
                ]
            });
        }
    }
);

// ============================================================
// PROCESS ERROR HANDLING
// ============================================================

process.on(
    'unhandledRejection',
    error => {
        console.error(
            'UNHANDLED REJECTION:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            'UNCAUGHT EXCEPTION:',
            error
        );
    }
);

// ============================================================
// TOKEN CHECK
// ============================================================

if (!process.env.DISCORD_TOKEN) {
    console.error(
        'DISCORD_TOKEN is missing from environment variables.'
    );

    process.exit(1);
}

// ============================================================
// LOGIN
// ============================================================

console.log(
    'Attempting to connect to Discord...'
);

client.login(
    process.env.DISCORD_TOKEN
).catch(error => {
    console.error(
        '========================================'
    );

    console.error(
        'DISCORD LOGIN FAILED'
    );

    console.error(error);

    console.error(
        '========================================'
    );

    process.exit(1);
});
