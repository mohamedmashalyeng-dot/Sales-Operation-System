import type { Touchpoint } from "@/store/types";
import { at, hoursAgo, minutesAgo } from "@/store/seed/helpers";
import { categoryForInteractionType } from "@/config/attribution";

/**
 * A chronological, cross-linked multi-touch journey for the demonstration leads.
 * Each touchpoint is attributed to a source + channel and references the real
 * demo record (call, email, event registration, application) where one exists —
 * so reports reconcile with the Leads, Inbox, Zoom, Events and Planner modules.
 */
export function buildTouchpoints(): Touchpoint[] {
  return [
    /* ---------------- L-2041 Daniel Mercer (Facebook Ads) ---------------- */
    tp("TP-2041-1", "L-2041", at(-19, 10, 12), "Facebook Ads", "Paid Social", "Web form", "Positive", "u-leila", "Submitted the CMI enquiry form from a Facebook advert.", "manual"),
    tp("TP-2041-2", "L-2041", at(-18, 9, 30), "Website", "Web", "Outbound call", "Positive", "u-amara", "First qualifying call about entry requirements.", "manual"),
    tp("TP-2041-3", "L-2041", at(-2, 15, 40), "Facebook Ads", "Paid Social", "Email reply", "Neutral", "u-amara", "Replied asking for a call about levy funding.", "manual"),

    /* ---------------- L-2038 Priya Raman (Google Ads) ---------------- */
    tp("TP-2038-1", "L-2038", at(-24, 9, 5), "Google Ads", "Paid Search", "Web form", "Positive", "u-tom", "Arrived via a paid search advert for the Level 6 programme.", "manual"),
    tp("TP-2038-2", "L-2038", at(-20, 11, 0), "Google Ads", "Paid Search", "Email sent", "Neutral", "u-tom", "Sent programme brochure and funding summary.", "manual"),
    tp("TP-2038-3", "L-2038", at(-10, 10, 0), "Website", "Web", "Application submitted", "Positive", "u-tom", "Application submitted for two learners.", "application", "APP-50231"),
    tp("TP-2038-4", "L-2038", at(-2, 14, 10), "Google Ads", "Paid Search", "Email sent", "Neutral", "u-tom", "Proposal sent.", "email", "TH-1187"),
    tp("TP-2038-5", "L-2038", hoursAgo(28), "Google Ads", "Paid Search", "Email reply", "Positive", "u-tom", "Asked to confirm the January start date.", "email", "TH-1187"),

    /* ---------------- L-2036 Brightworks Ltd (Referral) ---------------- */
    tp("TP-2036-1", "L-2036", hoursAgo(3), "Referral", "Referral", "Inbound call", "Positive", "u-amara", "Referred by an existing employer partner.", "call", "CL-5501"),

    /* ---------------- L-2033 Grace Adeyemi (Eventbrite) ---------------- */
    tp("TP-2033-1", "L-2033", at(-9, 18, 30), "Eventbrite", "Events", "Event registration", "Positive", "u-leila", "Registered for the Open Evening on Eventbrite.", "event", "EV-2101:R-9001:registration"),
    tp("TP-2033-2", "L-2033", at(-1, 10, 15), "Eventbrite", "Events", "Outbound call", "Positive", "u-leila", "Advisory call after the Open Evening.", "call", "CL-5506"),
    tp("TP-2033-3", "L-2033", at(-1, 15, 10), "Email Campaigns", "Email", "Email reply", "Positive", "u-leila", "Confirmed she wants to proceed to application.", "email", "TH-1182"),

    /* ---------------- L-2029 Marek Kowalski (Email Campaigns) ---------------- */
    tp("TP-2029-1", "L-2029", at(-31, 14, 0), "Email Campaigns", "Email", "Email sent", "Neutral", "u-tom", "Clicked through from the October newsletter.", "manual"),
    tp("TP-2029-2", "L-2029", at(-25, 9, 0), "Email Campaigns", "Email", "Application submitted", "Positive", "u-tom", "DAS application submitted.", "application", "APP-49705"),
    tp("TP-2029-3", "L-2029", at(-5, 9, 30), "Email Campaigns", "Email", "Email reply", "Neutral", "u-tom", "Received DAS eligibility confirmation.", "email", "TH-1184"),

    /* ---------------- L-2024 Rachel Okonkwo (Organic Search) ---------------- */
    tp("TP-2024-1", "L-2024", at(-14, 11, 45), "Organic Search", "Organic", "Web form", "Positive", "u-leila", "Submitted an enquiry after an organic search.", "manual"),
    tp("TP-2024-2", "L-2024", at(-8, 9, 30), "Website", "Web", "Application submitted", "Positive", "u-leila", "Application submitted online.", "application", "APP-50188"),

    /* ---------------- L-2019 Victoria Nwosu (LinkedIn) ---------------- */
    tp("TP-2019-1", "L-2019", at(-27, 8, 50), "LinkedIn", "Paid Social", "Web form", "Positive", "u-hannah", "Enquiry from a LinkedIn campaign.", "manual"),
    tp("TP-2019-2", "L-2019", at(-18, 11, 0), "Website", "Web", "Application submitted", "Positive", "u-hannah", "Application submitted for CMI Level 6.", "application", "APP-50044"),
    tp("TP-2019-3", "L-2019", at(-3, 13, 20), "LinkedIn", "Paid Social", "Email sent", "Neutral", "u-hannah", "Proposal issued.", "manual"),

    /* ---------------- L-2016 Harrison Cole (Telephone) — single touch ---------------- */
    tp("TP-2016-1", "L-2016", at(-6, 16, 10), "Telephone", "Direct", "Inbound call", "Positive", "u-tom", "Called the admissions line directly about Operations Management.", "manual"),

    /* ---------------- L-2012 Sophie Bennett (Facebook Ads) ---------------- */
    tp("TP-2012-1", "L-2012", hoursAgo(20), "Facebook Ads", "Paid Social", "Web form", "Positive", "u-leila", "Enquiry via a Facebook advert.", "manual"),
    tp("TP-2012-2", "L-2012", at(-1, 12, 15), "Facebook Ads", "Paid Social", "Inbound call", "Positive", "u-leila", "Call about Digital Marketing Level 4.", "call", "CL-5509"),

    /* ---------------- L-2007 Amir Haddad (Website) ---------------- */
    tp("TP-2007-1", "L-2007", at(-16, 10, 5), "Website", "Web", "Web form", "Positive", "u-hannah", "Website enquiry form.", "manual"),
    tp("TP-2007-2", "L-2007", at(-9, 14, 0), "Website", "Web", "Application submitted", "Positive", "u-hannah", "Application submitted online.", "application", "APP-49902"),
    tp("TP-2007-3", "L-2007", hoursAgo(26), "Website", "Web", "Email reply", "Positive", "u-hannah", "Confirmed interview availability.", "email", "TH-1179"),

    /* ---------------- L-2003 Chloe Fitzgerald (Zoom Webinars) ---------------- */
    tp("TP-2003-1", "L-2003", at(-40, 15, 25), "Zoom Webinars", "Webinar", "Webinar attended", "Neutral", "u-amara", "Attended the CMI taster webinar.", "manual"),
    tp("TP-2003-2", "L-2003", at(-6, 11, 0), "Website", "Web", "Application submitted", "Positive", "u-amara", "Application submitted after the webinar.", "application", "APP-49720"),

    /* ---------------- L-1998 Gareth Llewellyn (Google Ads) — WON ---------------- */
    tp("TP-1998-1", "L-1998", at(-52, 11, 0), "Google Ads", "Paid Search", "Web form", "Positive", "u-tom", "Paid search enquiry for Project Controls.", "manual"),
    tp("TP-1998-2", "L-1998", at(-40, 9, 0), "Website", "Web", "Application submitted", "Positive", "u-tom", "Application submitted.", "application", "APP-49670"),
    tp("TP-1998-3", "L-1998", at(-30, 14, 0), "Google Ads", "Paid Search", "Outbound call", "Positive", "u-tom", "Discussed funding routes.", "manual"),
    tp("TP-1998-4", "L-1998", at(-4, 14, 30), "Google Ads", "Paid Search", "Outbound call", "Converted", "u-tom", "Closing call — funding approved and enrolment confirmed.", "manual", undefined, true),

    /* ---------------- L-1992 Nadia Rahman (Zoom Webinars) ---------------- */
    tp("TP-1992-1", "L-1992", at(-5, 9, 15), "Zoom Webinars", "Webinar", "Webinar attended", "Positive", "u-leila", "Attended the winter webinar series.", "manual"),
    tp("TP-1992-2", "L-1992", at(-1, 9, 0), "Zoom Webinars", "Webinar", "Email reply", "Positive", "u-leila", "Asked to add three colleagues to the Open Evening booking.", "email", "TH-1185"),
    tp("TP-1992-3", "L-1992", at(-10, 12, 0), "Website", "Web", "Application submitted", "Neutral", "u-leila", "Application submitted.", "application", "APP-50240"),

    /* ---------------- L-1987 Peter Ashworth (LinkedIn) ---------------- */
    tp("TP-1987-1", "L-1987", at(-22, 13, 40), "LinkedIn", "Paid Social", "Web form", "Positive", "u-amara", "Apprenticeship enquiry from a LinkedIn campaign.", "manual"),
    tp("TP-1987-2", "L-1987", at(-9, 10, 0), "Events", "Events", "Event registration", "Positive", "u-amara", "Registered for the Employer Briefing.", "event", "EV-2098:R-8901:registration"),
    tp("TP-1987-3", "L-1987", at(-2, 11, 0), "LinkedIn", "Paid Social", "Outbound call", "Positive", "u-amara", "Discussed renewal cohort numbers.", "call", "CL-5508"),
    tp("TP-1987-4", "L-1987", hoursAgo(6), "LinkedIn", "Paid Social", "Email reply", "Neutral", "u-amara", "Asked to review apprenticeship cohort options.", "email", "TH-1177"),

    /* ---------------- L-1981 Fiona O'Sullivan (Eventbrite) — LOST ---------------- */
    tp("TP-1981-1", "L-1981", at(-60, 10, 0), "Eventbrite", "Events", "Event registration", "Positive", "u-hannah", "Registered for an open event.", "manual"),
    tp("TP-1981-2", "L-1981", at(-50, 9, 0), "Website", "Web", "Application submitted", "Positive", "u-hannah", "Application submitted.", "application", "APP-49780"),
    tp("TP-1981-3", "L-1981", at(-12, 15, 0), "Eventbrite", "Events", "Email reply", "Rejected", "u-hannah", "Confirmed she enrolled with another provider.", "manual", undefined, true),

    /* ---------------- L-1976 Dominic Farrell (Website) ---------------- */
    tp("TP-1976-1", "L-1976", minutesAgo(95), "Website", "Web", "Web form", "Positive", "u-tom", "New website enquiry for Operations Manager Level 5.", "manual"),

    /* ---------------- L-2050 Sandra Whitmore (Google Ads) — WON ---------------- */
    tp("TP-2050-1", "L-2050", at(-35, 9, 30), "Google Ads", "Paid Search", "Web form", "Positive", "u-tom", "Paid search enquiry.", "manual"),
    tp("TP-2050-2", "L-2050", at(-30, 10, 0), "Google Ads", "Paid Search", "Outbound call", "Positive", "u-tom", "Qualified the enquiry.", "manual"),
    tp("TP-2050-3", "L-2050", at(-22, 10, 0), "Email Campaigns", "Email", "Email sent", "Neutral", "u-tom", "Sent pricing and dates.", "manual"),
    tp("TP-2050-4", "L-2050", at(-15, 12, 0), "Website", "Web", "Meeting", "Positive", "u-tom", "Employer review meeting held online.", "manual"),
    tp("TP-2050-5", "L-2050", at(-9, 11, 0), "Google Ads", "Paid Search", "Meeting", "Converted", "u-tom", "Closing meeting — both funded places confirmed.", "manual", undefined, true),

    /* ---------------- L-2049 Tariq Mahmood (Facebook Ads) — WON ---------------- */
    tp("TP-2049-1", "L-2049", at(-28, 14, 20), "Facebook Ads", "Paid Social", "Web form", "Positive", "u-leila", "Enquiry via Facebook advert.", "manual"),
    tp("TP-2049-2", "L-2049", at(-21, 9, 0), "Facebook Ads", "Paid Social", "Email sent", "Neutral", "u-leila", "Sent programme details.", "manual"),
    tp("TP-2049-3", "L-2049", at(-13, 15, 0), "Eventbrite", "Events", "Event registration", "Positive", "u-leila", "Attended the Open Evening.", "manual"),
    tp("TP-2049-4", "L-2049", at(-6, 10, 30), "Facebook Ads", "Paid Social", "Inbound call", "Converted", "u-leila", "Called to accept the place.", "manual", undefined, true),

    /* ---------------- L-2048 Rebecca Ellison (LinkedIn) — LOST ---------------- */
    tp("TP-2048-1", "L-2048", at(-44, 10, 0), "LinkedIn", "Paid Social", "Web form", "Positive", "u-tom", "LinkedIn campaign enquiry.", "manual"),
    tp("TP-2048-2", "L-2048", at(-30, 11, 0), "LinkedIn", "Paid Social", "Outbound call", "Neutral", "u-tom", "Discussed entry requirements.", "manual"),
    tp("TP-2048-3", "L-2048", at(-15, 16, 0), "LinkedIn", "Paid Social", "Email reply", "Rejected", "u-tom", "Deferred to next academic year.", "manual", undefined, true),

    /* ---------------- L-2046 Josephine Adeleke (Partner) ---------------- */
    tp("TP-2046-1", "L-2046", at(-11, 13, 45), "Partner", "Partner", "Manual note", "Positive", "u-leila", "Referred through a partner college.", "manual"),
    tp("TP-2046-2", "L-2046", hoursAgo(4), "Email Campaigns", "Email", "Email sent", "Neutral", "u-leila", "Sent partner-funded pack.", "manual"),

    /* ---------------- L-2045 Colin Massey (Zoom Webinars) ---------------- */
    tp("TP-2045-1", "L-2045", hoursAgo(30), "Zoom Webinars", "Webinar", "Webinar attended", "Positive", "u-leila", "Attended the winter webinars.", "manual"),
  ];
}

function tp(
  id: string,
  leadId: string,
  timestamp: string,
  source: string,
  channel: string,
  interactionType: string,
  outcome: string,
  ownerId: string,
  notes: string,
  refType: Touchpoint["refType"],
  refId?: string,
  isClosing = false,
): Touchpoint {
  return {
    id,
    leadId,
    timestamp,
    source,
    channel,
    interactionType,
    outcome,
    ownerId,
    notes,
    isClosing,
    refType,
    refId,
    category: categoryForInteractionType(interactionType),
  };
}