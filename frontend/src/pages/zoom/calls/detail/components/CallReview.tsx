import { useEffect, useMemo, useRef, useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import SearchInput from "@/components/base/SearchInput";
import { formatTimestamp } from "@/config/marketing";
import type { Call } from "@/store/types";

export default function CallReview({ call, canReviewMedia }: { call: Call; canReviewMedia: boolean }) {
  const duration = call.recordingDurationSec || call.durationSec || 0;
  const [currentSec, setCurrentSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [query, setQuery] = useState("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      if (timer.current) window.clearInterval(timer.current);
      return undefined;
    }
    timer.current = window.setInterval(() => {
      setCurrentSec((s) => {
        if (s + 1 >= duration) {
          setPlaying(false);
          return duration;
        }
        return s + 1;
      });
    }, 1000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, duration]);

  const transcript = call.transcript ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transcript;
    return transcript.filter((s) => `${s.speaker} ${s.text}`.toLowerCase().includes(q));
  }, [transcript, query]);

  const progress = duration > 0 ? (currentSec / duration) * 100 : 0;

  const seek = (sec: number) => {
    setCurrentSec(Math.max(0, Math.min(sec, duration)));
    setPlaying(false);
  };

  if (!canReviewMedia) {
    return (
      <div className="rounded-lg border border-background-200 bg-background-100/60 p-4">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground-700">
          <i className="ri-lock-2-line"></i>
          Recordings and transcripts are restricted for your role
        </p>
        <p className="mt-1 text-[11.5px] text-foreground-500">
          Access to call recordings and transcripts is controlled by the demo role matrix. Switch role to review
          permitted media.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-background-200 bg-background-50 p-4">
        {call.recordingAvailable ? (
          <>
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="primary"
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => setPlaying((p) => !p)}
              >
                <i className={playing ? "ri-pause-fill" : "ri-play-fill"}></i>
              </Button>
              <div className="min-w-0 flex-1">
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-background-200">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${progress}%` }}></div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    value={currentSec}
                    onChange={(e) => seek(Number(e.target.value))}
                    aria-label="Seek"
                    className="absolute inset-0 h-2 w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
              <span className="shrink-0 font-mono text-[12px] text-foreground-600">
                {formatTimestamp(currentSec)} / {formatTimestamp(duration)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="warning" icon="ri-error-warning-line">
                Simulated playback — not a real recording
              </Badge>
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                className="cursor-pointer text-[12px] font-semibold text-primary-600 hover:text-primary-700"
              >
                {showTranscript ? "Hide transcript" : "View transcript"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground-500">
            <i className="ri-volume-mute-line"></i>
            Recording unavailable
          </div>
        )}
      </div>

      {showTranscript ? (
        <div className="rounded-lg border border-background-200 bg-background-50">
          <div className="flex flex-col gap-2 border-b border-background-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-foreground-900">Transcript</p>
              {call.transcriptAvailable ? (
                <Badge tone="secondary">Fictional sample</Badge>
              ) : (
                <Badge tone="neutral">Unavailable</Badge>
              )}
            </div>
            {call.transcriptAvailable ? (
              <div className="w-full sm:w-56">
                <SearchInput value={query} onChange={setQuery} placeholder="Search transcript…" />
              </div>
            ) : null}
          </div>

          {!call.transcriptAvailable || transcript.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-foreground-400">Transcript unavailable</p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-foreground-400">
              No transcript segments match “{query}”.
            </p>
          ) : (
            <ul className="divide-y divide-background-200">
              {filtered.map((seg) => {
                const active = Math.abs(currentSec - seg.startSec) < 6;
                return (
                  <li key={seg.id} className={`flex gap-3 px-4 py-3 ${active ? "bg-primary-50/60" : ""}`}>
                    <button
                      type="button"
                      onClick={() => seek(seg.startSec)}
                      className="flex h-6 shrink-0 cursor-pointer items-center justify-center rounded bg-background-200 px-2 font-mono text-[11px] text-foreground-600 hover:bg-primary-100 hover:text-primary-700"
                      title="Jump to this moment"
                    >
                      {formatTimestamp(seg.startSec)}
                    </button>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">
                        {seg.speaker}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-foreground-700">{seg.text}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}