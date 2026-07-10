const webpush = require('web-push');

// Triggered daily by Vercel Cron (see vercel.json). Sends the daily-lineup
// reminder push to every stored subscription, and prunes ones that have
// expired or been revoked (410/404 from the push service).
module.exports = async (req, res) => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
  // CRON_SECRET is set as an env var — reject anything else so this endpoint
  // can't be used by a random visitor to spam every subscriber.
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Missing required environment variables' });
    return;
  }

  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:Bradders101@icloud.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const sbUrl = SUPABASE_URL || 'https://ecjrsjxvdtmvtgygnwxd.supabase.co';
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  const listResp = await fetch(`${sbUrl}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth`, { headers });
  if (!listResp.ok) {
    res.status(502).json({ error: 'Failed to read subscriptions', detail: await listResp.text() });
    return;
  }
  const subs = await listResp.json();

  const payload = JSON.stringify({
    title: "⚽ Today's Legendary XI is live",
    body: "Keep your streak going — guess today's lineup.",
    url: 'https://legendary-xi.vercel.app'
  });

  let sent = 0, pruned = 0, failed = 0;
  await Promise.all(subs.map(async (row) => {
    const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        pruned++;
        await fetch(`${sbUrl}/rest/v1/push_subscriptions?id=eq.${row.id}`, { method: 'DELETE', headers });
      } else {
        failed++;
      }
    }
  }));

  res.status(200).json({ total: subs.length, sent, pruned, failed });
};
