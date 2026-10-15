import Badge from "@/components/base/Badge";
import type { EmailMessage } from "@/store/types";
import { separateEmailContent } from "@/utils/emailContent";

export default function EmailMessageCard({ message, subject, index }: { message: EmailMessage; subject: string; index: number }) {
  const outbound = message.direction === "outbound";
  const content = separateEmailContent(message.body || "");
  const sent = new Date(message.sentAt);
  const timestamp = Number.isFinite(sent.getTime()) ? sent.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }) : "Time not recorded";
  return <article data-message-id={message.id} aria-label={`Email ${index + 1}`} className={`overflow-hidden rounded-lg border ${outbound ? "border-primary-200" : "border-background-200"}`}>
    <header className={`space-y-2 border-b px-4 py-3 ${outbound ? "border-primary-200 bg-primary-50" : "border-background-200 bg-background-100"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><span className="text-xs font-semibold text-foreground-500">Email {index + 1}</span><Badge tone={outbound ? "primary" : "secondary"}>{outbound ? "Sent" : "Received"}</Badge></div>
        <time dateTime={message.sentAt || undefined} className="text-xs text-foreground-500">{timestamp}</time>
      </div>
      <h3 className="break-words text-sm font-semibold text-foreground-900">{message.subject || subject}</h3>
      <dl className="grid gap-1 text-xs text-foreground-600">
        <div className="flex min-w-0 gap-2"><dt className="w-8 shrink-0 font-semibold">From</dt><dd className="break-all">{message.fromName}{message.fromEmail ? ` <${message.fromEmail}>` : ""}</dd></div>
        <div className="flex min-w-0 gap-2"><dt className="w-8 shrink-0 font-semibold">To</dt><dd className="break-all">{message.toEmail || "Not recorded"}</dd></div>
      </dl>
    </header>
    <div data-testid="email-message-body" className="whitespace-pre-wrap break-words px-4 py-4 text-[13px] leading-relaxed text-foreground-800" style={{ overflowWrap: "anywhere" }}>
      {content.body || <span className="italic text-foreground-400">No message body was available for this email.</span>}
    </div>
    {content.quoted.length ? <details className="border-t border-background-200 bg-background-100/50 px-4 py-3">
      <summary className="cursor-pointer text-xs font-semibold text-foreground-600">Previous quoted messages ({content.quoted.length})</summary>
      <div className="mt-3 space-y-3">{content.quoted.map((part, partIndex) => <div key={partIndex} className="whitespace-pre-wrap break-words rounded-md border border-background-200 bg-background-50 p-3 text-xs leading-relaxed text-foreground-500" style={{ overflowWrap: "anywhere" }}>{part}</div>)}</div>
    </details> : null}
  </article>;
}
