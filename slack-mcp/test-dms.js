const { WebClient } = require('@slack/web-api');

const token = process.env.SLACK_BOT_TOKEN;
const userId = process.env.SLACK_USER_ID;

console.log('Using user ID:', userId);
console.log('Token starts with:', token?.substring(0, 10));

const client = new WebClient(token);

async function test() {
  console.log('\n1. Testing conversations.list with im type...');
  const result = await client.conversations.list({
    types: 'im',
    limit: 100
  });
  
  console.log('Total IM channels:', result.channels?.length || 0);
  
  if (result.channels && result.channels.length > 0) {
    console.log('\nFirst 5 IM channels:');
    for (const ch of result.channels.slice(0, 5)) {
      console.log(`  - ID: ${ch.id}, is_im: ${ch.is_im}, user: ${ch.user}`);
    }
    
    console.log('\n2. Testing history on first IM channel...');
    const firstChannel = result.channels[0];
    try {
      const history = await client.conversations.history({
        channel: firstChannel.id,
        limit: 5
      });
      console.log(`Messages in channel ${firstChannel.id}: ${history.messages?.length || 0}`);
      if (history.messages && history.messages.length > 0) {
        const msg = history.messages[0];
        console.log('Sample message:');
        console.log('  - User:', msg.user);
        console.log('  - Text:', msg.text?.substring(0, 100));
        console.log('  - TS:', msg.ts);
      }
    } catch (err) {
      console.error('Error fetching history:', err.data || err.message);
    }
  } else {
    console.log('No IM channels found!');
  }
}

test().catch(err => console.error('Error:', err.data || err.message));
