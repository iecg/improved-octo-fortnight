// Household Chores: daily chore reminder push notifications.
//
// Triggered hourly by the pg_cron job in
// supabase/migrations/20260807152707_push_notifications_cron.sql. Runs
// hourly (not once a day) because households can be in any timezone; for
// each household we compute "today" in ITS timezone and only notify once
// that household's local day has actually started.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically in
// the Edge Function runtime environment - no manual configuration needed.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_BATCH_SIZE = 100;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function todayInTimezone(timezone: string): string {
  // en-CA formats as YYYY-MM-DD, which matches Postgres `date` text form.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
}

async function sendExpoPushBatch(messages: ExpoPushMessage[]) {
  const response = await fetch(EXPO_PUSH_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    console.error('Expo push API error', response.status, await response.text());
    return [];
  }

  const { data } = await response.json();
  return data as { status: string; message?: string; details?: { error?: string } }[];
}

Deno.serve(async (_req) => {
  const { data: households, error: householdsError } = await supabase
    .from('households')
    .select('id, timezone');

  if (householdsError) {
    return new Response(JSON.stringify({ error: householdsError.message }), { status: 500 });
  }

  const messagesByToken = new Map<string, ExpoPushMessage>();

  for (const household of households ?? []) {
    const today = todayInTimezone(household.timezone);

    // Idempotent — safe even if a device's clock/timezone data is stale
    // relative to a household member's local screen.
    const { error: ensureError } = await supabase.rpc('ensure_todays_instances', {
      p_household_id: household.id,
      p_for_date: today,
    });
    if (ensureError) {
      console.error(`ensure_todays_instances failed for household ${household.id}`, ensureError);
      continue;
    }

    const { data: pending, error: pendingError } = await supabase
      .from('chore_instances')
      .select('assigned_to')
      .eq('household_id', household.id)
      .eq('due_date', today)
      .eq('status', 'pending');

    if (pendingError) {
      console.error(`Fetching pending instances failed for household ${household.id}`, pendingError);
      continue;
    }
    if (!pending || pending.length === 0) continue;

    const countByUser = new Map<string, number>();
    for (const instance of pending) {
      countByUser.set(instance.assigned_to, (countByUser.get(instance.assigned_to) ?? 0) + 1);
    }

    const userIds = [...countByUser.keys()];
    const { data: tokens, error: tokensError } = await supabase
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', userIds);

    if (tokensError) {
      console.error(`Fetching push tokens failed for household ${household.id}`, tokensError);
      continue;
    }

    for (const { user_id, token } of tokens ?? []) {
      const count = countByUser.get(user_id) ?? 0;
      messagesByToken.set(token, {
        to: token,
        title: 'Chores due today',
        body: count === 1 ? 'You have 1 chore due today.' : `You have ${count} chores due today.`,
        sound: 'default',
      });
    }
  }

  const allMessages = [...messagesByToken.values()];
  const staleTokens: string[] = [];

  for (let i = 0; i < allMessages.length; i += EXPO_PUSH_BATCH_SIZE) {
    const batch = allMessages.slice(i, i + EXPO_PUSH_BATCH_SIZE);
    const receipts = await sendExpoPushBatch(batch);
    receipts.forEach((receipt, index) => {
      if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
        staleTokens.push(batch[index].to);
      }
    });
  }

  if (staleTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', staleTokens);
  }

  return new Response(
    JSON.stringify({ notified: allMessages.length, staleTokensRemoved: staleTokens.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
