import type { Call, TranscriptSegment } from "@/store/types";

/**
 * Fictional Zoom Phone call-review detail. Recording and transcript availability
 * are flagged INDEPENDENTLY — many calls have neither, some have only a
 * recording, and only a few have a transcript. A transcript is never invented
 * for a call that did not have one.
 */

function seg(id: string, startSec: number, speaker: string, text: string): TranscriptSegment {
  return { id, startSec, speaker, text };
}

const CALL_DETAILS: Record<string, Partial<Call>> = {
  "CL-5501": {
    platform: "Zoom Phone",
    salesOwnerId: "u-amara",
    employerName: "Brightworks Ltd",
    programme: "Apprenticeship — Levy funded",
    outcome: "Employer Discussion Required",
    recordingAvailable: true,
    recordingDurationSec: 342,
    transcriptAvailable: true,
    followUpTaskId: undefined,
    transcript: [
      seg("s1", 0, "Amara Whitfield", "Good morning, thanks for calling Kent Business College. How can I help today?"),
      seg("s2", 12, "Elaine Foster", "Hi, I'm calling on behalf of Brightworks. We're looking at taking on a couple of apprentices and wanted to understand the levy process."),
      seg("s3", 38, "Amara Whitfield", "Absolutely. So as a levy-paying employer you can fund the training through your Apprenticeship Service account. Could I ask roughly how many starts you're planning?"),
      seg("s4", 61, "Elaine Foster", "Probably two to begin with, potentially more if it works well. Both would be in business administration."),
      seg("s5", 96, "Amara Whitfield", "That's a good starting point. I'll send over the employer agreement and a short guide to the Apprenticeship Service, and I can book a briefing for your team."),
      seg("s6", 150, "Elaine Foster", "That would be helpful. One of our managers needs to be involved, so a briefing makes sense."),
      seg("s7", 210, "Amara Whitfield", "Understood. I'll confirm the employer briefing details by email and we can agree the cohort dates there."),
    ],
  },
  "CL-5502": {
    platform: "Zoom Phone",
    salesOwnerId: "u-tom",
    programme: "Project Controls Professional Level 6",
    outcome: "Interested",
    recordingAvailable: true,
    recordingDurationSec: 210,
    transcriptAvailable: true,
    transcript: [
      seg("p1", 0, "Tom Blackwood", "Hi Priya, calling as promised about the January start options."),
      seg("p2", 9, "Priya Raman", "Thanks Tom. Yes, we'd like to confirm the intake — providing the funding is in place."),
      seg("p3", 45, "Tom Blackwood", "Great. The January cohort works, and I'll re-send the funding pack so your finance team can sign it off."),
      seg("p4", 120, "Priya Raman", "Perfect. I'll come back to you once it's approved."),
    ],
  },
  "CL-5506": {
    platform: "Zoom Phone",
    salesOwnerId: "u-leila",
    programme: "Marketing Manager with CIM Level 6",
    outcome: "Interested",
    recordingAvailable: true,
    recordingDurationSec: 265,
    transcriptAvailable: false,
    transcript: undefined,
  },
  "CL-5508": {
    platform: "Zoom Phone",
    salesOwnerId: "u-amara",
    employerName: "Ashworth Group",
    programme: "Apprenticeship — Levy funded",
    outcome: "Employer Discussion Required",
    recordingAvailable: false,
    recordingDurationSec: 0,
    transcriptAvailable: true,
    transcript: [
      seg("a1", 0, "Amara Whitfield", "Peter, thanks for taking the call. How are your renewal cohorts looking?"),
      seg("a2", 14, "Peter Ashworth", "We're reviewing numbers now. I think we'll want a similar cohort to last year."),
      seg("a3", 58, "Amara Whitfield", "I'll put together a summary of options and we can review it with your operations lead."),
    ],
  },
  "CL-5509": {
    platform: "Zoom Phone",
    salesOwnerId: "u-leila",
    programme: "Digital Marketing Level 4",
    outcome: "Needs Follow-up",
    recordingAvailable: true,
    recordingDurationSec: 96,
    transcriptAvailable: false,
  },
  "CL-5510": {
    platform: "Zoom Phone",
    salesOwnerId: "u-tom",
    programme: "DAS Matter",
    outcome: "Needs Follow-up",
    recordingAvailable: false,
    recordingDurationSec: 0,
    transcriptAvailable: false,
  },
  "CL-5504": {
    platform: "Zoom Phone",
    salesOwnerId: "u-hannah",
    programme: "Business Administration Level 3",
    outcome: "Needs Follow-up",
    recordingAvailable: true,
    recordingDurationSec: 48,
    transcriptAvailable: false,
  },
};

/** Enriches a call with its fictional recording/transcript detail, if any. */
export function withCallDetail(call: Call): Call {
  const detail = CALL_DETAILS[call.id];
  if (!detail) {
    return {
      ...call,
      platform: call.platform ?? "Zoom Phone",
      recordingAvailable: call.recordingAvailable ?? false,
      recordingDurationSec: call.recordingDurationSec ?? 0,
      transcriptAvailable: call.transcriptAvailable ?? false,
    };
  }
  return { ...call, ...detail };
}