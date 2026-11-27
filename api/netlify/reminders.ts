// Netlify Scheduled Function (bundled by scripts/build-netlify.mjs): the daily reminder run.
// Sends nothing until VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set (see README → Notifications).
import { collections } from '../src/db.ts';
import { sendDailyReminders } from '../src/lib/reminders.ts';

export default async () => {
  const run = await sendDailyReminders(await collections());
  console.log('reminders', JSON.stringify(run));
  return new Response(null, { status: 204 });
};

// 03:30 UTC = 09:00 India time.
export const config = { schedule: '30 3 * * *' };
