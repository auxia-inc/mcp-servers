import { WebClient } from '@slack/web-api';

export interface SlackMessage {
  channel: string;
  channelName: string;
  user: string;
  userName: string;
  text: string;
  ts: string;
  timestamp: string;
  threadTs?: string;
  isMention: boolean;
  isDM: boolean;
  hasReactions: boolean;
  reactions?: string[];
  permalink?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isDM: boolean;
  isPrivate: boolean;
  isMpim: boolean;
  unreadCount?: number;
}

export interface SlackUser {
  id: string;
  name: string;
  realName: string;
  email?: string;
  title?: string;
  isBot: boolean;
  isDeleted: boolean;
}

export class SlackMessageClient {
  private client: WebClient;
  private userId: string;
  private userCache: Map<string, SlackUser> = new Map();
  private channelCache: Map<string, string> = new Map();

  constructor(token: string, userId: string) {
    this.client = new WebClient(token);
    this.userId = userId;
  }

  // ============================================
  // USER OPERATIONS
  // ============================================

  async findUser(query: string): Promise<SlackUser | null> {
    // Check cache first (by ID)
    if (this.userCache.has(query)) {
      return this.userCache.get(query)!;
    }

    // Try direct lookup by email first (most reliable)
    if (query.includes('@')) {
      try {
        const result = await this.client.users.lookupByEmail({ email: query });
        if (result.user) {
          const user = this.mapUser(result.user);
          this.userCache.set(user.id, user);
          return user;
        }
      } catch (error) {
        // Fall through to users.list search
      }
    }

    // Try direct lookup by user ID
    if (query.startsWith('U') && query.length === 11) {
      try {
        const result = await this.client.users.info({ user: query });
        if (result.user) {
          const user = this.mapUser(result.user);
          this.userCache.set(user.id, user);
          return user;
        }
      } catch (error) {
        // Fall through to users.list search
      }
    }

    // Search through users.list
    const users = await this.listUsers({ query });
    return users.length > 0 ? users[0] : null;
  }

  async listUsers(options: { query?: string; limit?: number } = {}): Promise<SlackUser[]> {
    const { query, limit = 100 } = options;
    const users: SlackUser[] = [];
    let cursor: string | undefined = undefined;

    do {
      const result = await this.client.users.list({ limit: Math.min(limit, 200), cursor });

      for (const member of result.members || []) {
        if (member.deleted || member.is_bot) continue;

        const user = this.mapUser(member);
        this.userCache.set(user.id, user);

        // Filter by query if provided
        if (query) {
          const q = query.toLowerCase();
          const matches =
            user.name.toLowerCase().includes(q) ||
            user.realName.toLowerCase().includes(q) ||
            (user.email && user.email.toLowerCase().includes(q)) ||
            user.id.toLowerCase() === q;
          if (!matches) continue;
        }

        users.push(user);
        if (users.length >= limit) break;
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor && users.length < limit);

    return users;
  }

  private mapUser(member: any): SlackUser {
    return {
      id: member.id!,
      name: member.name || member.id!,
      realName: member.real_name || member.name || member.id!,
      email: member.profile?.email,
      title: member.profile?.title,
      isBot: member.is_bot || false,
      isDeleted: member.deleted || false
    };
  }

  async getUserName(userId: string): Promise<string> {
    const cached = this.userCache.get(userId);
    if (cached) return cached.realName;

    try {
      const result = await this.client.users.info({ user: userId });
      const userName = result.user?.real_name || result.user?.name || userId;
      if (result.user) {
        this.userCache.set(userId, this.mapUser(result.user));
      }
      return userName;
    } catch (error) {
      return userId;
    }
  }

  // ============================================
  // CHANNEL OPERATIONS
  // ============================================

  async listChannels(options: {
    scope?: 'member' | 'all';
    type?: 'all' | 'public' | 'private' | 'dms' | 'mpim';
    search?: string;
    limit?: number;
  } = {}): Promise<SlackChannel[]> {
    const { scope = 'member', type = 'all', search, limit = 200 } = options;
    const channels: SlackChannel[] = [];

    // Determine channel types to fetch
    let types: string[] = [];
    if (type === 'all') types = ['public_channel', 'private_channel', 'im', 'mpim'];
    else if (type === 'public') types = ['public_channel'];
    else if (type === 'private') types = ['private_channel'];
    else if (type === 'dms') types = ['im'];
    else if (type === 'mpim') types = ['mpim'];

    let cursor: string | undefined = undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Fetch channels based on scope
      let channelList: any[];
      let nextCursor: string | undefined;

      if (scope === 'member') {
        const result = await this.client.users.conversations({
          types: types.join(','),
          limit: 200,
          cursor,
          exclude_archived: true
        });
        channelList = result.channels || [];
        nextCursor = result.response_metadata?.next_cursor;
      } else {
        const result = await this.client.conversations.list({
          types: types.join(','),
          limit: 200,
          cursor,
          exclude_archived: true
        });
        channelList = result.channels || [];
        nextCursor = result.response_metadata?.next_cursor;
      }

      for (const channel of channelList) {
        let channelName = channel.name || channel.id!;

        // For DMs, get the other user's name
        if (channel.is_im && channel.user) {
          channelName = `DM: ${await this.getUserName(channel.user)}`;
        }

        // Filter by search if provided
        if (search && !channelName.toLowerCase().includes(search.toLowerCase())) {
          continue;
        }

        channels.push({
          id: channel.id!,
          name: channelName,
          isDM: channel.is_im || false,
          isPrivate: channel.is_private || false,
          isMpim: channel.is_mpim || false,
          unreadCount: (channel as any).unread_count_display
        });

        if (channels.length >= limit) break;
      }

      cursor = nextCursor;
      if (!cursor || channels.length >= limit) break;
    }

    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getChannelName(channelId: string): Promise<string> {
    if (this.channelCache.has(channelId)) {
      return this.channelCache.get(channelId)!;
    }

    try {
      const result = await this.client.conversations.info({ channel: channelId });
      const channelName = result.channel?.name || channelId;
      this.channelCache.set(channelId, channelName);
      return channelName;
    } catch (error) {
      return channelId;
    }
  }

  // ============================================
  // MESSAGE OPERATIONS
  // ============================================

  async searchMessages(options: {
    query: string;
    scope?: 'all' | 'public' | 'private' | 'dms' | 'mpim';
    limit?: number;
    hoursAgo?: number;
  }): Promise<SlackMessage[]> {
    const { query, scope = 'all', limit = 50, hoursAgo = 24 } = options;
    const messages: SlackMessage[] = [];

    // Build search query with time filter
    const oldest = Math.floor(Date.now() / 1000 - hoursAgo * 3600);
    let searchQuery = `${query} after:${oldest}`;

    // Add scope filter
    if (scope === 'dms') searchQuery += ' in:dm';
    else if (scope === 'mpim') searchQuery += ' in:mpim';
    // Note: public/private filtering is done via separate API params if needed

    try {
      const result = await this.client.search.messages({
        query: searchQuery,
        count: limit,
        sort: 'timestamp',
        sort_dir: 'desc'
      });

      for (const match of result.messages?.matches || []) {
        const channelId = match.channel?.id;
        if (!channelId) continue;

        // Apply scope filter for public/private
        if (scope === 'public' && (match.channel?.is_private || match.channel?.is_im || match.channel?.is_mpim)) continue;
        if (scope === 'private' && !match.channel?.is_private) continue;

        const channelName = await this.getChannelName(channelId);
        const userName = await this.getUserName(match.user || 'unknown');
        const matchAny = match as any;

        messages.push({
          channel: channelId,
          channelName,
          user: match.user || 'unknown',
          userName,
          text: match.text || '',
          ts: match.ts!,
          timestamp: new Date(parseFloat(match.ts!) * 1000).toISOString(),
          threadTs: matchAny.thread_ts,
          isMention: match.text?.includes(`<@${this.userId}>`) || false,
          isDM: match.channel?.is_im || false,
          hasReactions: !match.no_reactions && (matchAny.reactions?.length || 0) > 0,
          reactions: matchAny.reactions?.map((r: any) => r.name!),
          permalink: match.permalink
        });

        if (messages.length >= limit) break;
      }
    } catch (error) {
      console.error('Search error:', error);
    }

    return messages;
  }

  async getMessages(options: {
    channelId?: string;
    channelType?: 'all' | 'public' | 'private' | 'dms' | 'mpim';
    userFilter?: string; // email or name to filter DMs to specific user
    limit?: number;
    hoursAgo?: number;
  } = {}): Promise<SlackMessage[]> {
    const { channelId, channelType = 'all', userFilter, limit = 50, hoursAgo = 24 } = options;
    const oldest = (Date.now() / 1000 - hoursAgo * 3600).toString();
    const messages: SlackMessage[] = [];

    // If userFilter is provided, find their DM channel
    let targetChannelId = channelId;
    if (userFilter && !channelId) {
      const user = await this.findUser(userFilter);
      if (user) {
        const dmChannel = await this.openDM({ userId: user.id });
        if (dmChannel) targetChannelId = dmChannel.channelId;
      }
    }

    // Get channels to fetch from
    let channels: SlackChannel[];
    if (targetChannelId) {
      const name = await this.getChannelName(targetChannelId);
      channels = [{ id: targetChannelId, name, isDM: false, isPrivate: false, isMpim: false }];
    } else {
      channels = await this.listChannels({ scope: 'member', type: channelType, limit: 50 });
    }

    for (const channel of channels) {
      try {
        const result = await this.client.conversations.history({
          channel: channel.id,
          oldest,
          limit: Math.min(limit, 100)
        });

        for (const message of result.messages || []) {
          if (!message.text) continue;

          const userName = await this.getUserName(message.user || 'unknown');
          const isMention = message.text.includes(`<@${this.userId}>`);

          messages.push({
            channel: channel.id,
            channelName: channel.name,
            user: message.user || 'unknown',
            userName,
            text: message.text,
            ts: message.ts!,
            timestamp: new Date(parseFloat(message.ts!) * 1000).toISOString(),
            threadTs: message.thread_ts,
            isMention,
            isDM: channel.isDM,
            hasReactions: (message.reactions?.length || 0) > 0,
            reactions: message.reactions?.map(r => r.name!),
            permalink: await this.getPermalink(channel.id, message.ts!)
          });

          if (messages.length >= limit) break;
        }
      } catch (error) {
        console.error(`Error fetching messages from ${channel.name}:`, error);
      }

      if (messages.length >= limit) break;
    }

    return messages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts)).slice(0, limit);
  }

  private async getPermalink(channelId: string, messageTs: string): Promise<string | undefined> {
    try {
      const result = await this.client.chat.getPermalink({
        channel: channelId,
        message_ts: messageTs
      });
      return result.permalink;
    } catch (error) {
      return undefined;
    }
  }

  // ============================================
  // DM OPERATIONS
  // ============================================

  async openDM(options: {
    userId?: string;
    email?: string;
    name?: string;
  }): Promise<{ channelId: string; userId: string; userName: string } | null> {
    let targetUserId = options.userId;
    let userName = '';

    // Resolve user if email or name provided
    if (!targetUserId && (options.email || options.name)) {
      const user = await this.findUser(options.email || options.name!);
      if (!user) return null;
      targetUserId = user.id;
      userName = user.realName;
    }

    if (!targetUserId) return null;

    try {
      const result = await this.client.conversations.open({ users: targetUserId });
      if (result.channel?.id) {
        if (!userName) userName = await this.getUserName(targetUserId);
        return {
          channelId: result.channel.id,
          userId: targetUserId,
          userName
        };
      }
      return null;
    } catch (error) {
      console.error(`Error opening DM:`, error);
      return null;
    }
  }

  // ============================================
  // SEND OPERATIONS
  // ============================================

  async sendMessage(options: {
    channelId?: string;
    userEmail?: string;
    userName?: string;
    text: string;
    threadTs?: string;
  }): Promise<{ success: boolean; channelId?: string; ts?: string; error?: string }> {
    let targetChannelId = options.channelId;

    // If no channelId, try to open DM with user
    if (!targetChannelId && (options.userEmail || options.userName)) {
      const dm = await this.openDM({ email: options.userEmail, name: options.userName });
      if (!dm) {
        return { success: false, error: `Could not open DM with user` };
      }
      targetChannelId = dm.channelId;
    }

    if (!targetChannelId) {
      return { success: false, error: 'No channel specified and could not resolve user' };
    }

    try {
      const result = await this.client.chat.postMessage({
        channel: targetChannelId,
        text: options.text,
        thread_ts: options.threadTs
      });
      return { success: true, channelId: targetChannelId, ts: result.ts };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async addReaction(channelId: string, timestamp: string, emoji: string): Promise<void> {
    await this.client.reactions.add({
      channel: channelId,
      timestamp,
      name: emoji
    });
  }

  async deleteMessage(channelId: string, timestamp: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.chat.delete({
        channel: channelId,
        ts: timestamp
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ============================================
  // FORMATTING
  // ============================================

  formatMessagesCompact(messages: SlackMessage[]): string {
    if (messages.length === 0) {
      return 'No messages found.';
    }

    let result = `Found ${messages.length} message(s):\n\n`;

    for (const msg of messages) {
      result += `[${msg.timestamp}] #${msg.channelName}\n`;
      result += `From: ${msg.userName} (${msg.user})\n`;
      result += `Text: ${msg.text}\n`;
      if (msg.threadTs) result += `Thread: ${msg.threadTs}\n`;
      if (msg.permalink) result += `Link: ${msg.permalink}\n`;
      if (msg.hasReactions && msg.reactions) result += `Reactions: ${msg.reactions.join(', ')}\n`;
      result += `\n`;
    }

    return result;
  }

  formatChannelsCompact(channels: SlackChannel[]): string {
    if (channels.length === 0) {
      return 'No channels found.';
    }

    let result = `Found ${channels.length} channel(s):\n\n`;

    for (const ch of channels) {
      const type = ch.isDM ? 'DM' : ch.isMpim ? 'Group DM' : ch.isPrivate ? 'Private' : 'Public';
      const unread = ch.unreadCount ? ` (${ch.unreadCount} unread)` : '';
      result += `- ${ch.name} (${ch.id}) [${type}]${unread}\n`;
    }

    return result;
  }

  formatUsersCompact(users: SlackUser[]): string {
    if (users.length === 0) {
      return 'No users found.';
    }

    let result = `Found ${users.length} user(s):\n\n`;

    for (const user of users) {
      result += `- ${user.realName} (@${user.name})\n`;
      result += `  ID: ${user.id}\n`;
      if (user.email) result += `  Email: ${user.email}\n`;
      if (user.title) result += `  Title: ${user.title}\n`;
    }

    return result;
  }
}
