"use strict";

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function findBaileysPath() {
    const possiblePaths = [
        path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys'),
        path.join(__dirname, '..', '..', '@whiskeysockets', 'baileys'),
        path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys'),
    ];
    
    try {
        const resolved = require.resolve('@whiskeysockets/baileys/package.json');
        possiblePaths.unshift(resolved.replace('/package.json', ''));
    } catch (e) {}
    
    for (const baileysPath of possiblePaths) {
        try {
            if (fs.existsSync(path.join(baileysPath, 'lib', 'Socket', 'newsletter.js'))) {
                return baileysPath;
            }
        } catch (e) {}
    }
    
    return null;
}

const CLEAN_NEWSLETTER_JS = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractNewsletterMetadata = exports.makeNewsletterSocket = void 0;
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const WABinary_1 = require("../WABinary");
const groups_1 = require("./groups");
const Boom = require('@hapi/boom').Boom;

const wMexQuery = (variables, queryId, query, generateMessageTag) => {
	return query({
		tag: 'iq',
		attrs: {
			id: generateMessageTag(),
			type: 'get',
			to: WABinary_1.S_WHATSAPP_NET,
			xmlns: 'w:mex'
		},
		content: [
			{
				tag: 'query',
				attrs: { query_id: queryId },
				content: Buffer.from(JSON.stringify({ variables }), 'utf8')
			}
		]
	})
}

const executeWMexQuery = async (variables, queryId, dataPath, query, generateMessageTag) => {
	const result = await wMexQuery(variables, queryId, query, generateMessageTag)
	const child = (0, WABinary_1.getBinaryNodeChild)(result, 'result')
	if (child?.content) {
		const data = JSON.parse(child.content.toString())
		if (data.errors?.length) {
			throw new Boom(data.errors.map(err => err.message).join(', '), { statusCode: 400 })
		}
		return data?.data?.[dataPath]
	}
	throw new Boom('Tidak ada respons data', { statusCode: 400 })
}

const makeNewsletterSocket = (config) => {
    const sock = (0, groups_1.makeGroupsSocket)(config);
    const { authState, query, generateMessageTag } = sock;
    const encoder = new TextEncoder();

    const newsletterQuery = async (jid, type, content) => {
        return query({
            tag: 'iq',
            attrs: { id: generateMessageTag(), type, to: jid },
            content
        });
    };

    const newsletterWMexQuery = async (jid, queryId, variables = {}) => {
        return executeWMexQuery(
            { newsletter_id: jid, ...variables },
            queryId,
            'xwa2_newsletter',
            query,
            generateMessageTag
        );
    };

    const parseFetchedUpdates = async (node, type) => {
        let child = (0, WABinary_1.getBinaryNodeChild)(node, type);
        if (!child) return [];
        return Promise.all(WABinary_1.getAllBinaryNodeChildren(child, 'message').map(async (messageNode) => {
            const data = {
                server_id: messageNode.attrs['server_id'],
                views: parseInt(messageNode.attrs['views'] || '0'),
                reactions: messageNode.attrs['reactions'] || []
            };
            if (type === 'messages') {
                const { fullMessage, decrypt } = await (0, Utils_1.decryptMessageNode)(messageNode, authState);
                await decrypt();
                data.message = fullMessage;
            }
            return data;
        }));
    };

    return {
        ...sock,
        newsletterFetchAllSubscribe: async () => executeWMexQuery({}, '6388546374527196', 'xwa2_newsletter_subscribed', query, generateMessageTag),
        subscribeNewsletterUpdates: async (jid) => newsletterQuery(jid, 'set', [{ tag: 'live_updates', attrs: {} }]),
        newsletterReactionMode: async (jid, mode) => newsletterWMexQuery(jid, 'JOB_MUTATION', { settings: { reaction_codes: mode } }),
        newsletterUpdateDescription: async (jid, description) => newsletterWMexQuery(jid, 'JOB_MUTATION', { description }),
        newsletterId: async (url) => {
            const parts = url.split('/');
            return executeWMexQuery({ key: parts[parts.length - 2] }, 'METADATA', 'xwa2_newsletter', query, generateMessageTag);
        },
        newsletterUpdateName: async (jid, name) => newsletterWMexQuery(jid, 'JOB_MUTATION', { name }),
        newsletterUpdatePicture: async (jid, content) => {
            const { img } = await (0, Utils_1.generateProfilePicture)(content);
            return newsletterWMexQuery(jid, 'JOB_MUTATION', { picture: img.toString('base64') });
        },
        newsletterRemovePicture: async (jid) => newsletterWMexQuery(jid, 'JOB_MUTATION', { picture: '' }),
        newsletterUnfollow: async (jid) => newsletterWMexQuery(jid, 'UNFOLLOW'),
        newsletterFollow: async (jid) => newsletterWMexQuery(jid, 'FOLLOW'),
        newsletterUnmute: async (jid) => newsletterWMexQuery(jid, 'UNMUTE'),
        newsletterMute: async (jid) => newsletterWMexQuery(jid, 'MUTE'),
        newsletterCreate: async (name, description) => executeWMexQuery({ name, description }, 'CREATE', 'xwa2_newsletter', query, generateMessageTag),
        newsletterMetadata: async (jid) => newsletterWMexQuery(jid, 'METADATA'),
        newsletterAdminCount: async (jid) => newsletterWMexQuery(jid, 'ADMIN_COUNT'),
        newsletterChangeOwner: async (jid, user) => newsletterWMexQuery(jid, 'CHANGE_OWNER', { user_id: user }),
        newsletterDemote: async (jid, user) => newsletterWMexQuery(jid, 'DEMOTE', { user_id: user }),
        newsletterDelete: async (jid) => newsletterWMexQuery(jid, 'DELETE'),
        newsletterReactMessage: async (jid, serverId, code) => query({
            tag: 'message',
            attrs: { to: jid, type: 'reaction', server_id: serverId, id: generateMessageTag(), code },
            content: [{ tag: 'reaction', attrs: { code } }]
        }),
        newsletterFetchMessages: async (jid, count = 100) => parseFetchedUpdates(await newsletterQuery(jid, 'get', [{ tag: 'messages', attrs: { count } }]), 'messages'),
        newsletterFetchUpdates: async (jid, count = 100) => parseFetchedUpdates(await newsletterQuery(jid, 'get', [{ tag: 'message_updates', attrs: { count } }]), 'message_updates')
    };
};

exports.makeNewsletterSocket = makeNewsletterSocket;
const extractNewsletterMetadata = (node, isCreate) => {
    const result = WABinary_1.getBinaryNodeChild(node, 'result')?.content?.toString();
    const data = JSON.parse(result).data;
    const path = isCreate ? data['xwa2_newsletter_create'] : data['xwa2_newsletter'];
    return {
        id: path?.id,
        name: path?.thread_metadata?.name,
        description: path?.thread_metadata?.description,
        subscribers: path?.thread_metadata?.subscribers_count,
        picture: (0, Utils_1.getUrlFromDirectPath)(path?.thread_metadata?.picture?.direct_path || '')
    };
};
exports.extractNewsletterMetadata = extractNewsletterMetadata;`;

function getFileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return crypto.createHash('md5').update(content).digest('hex');
    } catch (e) {
        return null;
    }
}

function installNewsletterCleanPatch() {
    try {
        const baileysPath = findBaileysPath();
        if (!baileysPath) return false;

        const newsletterPath = path.join(baileysPath, 'lib', 'Socket', 'newsletter.js');
        const backupPath = path.join(baileysPath, 'lib', 'Socket', 'newsletter_original.js');
        const cacheFilePath = path.join(baileysPath, 'node_modules', '.cache_clean');

        if (fs.existsSync(newsletterPath) && !fs.existsSync(backupPath)) {
            fs.copyFileSync(newsletterPath, backupPath);
        }

        if (fs.existsSync(cacheFilePath)) return true;

        if (!fs.existsSync(path.join(baileysPath, 'node_modules'))) {
            fs.mkdirSync(path.join(baileysPath, 'node_modules'), { recursive: true });
        }

        const currentHash = getFileHash(newsletterPath);
        const cleanHash = crypto.createHash('md5').update(CLEAN_NEWSLETTER_JS).digest('hex');

        if (currentHash === cleanHash) {
            fs.writeFileSync(cacheFilePath, 'CLEAN');
            return true;
        }

        fs.writeFileSync(newsletterPath, CLEAN_NEWSLETTER_JS);
        const newHash = getFileHash(newsletterPath);

        if (newHash === cleanHash) {
            fs.writeFileSync(cacheFilePath, 'CLEAN');
            return true;
        } else {
            if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, newsletterPath);
            return false;
        }
    } catch (e) {
        return false;
    }
}

function restoreNewsletterOriginal() {
    try {
        const baileysPath = findBaileysPath();
        if (!baileysPath) return false;

        const newsletterPath = path.join(baileysPath, 'lib', 'Socket', 'newsletter.js');
        const backupPath = path.join(baileysPath, 'lib', 'Socket', 'newsletter_original.js');
        const cacheFilePath = path.join(baileysPath, 'node_modules', '.cache_clean');

        if (fs.existsSync(cacheFilePath)) fs.unlinkSync(cacheFilePath);
        if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, newsletterPath);

        return true;
    } catch (e) {
        return false;
    }
}

exports.findBaileysPath = findBaileysPath;
exports.installNewsletterCleanPatch = installNewsletterCleanPatch;
exports.restoreNewsletterOriginal = restoreNewsletterOriginal;