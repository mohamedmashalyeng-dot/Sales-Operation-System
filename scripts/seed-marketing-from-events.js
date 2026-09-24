'use strict';

const { Client } = require('pg');
require('../server');

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`
      insert into app_marketing_settings (id, provider, account_name, daily_limit, data, updated_at)
      values ('main', 'eventbrite', 'Kent Business College', 10000, jsonb_build_object('source', 'eventbrite-and-spreadsheet'), now())
      on conflict (id) do update set
        provider = excluded.provider,
        account_name = excluded.account_name,
        daily_limit = excluded.daily_limit,
        data = excluded.data,
        updated_at = now()
    `);

    await client.query(`
      insert into app_marketing_subscriber_lists (id, provider, provider_list_id, name, description, data, updated_at)
      values (
        'all-event-attendees',
        'eventbrite',
        'all-event-attendees',
        'All event attendees',
        'Audience created from synced Eventbrite and spreadsheet attendee records',
        jsonb_build_object('source', 'app_events'),
        now()
      )
      on conflict (id) do update set
        description = excluded.description,
        data = excluded.data,
        updated_at = now()
    `);

    await client.query(`
      insert into app_marketing_campaigns (
        id, provider, provider_campaign_id, event_id, eventbrite_event_id, name, subject,
        status, campaign_type, source, audience_name, scheduled_at, sent_at, event_start_at, data, updated_at
      )
      select
        'MKT-' || id,
        case when data->>'eventbrite_event_id' is not null then 'eventbrite' else 'spreadsheet' end,
        coalesce(data->>'eventbrite_event_id', concat_ws(':', nullif(data->>'sheet_event_id', ''), id), id),
        id,
        data->>'eventbrite_event_id',
        name,
        name,
        case
          when lower(coalesce(data->>'status', '')) like '%cancel%' then 'Cancelled'
          when start_at > now() then 'Draft'
          else 'Sent'
        end,
        'Email campaign',
        coalesce(campaign, 'Eventbrite'),
        'All event attendees',
        case when start_at > now() then start_at else null end,
        case when start_at <= now() then start_at else null end,
        start_at,
        data,
        now()
      from app_events
      on conflict (id) do update set
        provider = excluded.provider,
        provider_campaign_id = excluded.provider_campaign_id,
        event_id = excluded.event_id,
        eventbrite_event_id = excluded.eventbrite_event_id,
        name = excluded.name,
        subject = excluded.subject,
        status = excluded.status,
        campaign_type = excluded.campaign_type,
        source = excluded.source,
        audience_name = excluded.audience_name,
        scheduled_at = excluded.scheduled_at,
        sent_at = excluded.sent_at,
        event_start_at = excluded.event_start_at,
        data = excluded.data,
        updated_at = now()
    `);

    await client.query(`
      with attendee_rows as (
        select
          e.id as event_id,
          'MKT-' || e.id as campaign_id,
          e.start_at,
          jsonb_array_elements(coalesce(e.attendees, '[]'::jsonb)) as a
        from app_events e
        where jsonb_typeof(coalesce(e.attendees, '[]'::jsonb)) = 'array'
      ),
      normalized as (
        select
          'SUB-' || md5(lower(coalesce(nullif(a->>'email', ''), a->>'id', a->>'attendee_id', campaign_id))) as subscriber_id,
          lower(nullif(a->>'email', '')) as email,
          coalesce(nullif(a->>'first_name', ''), split_part(coalesce(a->>'name', ''), ' ', 1)) as first_name,
          nullif(coalesce(a->>'last_name', regexp_replace(coalesce(a->>'name', ''), '^\\S+\\s*', '')), '') as last_name,
          nullif(a->>'phone', '') as phone,
          a
        from attendee_rows
        where coalesce(nullif(a->>'email', ''), nullif(a->>'id', ''), nullif(a->>'attendee_id', '')) is not null
      )
      insert into app_marketing_subscribers (id, email, first_name, last_name, phone, source, consent_status, data, updated_at)
      select
        subscriber_id,
        coalesce(email, subscriber_id || '@event.local'),
        first_name,
        last_name,
        phone,
        'Event',
        'Unknown',
        a,
        now()
      from (
        select distinct on (coalesce(email, subscriber_id || '@event.local'))
          subscriber_id, email, first_name, last_name, phone, a
        from normalized
        order by coalesce(email, subscriber_id || '@event.local'), subscriber_id
      ) deduped
      on conflict (email) do update set
        first_name = coalesce(excluded.first_name, app_marketing_subscribers.first_name),
        last_name = coalesce(excluded.last_name, app_marketing_subscribers.last_name),
        phone = coalesce(excluded.phone, app_marketing_subscribers.phone),
        data = excluded.data,
        updated_at = now()
    `);

    await client.query(`
      with attendee_rows as (
        select
          e.id as event_id,
          'MKT-' || e.id as campaign_id,
          e.start_at,
          jsonb_array_elements(coalesce(e.attendees, '[]'::jsonb)) as a
        from app_events e
        where jsonb_typeof(coalesce(e.attendees, '[]'::jsonb)) = 'array'
      ),
      normalized as (
        select
          'MKR-' || md5(campaign_id || '|' || lower(coalesce(nullif(a->>'email', ''), a->>'id', a->>'attendee_id', a::text))) as id,
          campaign_id,
          a->>'lead_id' as lead_id,
          coalesce(nullif(a->>'id', ''), nullif(a->>'attendee_id', ''), md5(a::text)) as attendee_id,
          lower(nullif(a->>'email', '')) as email,
          coalesce(nullif(a->>'first_name', ''), split_part(coalesce(a->>'name', ''), ' ', 1)) as first_name,
          nullif(coalesce(a->>'last_name', regexp_replace(coalesce(a->>'name', ''), '^\\S+\\s*', '')), '') as last_name,
          nullif(a->>'phone', '') as phone,
          nullif(a->>'job_title', '') as job_title,
          case
            when a->>'attended_at' is not null or lower(coalesce(a->>'status', '')) ~ 'attended|checked|present' then 'Clicked'
            when lower(coalesce(a->>'status', '')) ~ 'confirm|attending' then 'Opened'
            when lower(coalesce(a->>'status', '')) ~ 'declined|cancel|unsub' then 'Unsubscribed'
            when lower(coalesce(a->>'status', '')) ~ 'no answer|bounce|not reached' then 'Bounced'
            else 'Delivered'
          end as status,
          start_at,
          a
        from attendee_rows
      )
      insert into app_marketing_recipients (
        id, campaign_id, lead_id, attendee_id, email, first_name, last_name, phone, job_title, status,
        delivered_at, opened_at, clicked_at, unsubscribed_at, bounced_at, data, updated_at
      )
      select
        id,
        campaign_id,
        nullif(lead_id, ''),
        attendee_id,
        email,
        first_name,
        last_name,
        phone,
        job_title,
        status,
        start_at,
        case when status in ('Opened', 'Clicked') then start_at end,
        case when status = 'Clicked' then coalesce((a->>'attended_at')::timestamptz, start_at) end,
        case when status = 'Unsubscribed' then start_at end,
        case when status = 'Bounced' then start_at end,
        a,
        now()
      from (
        select distinct on (id) *
        from normalized
        order by id
      ) normalized
      on conflict (id) do update set
        lead_id = excluded.lead_id,
        attendee_id = excluded.attendee_id,
        email = excluded.email,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone = excluded.phone,
        job_title = excluded.job_title,
        status = excluded.status,
        delivered_at = excluded.delivered_at,
        opened_at = excluded.opened_at,
        clicked_at = excluded.clicked_at,
        unsubscribed_at = excluded.unsubscribed_at,
        bounced_at = excluded.bounced_at,
        data = excluded.data,
        updated_at = now()
    `);

    await client.query(`
      insert into app_marketing_subscriber_list_members (list_id, subscriber_id, data)
      select 'all-event-attendees', id, jsonb_build_object('source', 'seed')
      from app_marketing_subscribers
      on conflict (list_id, subscriber_id) do nothing
    `);

    await client.query(`
      update app_marketing_subscriber_lists
      set subscriber_count = (
        select count(*) from app_marketing_subscriber_list_members where list_id = 'all-event-attendees'
      ),
      updated_at = now()
      where id = 'all-event-attendees'
    `);

    await client.query(`
      insert into app_marketing_campaign_metrics (
        campaign_id, revenue, ticket_sales, delivered, opened, clicks, unsubscribed, bounced,
        open_rate, click_rate, unsubscribe_rate, bounce_rate, data, updated_at
      )
      select
        c.id,
        0,
        count(r.id),
        count(r.id),
        count(*) filter (where r.status in ('Opened', 'Clicked')),
        count(*) filter (where r.status = 'Clicked'),
        count(*) filter (where r.status = 'Unsubscribed'),
        count(*) filter (where r.status = 'Bounced'),
        case when count(r.id) > 0 then (count(*) filter (where r.status in ('Opened', 'Clicked')))::numeric / count(r.id) else 0 end,
        case when count(r.id) > 0 then (count(*) filter (where r.status = 'Clicked'))::numeric / count(r.id) else 0 end,
        case when count(r.id) > 0 then (count(*) filter (where r.status = 'Unsubscribed'))::numeric / count(r.id) else 0 end,
        case when count(r.id) > 0 then (count(*) filter (where r.status = 'Bounced'))::numeric / count(r.id) else 0 end,
        jsonb_build_object('source', 'derived_from_recipients'),
        now()
      from app_marketing_campaigns c
      left join app_marketing_recipients r on r.campaign_id = c.id
      group by c.id
      on conflict (campaign_id) do update set
        revenue = excluded.revenue,
        ticket_sales = excluded.ticket_sales,
        delivered = excluded.delivered,
        opened = excluded.opened,
        clicks = excluded.clicks,
        unsubscribed = excluded.unsubscribed,
        bounced = excluded.bounced,
        open_rate = excluded.open_rate,
        click_rate = excluded.click_rate,
        unsubscribe_rate = excluded.unsubscribe_rate,
        bounce_rate = excluded.bounce_rate,
        data = excluded.data,
        updated_at = now()
    `);

    await client.query('commit');

    const summary = await client.query(`
      select
        (select count(*) from app_marketing_campaigns) as campaigns,
        (select count(*) from app_marketing_recipients) as recipients,
        (select count(*) from app_marketing_subscribers) as subscribers,
        (select count(*) from app_marketing_campaign_metrics) as metrics,
        (select subscriber_count from app_marketing_subscriber_lists where id = 'all-event-attendees') as list_members
    `);
    console.log(JSON.stringify(summary.rows[0], null, 2));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
